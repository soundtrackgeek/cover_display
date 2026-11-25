use crate::analysis::{analyze_track_preview, TrackPreviewPlan};
use crate::config::{AppSettings, TrackOrder};
use crate::library::{AlbumSummary, TrackInfo};
use crossbeam_channel::{unbounded, Receiver, Sender};
use rand::seq::SliceRandom;
use rodio::{Decoder, OutputStream, Sink, Source};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub status: String, // "idle" | "playing" | "paused" | "loading"
    pub album_id: Option<String>,
    pub album_title: String,
    pub album_artist: String,
    pub album_year: Option<i32>,
    pub track_index: usize,
    pub total_tracks: usize,
    pub track: Option<TrackInfo>,
    pub tracks: Vec<TrackInfo>,
    pub clip_start_sec: f32,
    pub clip_duration_sec: f32,
    pub clip_elapsed_sec: f32,
    pub track_duration_sec: f32,
    pub analysis_reason: String,
    pub envelope: Vec<f32>,
    pub clap_windows: Vec<f32>,
    pub has_timeline: bool,
    pub has_clap: bool,
    pub level: f32,
    pub volume: f32,
    pub is_pinned: bool,
    pub full_track_mode: bool,
    pub source_view: String, // "coverflow" | "wall"
}

impl Default for PlaybackState {
    fn default() -> Self {
        Self {
            status: "idle".to_string(),
            album_id: None,
            album_title: String::new(),
            album_artist: String::new(),
            album_year: None,
            track_index: 0,
            total_tracks: 0,
            track: None,
            tracks: Vec::new(),
            clip_start_sec: 0.0,
            clip_duration_sec: 15.0,
            clip_elapsed_sec: 0.0,
            track_duration_sec: 0.0,
            analysis_reason: String::new(),
            envelope: Vec::new(),
            clap_windows: Vec::new(),
            has_timeline: false,
            has_clap: false,
            level: 0.0,
            volume: 0.85,
            is_pinned: false,
            full_track_mode: false,
            source_view: "coverflow".to_string(),
        }
    }
}

pub enum AudioCommand {
    PlayAlbum {
        album: AlbumSummary,
        tracks: Vec<TrackInfo>,
        start_track_index: usize,
        settings: AppSettings,
        is_pinned: bool,
        source_view: String,
    },
    PlayTrackAt {
        track_index: usize,
        custom_start_sec: Option<f32>,
        settings: AppSettings,
    },
    TogglePause,
    NextTrack {
        settings: AppSettings,
    },
    PrevTrack {
        settings: AppSettings,
    },
    SetPinned(bool),
    SetVolume(f32),
    UpdateSettings(AppSettings),
    Stop {
        only_if_unpinned: bool,
    },
    GetState(Sender<PlaybackState>),
}

pub struct AudioController {
    tx: Sender<AudioCommand>,
}

impl AudioController {
    pub fn spawn(app: AppHandle, initial_settings: AppSettings) -> Self {
        let (tx, rx) = unbounded::<AudioCommand>();
        std::thread::Builder::new()
            .name("cover-display-audio".to_string())
            .spawn(move || audio_actor_loop(app, rx, initial_settings))
            .expect("Failed to spawn audio thread");
        Self { tx }
    }

    pub fn send(&self, cmd: AudioCommand) {
        let _ = self.tx.send(cmd);
    }

    pub fn get_state(&self) -> PlaybackState {
        let (reply_tx, reply_rx) = unbounded();
        if self.tx.send(AudioCommand::GetState(reply_tx)).is_ok() {
            if let Ok(state) = reply_rx.recv_timeout(Duration::from_millis(500)) {
                return state;
            }
        }
        PlaybackState::default()
    }
}

/// Custom DSP source wrapper applying clip length limit, smooth cosine fade-in/out,
/// loudness normalization, early soft fade-out on switch/stop, and RMS level metering.
struct PreviewSource<S> {
    inner: S,
    channels: u16,
    sample_rate: u32,
    sample_pos: u64,
    total_samples: u64,
    fade_in_samples: u64,
    fade_out_samples: u64,
    gain: f32,
    early_stop: Arc<AtomicBool>,
    early_stop_start: Option<u64>,
    early_fade_samples: u64,
    level_bits: Arc<AtomicU32>,
    elapsed_samples: Arc<AtomicU64>,
    meter_acc: f32,
    meter_cnt: u32,
}

impl<S> PreviewSource<S>
where
    S: Source<Item = f32>,
{
    fn new(
        inner: S,
        clip_duration_sec: f32,
        fade_ms: u32,
        gain: f32,
        is_full_track: bool,
        start_at_zero: bool,
        early_stop: Arc<AtomicBool>,
        level_bits: Arc<AtomicU32>,
        elapsed_samples: Arc<AtomicU64>,
    ) -> Self {
        let channels = inner.channels().max(1);
        let sample_rate = inner.sample_rate().max(8000);
        let total_samples = if is_full_track {
            u64::MAX
        } else {
            ((clip_duration_sec * sample_rate as f32) as u64) * channels as u64
        };
        let (fade_in_samples, fade_out_samples) = if is_full_track {
            let fi = if start_at_zero {
                0
            } else {
                ((0.12 * sample_rate as f32) as u64) * channels as u64
            };
            (fi, 0)
        } else {
            let fade_sec = (fade_ms as f32 / 1000.0).min(clip_duration_sec * 0.35);
            let fade_samples = ((fade_sec * sample_rate as f32) as u64) * channels as u64;
            (fade_samples, fade_samples)
        };
        let early_fade_samples = ((0.18 * sample_rate as f32) as u64) * channels as u64;

        Self {
            inner,
            channels,
            sample_rate,
            sample_pos: 0,
            total_samples,
            fade_in_samples,
            fade_out_samples,
            gain,
            early_stop,
            early_stop_start: None,
            early_fade_samples: early_fade_samples.max(channels as u64 * 64),
            level_bits,
            elapsed_samples,
            meter_acc: 0.0,
            meter_cnt: 0,
        }
    }
}

impl<S> Iterator for PreviewSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.sample_pos >= self.total_samples {
            self.level_bits.store(0.0f32.to_bits(), Ordering::Relaxed);
            return None;
        }

        if self.early_stop_start.is_none() && self.early_stop.load(Ordering::Relaxed) {
            self.early_stop_start = Some(self.sample_pos);
        }

        let mut env = 1.0f32;

        // Early soft fade-out when stopping or switching tracks
        if let Some(stop_start) = self.early_stop_start {
            let dt = self.sample_pos.saturating_sub(stop_start);
            if dt >= self.early_fade_samples {
                self.level_bits.store(0.0f32.to_bits(), Ordering::Relaxed);
                return None;
            }
            let frac = dt as f32 / self.early_fade_samples as f32;
            env *= 0.5 * (1.0 + (std::f32::consts::PI * frac).cos());
        }

        // Smooth cosine fade-in
        if self.fade_in_samples > 0 && self.sample_pos < self.fade_in_samples {
            let frac = self.sample_pos as f32 / self.fade_in_samples as f32;
            env *= 0.5 * (1.0 - (std::f32::consts::PI * frac).cos());
        }

        // Smooth cosine fade-out at end of clip
        let remaining = self.total_samples.saturating_sub(self.sample_pos);
        if self.fade_out_samples > 0 && remaining < self.fade_out_samples {
            let frac = remaining as f32 / self.fade_out_samples as f32;
            env *= 0.5 * (1.0 - (std::f32::consts::PI * frac).cos());
        }

        let sample = match self.inner.next() {
            Some(s) => s,
            None => {
                self.level_bits.store(0.0f32.to_bits(), Ordering::Relaxed);
                return None;
            }
        };

        let out = (sample * self.gain * env).clamp(-0.98, 0.98);
        self.sample_pos += 1;

        self.meter_acc += out * out;
        self.meter_cnt += 1;
        if self.meter_cnt >= 1024 {
            let rms = (self.meter_acc / self.meter_cnt as f32).sqrt();
            // Boost slightly for visual liveliness
            let visual = (rms * 2.6).clamp(0.0, 1.0);
            self.level_bits.store(visual.to_bits(), Ordering::Relaxed);
            self.elapsed_samples
                .store(self.sample_pos / self.channels as u64, Ordering::Relaxed);
            self.meter_acc = 0.0;
            self.meter_cnt = 0;
        }

        Some(out)
    }
}

impl<S> Source for PreviewSource<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        Some(Duration::from_secs_f64(
            self.total_samples as f64 / (self.sample_rate as f64 * self.channels as f64),
        ))
    }
}

fn single_priority(t: &TrackInfo) -> u8 {
    if !t.is_single {
        return 3;
    }
    match t.single_confidence.as_deref() {
        Some("confirmed") => 0,
        Some("chart") => 1,
        _ => 2, // "possible"
    }
}

pub fn order_tracks(mut tracks: Vec<TrackInfo>, order: &TrackOrder, singles_first: bool) -> Vec<TrackInfo> {
    let apply_base_order = |list: &mut Vec<TrackInfo>| match order {
        TrackOrder::Sequential => {
            list.sort_by(|a, b| {
                a.disc_number
                    .cmp(&b.disc_number)
                    .then_with(|| a.track_number.cmp(&b.track_number))
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
        TrackOrder::LovedFirst => {
            list.sort_by(|a, b| {
                b.loved
                    .cmp(&a.loved)
                    .then_with(|| b.rating.unwrap_or(0).cmp(&a.rating.unwrap_or(0)))
                    .then_with(|| a.disc_number.cmp(&b.disc_number))
                    .then_with(|| a.track_number.cmp(&b.track_number))
            });
        }
        TrackOrder::RatedFirst => {
            list.sort_by(|a, b| {
                b.rating
                    .unwrap_or(-1)
                    .cmp(&a.rating.unwrap_or(-1))
                    .then_with(|| b.loved.cmp(&a.loved))
                    .then_with(|| a.disc_number.cmp(&b.disc_number))
                    .then_with(|| a.track_number.cmp(&b.track_number))
            });
        }
        TrackOrder::Shuffle => {
            let mut rng = rand::thread_rng();
            list.shuffle(&mut rng);
        }
    };

    if !singles_first {
        apply_base_order(&mut tracks);
        return tracks;
    }

    let (mut singles, mut rest): (Vec<TrackInfo>, Vec<TrackInfo>) =
        tracks.into_iter().partition(|t| t.is_single);

    apply_base_order(&mut singles);
    // Keep confirmed/chart singles ahead of 'possible' matches while preserving relative order
    singles.sort_by_key(single_priority);
    apply_base_order(&mut rest);

    singles.extend(rest);
    singles
}

fn loudness_gain(loudness_db: Option<f32>, normalize: bool) -> f32 {
    if !normalize {
        return 1.0;
    }
    let Some(db) = loudness_db else {
        return 1.0;
    };
    if !db.is_finite() || db < -60.0 || db > 0.0 {
        return 1.0;
    }
    // Target -16 dB RMS (matches typical timelines left_db/right_db range -22..-10 dB)
    let delta_db = (-16.0 - db).clamp(-9.0, 9.0);
    10.0f32.powf(delta_db / 20.0)
}

fn build_track_path(track: &TrackInfo) -> PathBuf {
    PathBuf::from(&track.file_path).join(&track.filename)
}

fn audio_actor_loop(app: AppHandle, rx: Receiver<AudioCommand>, mut settings: AppSettings) {
    let stream_opt = OutputStream::try_default().ok();
    let stream_handle = stream_opt.as_ref().map(|(_, h)| h.clone());

    let mut sink: Option<Sink> = None;
    let mut state = PlaybackState {
        volume: settings.volume,
        ..Default::default()
    };

    let mut early_stop = Arc::new(AtomicBool::new(false));
    let mut level_bits = Arc::new(AtomicU32::new(0));
    let mut elapsed_samples = Arc::new(AtomicU64::new(0));
    let mut current_sample_rate: u32 = 44100;
    let mut last_emit = Instant::now();

    let emit_state = |st: &PlaybackState| {
        let _ = app.emit("playback-state", st);
    };

    let start_track = |state: &mut PlaybackState,
                       sink: &mut Option<Sink>,
                       early_stop: &mut Arc<AtomicBool>,
                       level_bits: &mut Arc<AtomicU32>,
                       elapsed_samples: &mut Arc<AtomicU64>,
                       current_sample_rate: &mut u32,
                       idx: usize,
                       custom_start: Option<f32>,
                       cfg: &AppSettings| {
        // Softly stop any previous sink
        early_stop.store(true, Ordering::Relaxed);
        if let Some(old_sink) = sink.take() {
            old_sink.stop();
        }

        if state.tracks.is_empty() {
            state.status = "idle".to_string();
            state.track = None;
            state.level = 0.0;
            return;
        }

        let Some(ref handle) = stream_handle else {
            state.status = "idle".to_string();
            return;
        };

        // Try tracks starting at idx (skipping missing/unreadable files gracefully)
        let total = state.tracks.len();
        for attempt in 0..total.min(4) {
            let try_idx = (idx + attempt) % total;
            let track = state.tracks[try_idx].clone();
            let full_path = build_track_path(&track);
            let Ok(file) = File::open(&full_path) else {
                continue;
            };
            let Ok(mut decoder) = Decoder::new(BufReader::new(file)) else {
                continue;
            };

            let plan: TrackPreviewPlan = analyze_track_preview(
                &cfg.library_dir,
                &track.file_path,
                &track.filename,
                track.time_seconds,
                cfg,
                custom_start,
            );

            let mut actual_start = plan.start_sec;
            if actual_start > 0.5 {
                if decoder
                    .try_seek(Duration::from_secs_f32(actual_start))
                    .is_err()
                {
                    actual_start = 0.0;
                }
            }

            let sr = decoder.sample_rate().max(8000);
            *current_sample_rate = sr;
            let gain = loudness_gain(plan.loudness_db, cfg.normalize_loudness);

            let new_early = Arc::new(AtomicBool::new(false));
            let new_level = Arc::new(AtomicU32::new(0));
            let new_elapsed = Arc::new(AtomicU64::new(0));

            let source = PreviewSource::new(
                decoder.convert_samples::<f32>(),
                plan.clip_duration_sec,
                cfg.fade_ms,
                gain,
                cfg.full_track_mode,
                actual_start < 0.5,
                new_early.clone(),
                new_level.clone(),
                new_elapsed.clone(),
            );

            let Ok(new_sink) = Sink::try_new(handle) else {
                continue;
            };
            new_sink.set_volume(state.volume);
            new_sink.append(source);

            *early_stop = new_early;
            *level_bits = new_level;
            *elapsed_samples = new_elapsed;
            *sink = Some(new_sink);

            state.status = "playing".to_string();
            state.track_index = try_idx;
            state.total_tracks = total;
            state.track = Some(track);
            state.clip_start_sec = actual_start;
            state.clip_duration_sec = plan.clip_duration_sec;
            state.clip_elapsed_sec = 0.0;
            state.track_duration_sec = plan.track_duration_sec;
            state.analysis_reason = plan.reason;
            state.envelope = plan.envelope;
            state.clap_windows = plan.clap_windows;
            state.has_timeline = plan.has_timeline;
            state.has_clap = plan.has_clap;
            state.full_track_mode = cfg.full_track_mode;
            state.level = 0.0;
            return;
        }

        state.status = "idle".to_string();
        state.level = 0.0;
    };

    loop {
        match rx.recv_timeout(Duration::from_millis(60)) {
            Ok(cmd) => match cmd {
                AudioCommand::PlayAlbum {
                    album,
                    tracks,
                    start_track_index,
                    settings: new_cfg,
                    is_pinned,
                    source_view,
                } => {
                    settings = new_cfg;
                    state.volume = settings.volume;
                    state.album_id = Some(album.id);
                    state.album_title = album.album;
                    state.album_artist = album.artist;
                    state.album_year = album.year;
                    state.tracks = tracks;
                    state.total_tracks = state.tracks.len();
                    state.is_pinned = is_pinned;
                    state.source_view = source_view;
                    let idx = start_track_index.min(state.tracks.len().saturating_sub(1));
                    start_track(
                        &mut state,
                        &mut sink,
                        &mut early_stop,
                        &mut level_bits,
                        &mut elapsed_samples,
                        &mut current_sample_rate,
                        idx,
                        None,
                        &settings,
                    );
                    emit_state(&state);
                    last_emit = Instant::now();
                }
                AudioCommand::PlayTrackAt {
                    track_index,
                    custom_start_sec,
                    settings: new_cfg,
                } => {
                    settings = new_cfg;
                    state.volume = settings.volume;
                    if !state.tracks.is_empty() {
                        let idx = track_index.min(state.tracks.len() - 1);
                        start_track(
                            &mut state,
                            &mut sink,
                            &mut early_stop,
                            &mut level_bits,
                            &mut elapsed_samples,
                            &mut current_sample_rate,
                            idx,
                            custom_start_sec,
                            &settings,
                        );
                        emit_state(&state);
                        last_emit = Instant::now();
                    }
                }
                AudioCommand::TogglePause => {
                    if let Some(ref s) = sink {
                        if s.is_paused() {
                            s.play();
                            state.status = "playing".to_string();
                        } else {
                            s.pause();
                            state.status = "paused".to_string();
                            state.level = 0.0;
                        }
                        emit_state(&state);
                    }
                }
                AudioCommand::NextTrack { settings: new_cfg } => {
                    settings = new_cfg;
                    if !state.tracks.is_empty() {
                        let next_idx = (state.track_index + 1) % state.tracks.len();
                        start_track(
                            &mut state,
                            &mut sink,
                            &mut early_stop,
                            &mut level_bits,
                            &mut elapsed_samples,
                            &mut current_sample_rate,
                            next_idx,
                            None,
                            &settings,
                        );
                        emit_state(&state);
                        last_emit = Instant::now();
                    }
                }
                AudioCommand::PrevTrack { settings: new_cfg } => {
                    settings = new_cfg;
                    if !state.tracks.is_empty() {
                        let prev_idx = if state.track_index == 0 {
                            state.tracks.len() - 1
                        } else {
                            state.track_index - 1
                        };
                        start_track(
                            &mut state,
                            &mut sink,
                            &mut early_stop,
                            &mut level_bits,
                            &mut elapsed_samples,
                            &mut current_sample_rate,
                            prev_idx,
                            None,
                            &settings,
                        );
                        emit_state(&state);
                        last_emit = Instant::now();
                    }
                }
                AudioCommand::SetPinned(pinned) => {
                    state.is_pinned = pinned;
                    emit_state(&state);
                }
                AudioCommand::SetVolume(vol) => {
                    let clamped = vol.clamp(0.0, 1.0);
                    state.volume = clamped;
                    settings.volume = clamped;
                    if let Some(ref s) = sink {
                        s.set_volume(clamped);
                    }
                    emit_state(&state);
                }
                AudioCommand::UpdateSettings(new_cfg) => {
                    let order_changed = settings.singles_first != new_cfg.singles_first
                        || settings.track_order != new_cfg.track_order;
                    let full_changed = settings.full_track_mode != new_cfg.full_track_mode;
                    let mode_changed = full_changed
                        || settings.preview_mode != new_cfg.preview_mode
                        || settings.clip_duration_sec != new_cfg.clip_duration_sec
                        || settings.preview_percentage != new_cfg.preview_percentage
                        || settings.preview_fixed_offset_sec != new_cfg.preview_fixed_offset_sec
                        || settings.normalize_loudness != new_cfg.normalize_loudness;
                    let switching_into_full = full_changed && new_cfg.full_track_mode;
                    settings = new_cfg;
                    state.volume = settings.volume;
                    state.full_track_mode = settings.full_track_mode;
                    if let Some(ref s) = sink {
                        s.set_volume(state.volume);
                    }
                    if order_changed && !state.tracks.is_empty() {
                        let current_track_id = state.track.as_ref().map(|t| t.id);
                        let raw = std::mem::take(&mut state.tracks);
                        state.tracks = order_tracks(raw, &settings.track_order, settings.singles_first);
                        if let Some(cid) = current_track_id {
                            if let Some(pos) = state.tracks.iter().position(|t| t.id == cid) {
                                state.track_index = pos;
                            }
                        }
                    }
                    if mode_changed && state.status == "playing" && !state.tracks.is_empty() {
                        let idx = state.track_index;
                        let continue_from = if switching_into_full {
                            Some((state.clip_start_sec + state.clip_elapsed_sec).max(0.0))
                        } else {
                            None
                        };
                        start_track(
                            &mut state,
                            &mut sink,
                            &mut early_stop,
                            &mut level_bits,
                            &mut elapsed_samples,
                            &mut current_sample_rate,
                            idx,
                            continue_from,
                            &settings,
                        );
                    }
                    emit_state(&state);
                }
                AudioCommand::Stop { only_if_unpinned } => {
                    if only_if_unpinned && state.is_pinned {
                        continue;
                    }
                    early_stop.store(true, Ordering::Relaxed);
                    // Brief soft fade-out wait so hovering off covers sounds lush, never clicks
                    if sink.is_some() {
                        std::thread::sleep(Duration::from_millis(90));
                    }
                    if let Some(s) = sink.take() {
                        s.stop();
                    }
                    state.status = "idle".to_string();
                    state.level = 0.0;
                    state.is_pinned = false;
                    emit_state(&state);
                }
                AudioCommand::GetState(reply) => {
                    let _ = reply.send(state.clone());
                }
            },
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                // Periodic progress check & auto-advance to next track in album!
                if state.status == "playing" {
                    let finished = sink.as_ref().map(|s| s.empty()).unwrap_or(true);
                    if finished {
                        if state.tracks.len() > 1 {
                            let next_idx = (state.track_index + 1) % state.tracks.len();
                            start_track(
                                &mut state,
                                &mut sink,
                                &mut early_stop,
                                &mut level_bits,
                                &mut elapsed_samples,
                                &mut current_sample_rate,
                                next_idx,
                                None,
                                &settings,
                            );
                            emit_state(&state);
                            last_emit = Instant::now();
                        } else if !state.tracks.is_empty() {
                            // Loop single-track release cleanly
                            start_track(
                                &mut state,
                                &mut sink,
                                &mut early_stop,
                                &mut level_bits,
                                &mut elapsed_samples,
                                &mut current_sample_rate,
                                0,
                                None,
                                &settings,
                            );
                            emit_state(&state);
                            last_emit = Instant::now();
                        }
                    } else if last_emit.elapsed() >= Duration::from_millis(70) {
                        let frames = elapsed_samples.load(Ordering::Relaxed);
                        state.clip_elapsed_sec =
                            (frames as f32 / current_sample_rate as f32).min(state.clip_duration_sec);
                        state.level = f32::from_bits(level_bits.load(Ordering::Relaxed));
                        emit_state(&state);
                        last_emit = Instant::now();
                    }
                }
            }
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
        }
    }
}
