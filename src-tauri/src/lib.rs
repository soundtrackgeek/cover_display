mod analysis;
mod audio;
mod config;
mod covers;
mod library;

use analysis::SonicAlbumIndex;
use audio::{AudioCommand, AudioController, PlaybackState};
use config::{load_settings, save_settings, AlbumFilter, AppSettings};
use covers::CoverCache;
use library::{
    get_album_tracks, load_catalog_from_dir, AlbumSummary, ArtistSuggestion, Catalog,
    CatalogOverview, QueryResult, ScrubberMark, TrackInfo,
};
use parking_lot::RwLock;
use serde::Serialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::http::{header, Response, StatusCode};
use tauri::{Emitter, Manager, State};

pub struct AppState {
    pub settings: RwLock<AppSettings>,
    pub catalog: Arc<RwLock<Catalog>>,
    pub covers: Arc<CoverCache>,
    pub sonic_index: Arc<RwLock<Option<SonicAlbumIndex>>>,
    pub audio: AudioController,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowResponse {
    pub items: Vec<AlbumSummary>,
    pub similarity_scores: Vec<f32>,
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> AppSettings {
    state.settings.read().clone()
}

#[tauri::command]
fn update_settings(state: State<'_, AppState>, settings: AppSettings) -> Result<AppSettings, String> {
    let dir_changed = state.settings.read().library_dir != settings.library_dir;
    save_settings(&settings)?;
    *state.settings.write() = settings.clone();
    state.audio.send(AudioCommand::UpdateSettings(settings.clone()));

    if dir_changed {
        let new_cat = load_catalog_from_dir(&settings.library_dir)?;
        *state.catalog.write() = new_cat;
    }

    Ok(settings)
}

#[tauri::command]
fn get_catalog_overview(state: State<'_, AppState>) -> CatalogOverview {
    let sonic_ready = state.sonic_index.read().is_some();
    state.catalog.read().overview(sonic_ready)
}

#[tauri::command]
fn reload_library(state: State<'_, AppState>) -> Result<CatalogOverview, String> {
    let dir = state.settings.read().library_dir.clone();
    let new_cat = load_catalog_from_dir(&dir)?;
    *state.catalog.write() = new_cat;
    let sonic_ready = state.sonic_index.read().is_some();
    Ok(state.catalog.read().overview(sonic_ready))
}

#[tauri::command]
async fn query_albums(
    state: State<'_, AppState>,
    filter: AlbumFilter,
) -> Result<QueryResult, String> {
    let similar_ranked = if let Some(ref target_id) = filter.similar_to_album_id {
        // Ensure sonic index is loaded or built on demand (blocking pool so UI stays silky)
        let needs_build = state.sonic_index.read().is_none();
        if needs_build {
            let dir = state.settings.read().library_dir.clone();
            let built = tokio::task::spawn_blocking(move || {
                SonicAlbumIndex::load_cached()
                    .ok_or_else(|| "cache miss".to_string())
                    .or_else(|_| SonicAlbumIndex::build_from_dbs(&dir))
            })
            .await
            .map_err(|e| format!("Sonic index task failed: {e}"))??;
            *state.sonic_index.write() = Some(built);
        }
        let guard = state.sonic_index.read();
        guard
            .as_ref()
            .map(|idx| idx.find_similar(target_id, 240))
    } else {
        None
    };

    let crate_ids: HashSet<String> = state
        .settings
        .read()
        .crate_album_ids
        .iter()
        .cloned()
        .collect();
    let mut cat = state.catalog.write();
    Ok(cat.apply_filter(&filter, similar_ranked, &crate_ids))
}

#[tauri::command]
fn get_album_window(state: State<'_, AppState>, start: usize, count: usize) -> WindowResponse {
    let (items, similarity_scores) = state.catalog.read().get_window(start, count);
    WindowResponse {
        items,
        similarity_scores,
    }
}

#[tauri::command]
fn get_scrubber_marks(state: State<'_, AppState>, steps: usize) -> Vec<ScrubberMark> {
    state.catalog.read().get_scrubber_marks(steps)
}

#[tauri::command]
fn suggest_artists(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Vec<ArtistSuggestion> {
    state.catalog.read().suggest_artists(&query, limit.unwrap_or(20))
}

#[tauri::command]
fn find_album_position(state: State<'_, AppState>, album_id: String) -> Option<usize> {
    state.catalog.read().index_of_album_in_filtered(&album_id)
}

#[tauri::command]
fn fetch_album_tracks(state: State<'_, AppState>, album_id: String) -> Result<Vec<TrackInfo>, String> {
    let dir = state.settings.read().library_dir.clone();
    get_album_tracks(&dir, &album_id)
}

#[tauri::command]
async fn get_album_accent_color(
    state: State<'_, AppState>,
    album_id: String,
) -> Result<[u8; 3], String> {
    let cover_path = state.catalog.read().cover_paths.get(&album_id).cloned();
    let covers = state.covers.clone();
    let rgb = tokio::task::spawn_blocking(move || {
        covers.get_accent_color(&album_id, cover_path.as_deref())
    })
    .await
    .unwrap_or([217, 138, 46]);
    Ok(rgb)
}

#[tauri::command]
async fn preview_album(
    state: State<'_, AppState>,
    album_id: String,
    start_track_index: Option<usize>,
    start_track_id: Option<i64>,
    is_pinned: Option<bool>,
    source_view: Option<String>,
) -> Result<(), String> {
    let (album, dir, settings) = {
        let cat = state.catalog.read();
        let idx = cat
            .album_idx_by_id
            .get(&album_id)
            .copied()
            .ok_or_else(|| format!("Album not found: {album_id}"))?;
        let album = cat.albums[idx].clone();
        let cfg = state.settings.read().clone();
        (album, cfg.library_dir.clone(), cfg)
    };

    let aid = album.id.clone();
    let tracks = tokio::task::spawn_blocking(move || get_album_tracks(&dir, &aid))
        .await
        .map_err(|e| format!("Track load join error: {e}"))??;

    let ordered = audio::order_tracks(tracks, &settings.track_order, settings.singles_first);
    let resolved_index = start_track_id
        .and_then(|tid| ordered.iter().position(|t| t.id == tid))
        .unwrap_or_else(|| start_track_index.unwrap_or(0));

    state.audio.send(AudioCommand::PlayAlbum {
        album,
        tracks: ordered,
        start_track_index: resolved_index,
        settings,
        is_pinned: is_pinned.unwrap_or(false),
        source_view: source_view.unwrap_or_else(|| "coverflow".to_string()),
    });
    Ok(())
}

#[tauri::command]
fn preview_track_at(
    state: State<'_, AppState>,
    track_index: usize,
    custom_start_sec: Option<f32>,
) {
    let settings = state.settings.read().clone();
    state.audio.send(AudioCommand::PlayTrackAt {
        track_index,
        custom_start_sec,
        settings,
    });
}

#[tauri::command]
fn playback_toggle_pause(state: State<'_, AppState>) {
    state.audio.send(AudioCommand::TogglePause);
}

#[tauri::command]
fn playback_next_track(state: State<'_, AppState>) {
    let settings = state.settings.read().clone();
    state.audio.send(AudioCommand::NextTrack { settings });
}

#[tauri::command]
fn playback_prev_track(state: State<'_, AppState>) {
    let settings = state.settings.read().clone();
    state.audio.send(AudioCommand::PrevTrack { settings });
}

#[tauri::command]
fn playback_stop(state: State<'_, AppState>, only_if_unpinned: Option<bool>) {
    state.audio.send(AudioCommand::Stop {
        only_if_unpinned: only_if_unpinned.unwrap_or(false),
    });
}

#[tauri::command]
fn playback_set_pinned(state: State<'_, AppState>, pinned: bool) {
    state.audio.send(AudioCommand::SetPinned(pinned));
}

#[tauri::command]
fn playback_set_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    let clamped = volume.clamp(0.0, 1.0);
    {
        let mut cfg = state.settings.write();
        cfg.volume = clamped;
        let _ = save_settings(&cfg);
    }
    state.audio.send(AudioCommand::SetVolume(clamped));
    Ok(())
}

#[tauri::command]
fn get_playback_state(state: State<'_, AppState>) -> PlaybackState {
    state.audio.get_state()
}

#[tauri::command]
fn clear_cover_cache(state: State<'_, AppState>) -> Result<usize, String> {
    state.covers.clear_disk_cache()
}

#[tauri::command]
async fn rebuild_sonic_index(state: State<'_, AppState>) -> Result<usize, String> {
    let dir = state.settings.read().library_dir.clone();
    let built = tokio::task::spawn_blocking(move || SonicAlbumIndex::build_from_dbs(&dir))
        .await
        .map_err(|e| format!("Build task failed: {e}"))??;
    let count = built.vectors.len();
    *state.sonic_index.write() = Some(built);
    Ok(count)
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn toggle_crate_album(state: State<'_, AppState>, album_id: String) -> Result<Vec<String>, String> {
    let mut cfg = state.settings.write();
    if let Some(pos) = cfg.crate_album_ids.iter().position(|id| id == &album_id) {
        cfg.crate_album_ids.remove(pos);
    } else {
        cfg.crate_album_ids.insert(0, album_id);
    }
    save_settings(&cfg)?;
    Ok(cfg.crate_album_ids.clone())
}

#[tauri::command]
fn clear_crate(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let mut cfg = state.settings.write();
    cfg.crate_album_ids.clear();
    save_settings(&cfg)?;
    Ok(Vec::new())
}

#[tauri::command]
fn get_crate_albums(state: State<'_, AppState>) -> Vec<AlbumSummary> {
    let ids = state.settings.read().crate_album_ids.clone();
    let cat = state.catalog.read();
    ids.iter()
        .filter_map(|id| cat.album_idx_by_id.get(id).map(|&idx| cat.albums[idx].clone()))
        .collect()
}

fn reveal_in_file_manager(path: &std::path::Path, select_file: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer");
        if select_file {
            cmd.arg(format!("/select,{}", path.display()));
        } else {
            cmd.arg(path);
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to launch Explorer: {e}"))?;
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("open");
        if select_file {
            cmd.arg("-R");
        }
        cmd.arg(path);
        cmd.spawn()
            .map_err(|e| format!("Failed to launch Finder: {e}"))?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let target = if select_file {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
async fn open_album_folder(state: State<'_, AppState>, album_id: String) -> Result<(), String> {
    let dir = state.settings.read().library_dir.clone();
    let tracks = tokio::task::spawn_blocking(move || get_album_tracks(&dir, &album_id))
        .await
        .map_err(|e| format!("Task join error: {e}"))??;

    if tracks.is_empty() {
        return Err("No tracks found for this album.".to_string());
    }

    for tr in &tracks {
        let full = PathBuf::from(&tr.file_path).join(&tr.filename);
        if full.exists() {
            return reveal_in_file_manager(&full, true);
        }
        let folder = PathBuf::from(&tr.file_path);
        if folder.exists() {
            return reveal_in_file_manager(&folder, false);
        }
    }

    Err(format!(
        "Album folder not found on disk: {}",
        tracks[0].file_path
    ))
}

#[tauri::command]
async fn export_crate_m3u(state: State<'_, AppState>) -> Result<String, String> {
    let (dir, ids) = {
        let cfg = state.settings.read();
        (cfg.library_dir.clone(), cfg.crate_album_ids.clone())
    };
    if ids.is_empty() {
        return Err("Your Discovery Crate is empty.".to_string());
    }

    let out_path = tokio::task::spawn_blocking(move || -> Result<PathBuf, String> {
        let mut lines = Vec::with_capacity(ids.len() * 12 + 1);
        lines.push("#EXTM3U".to_string());

        for album_id in &ids {
            if let Ok(mut tracks) = get_album_tracks(&dir, album_id) {
                tracks.sort_by(|a, b| {
                    a.disc_number
                        .cmp(&b.disc_number)
                        .then_with(|| a.track_number.cmp(&b.track_number))
                        .then_with(|| a.id.cmp(&b.id))
                });
                for tr in tracks {
                    let full = PathBuf::from(&tr.file_path).join(&tr.filename);
                    lines.push(format!(
                        "#EXTINF:{},{} - {}",
                        tr.time_seconds.max(0),
                        tr.artist,
                        tr.title
                    ));
                    lines.push(full.to_string_lossy().to_string());
                }
            }
        }

        if lines.len() <= 1 {
            return Err("No tracks found for the albums in your Discovery Crate.".to_string());
        }

        let target_dir = dirs::audio_dir()
            .or_else(dirs::desktop_dir)
            .or_else(dirs::home_dir)
            .unwrap_or_else(|| PathBuf::from("."));
        let _ = std::fs::create_dir_all(&target_dir);
        let file_path = target_dir.join("Cover Display Crate.m3u8");
        let content = format!("{}\r\n", lines.join("\r\n"));
        std::fs::write(&file_path, content)
            .map_err(|e| format!("Failed to write playlist: {e}"))?;
        Ok(file_path)
    })
    .await
    .map_err(|e| format!("Export task failed: {e}"))??;

    let _ = reveal_in_file_manager(&out_path, true);
    Ok(out_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = load_settings();
    let catalog = Arc::new(RwLock::new(Catalog {
        library_dir: settings.library_dir.clone(),
        ..Default::default()
    }));
    let covers = Arc::new(CoverCache::new());
    let sonic_index = Arc::new(RwLock::new(SonicAlbumIndex::load_cached()));

    let protocol_catalog = catalog.clone();
    let protocol_covers = covers.clone();
    let setup_catalog = catalog.clone();
    let setup_sonic = sonic_index.clone();
    let setup_dir = settings.library_dir.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .register_asynchronous_uri_scheme_protocol("cover", move |_ctx, request, responder| {
            let catalog_ref = protocol_catalog.clone();
            let covers_ref = protocol_covers.clone();
            let uri = request.uri().to_string();

            std::thread::spawn(move || {
                // Parse cover://localhost/<url_encoded_album_id>?s=256
                let without_scheme = uri
                    .strip_prefix("cover://localhost/")
                    .or_else(|| uri.strip_prefix("http://cover.localhost/"))
                    .or_else(|| uri.strip_prefix("https://cover.localhost/"))
                    .unwrap_or("");

                let (raw_id, query) = match without_scheme.split_once('?') {
                    Some((a, b)) => (a, b),
                    None => (without_scheme, ""),
                };

                let album_id = urlencoding::decode(raw_id)
                    .map(|c| c.into_owned())
                    .unwrap_or_else(|_| raw_id.to_string());

                let mut size: u32 = 256;
                for kv in query.split('&') {
                    if let Some(val) = kv.strip_prefix("s=") {
                        if let Ok(parsed) = val.parse::<u32>() {
                            size = parsed;
                        }
                    }
                }

                let cover_path = catalog_ref.read().cover_paths.get(&album_id).cloned();

                if let Some(path) = cover_path {
                    if let Some((bytes, mime)) = covers_ref.get_cover_bytes(&album_id, &path, size) {
                        let resp = Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, mime)
                            .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
                            .header("Access-Control-Allow-Origin", "*")
                            .body(bytes)
                            .unwrap();
                        responder.respond(resp);
                        return;
                    }
                }

                let resp = Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .header(header::CONTENT_TYPE, "text/plain")
                    .body(Vec::new())
                    .unwrap();
                responder.respond(resp);
            });
        })
        .setup(move |app| {
            let audio = AudioController::spawn(app.handle().clone(), settings.clone());
            app.manage(AppState {
                settings: RwLock::new(settings),
                catalog,
                covers,
                sonic_index,
                audio,
            });

            // Load the 74k+ album catalog asynchronously so the window renders instantly
            let app_handle = app.handle().clone();
            std::thread::Builder::new()
                .name("cover-display-loader".to_string())
                .spawn(move || {
                    if let Ok(loaded) = load_catalog_from_dir(&setup_dir) {
                        let sonic_ready = setup_sonic.read().is_some();
                        let ov = loaded.overview(sonic_ready);
                        *setup_catalog.write() = loaded;
                        let _ = app_handle.emit("catalog-ready", &ov);
                    }
                })
                .ok();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            update_settings,
            get_catalog_overview,
            reload_library,
            query_albums,
            get_album_window,
            get_scrubber_marks,
            suggest_artists,
            find_album_position,
            fetch_album_tracks,
            get_album_accent_color,
            preview_album,
            preview_track_at,
            playback_toggle_pause,
            playback_next_track,
            playback_prev_track,
            playback_stop,
            playback_set_pinned,
            playback_set_volume,
            get_playback_state,
            clear_cover_cache,
            rebuild_sonic_index,
            get_app_version,
            toggle_crate_album,
            clear_crate,
            get_crate_albums,
            open_album_folder,
            export_crate_m3u,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Cover Display");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::analyze_track_preview;
    use crate::config::{default_library_dir, PreviewMode};
    use rodio::{Decoder, Source};
    use std::fs::File;
    use std::io::BufReader;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    #[test]
    fn smoke_test_real_library_and_smart_preview() {
        let dir = default_library_dir();
        if !PathBuf::from(&dir).join("music-library.sqlite3").exists() {
            println!("Skipping local DB test (CI environment)");
            return;
        }

        let t0 = Instant::now();
        let mut cat = load_catalog_from_dir(&dir).expect("load_catalog_from_dir");
        println!(
            "Loaded {} albums ({} covers, {} genres) in {:?}",
            cat.albums.len(),
            cat.cover_paths.len(),
            cat.genres.len(),
            t0.elapsed()
        );
        assert!(cat.albums.len() > 1000);

        // Test 80s Synthpop filter
        let t1 = Instant::now();
        let synth_filter = AlbumFilter {
            genres: vec!["Synthpop".to_string()],
            year_min: Some(1980),
            year_max: Some(1989),
            sort_by: "year_asc".to_string(),
            ..Default::default()
        };
        let empty_crate = HashSet::new();
        let synth_res = cat.apply_filter(&synth_filter, None, &empty_crate);
        println!(
            "80s Synthpop filter: {} albums in {:?}",
            synth_res.total_count,
            t1.elapsed()
        );
        assert!(synth_res.total_count > 10);

        // Test Black Sabbath discography filter
        let t2 = Instant::now();
        let sabbath_filter = AlbumFilter {
            artist: Some("Black Sabbath".to_string()),
            sort_by: "year_asc".to_string(),
            ..Default::default()
        };
        let sabbath_res = cat.apply_filter(&sabbath_filter, None, &empty_crate);
        println!(
            "Black Sabbath discography: {} albums in {:?}",
            sabbath_res.total_count,
            t2.elapsed()
        );
        assert!(sabbath_res.total_count > 5);

        // Fetch tracks and test Smart Highlight analysis + MP3 seek!
        let first_album = &sabbath_res.initial_items[0];
        let tracks = get_album_tracks(&dir, &first_album.id).expect("get_album_tracks");
        assert!(!tracks.is_empty());
        let tr = &tracks[0];

        let cfg = AppSettings {
            library_dir: dir.clone(),
            preview_mode: PreviewMode::SmartHighlight,
            clip_duration_sec: 15,
            ..Default::default()
        };
        let t3 = Instant::now();
        let plan = analyze_track_preview(&dir, &tr.file_path, &tr.filename, tr.time_seconds, &cfg, None);
        println!(
            "Smart Highlight for '{} - {}': start={:.1}s, reason='{}', has_timeline={}, has_clap={}, loudness={:?}, clap={:?} in {:?}",
            tr.artist,
            tr.title,
            plan.start_sec,
            plan.reason,
            plan.has_timeline,
            plan.has_clap,
            plan.loudness_db,
            plan.clap_windows,
            t3.elapsed()
        );
        assert_eq!(plan.envelope.len(), 64);

        // Verify real MP3 decoding + seek works cleanly
        let mp3_path = PathBuf::from(&tr.file_path).join(&tr.filename);
        if mp3_path.exists() {
            let file = File::open(&mp3_path).expect("open mp3");
            let mut dec = Decoder::new(BufReader::new(file)).expect("decode mp3");
            let seek_res = dec.try_seek(Duration::from_secs_f32(plan.start_sec));
            println!("MP3 try_seek({:.1}s) -> {:?}", plan.start_sec, seek_res);
            assert!(seek_res.is_ok(), "MP3 seek failed: {:?}", seek_res);
            let sample = dec.convert_samples::<f32>().next();
            assert!(sample.is_some());
        }

        // Verify MusicBrainz Singles-first ordering on a-ha - Hunting High and Low
        let aha_filter = AlbumFilter {
            artist: Some("a-ha".to_string()),
            search: "Hunting High and Low".to_string(),
            ..Default::default()
        };
        let aha_res = cat.apply_filter(&aha_filter, None, &empty_crate);
        if let Some(aha_album) = aha_res.initial_items.first() {
            let aha_tracks = get_album_tracks(&dir, &aha_album.id).expect("a-ha tracks");
            let single_count = aha_tracks.iter().filter(|t| t.is_single).count();
            let ordered = audio::order_tracks(aha_tracks.clone(), &config::TrackOrder::Sequential, true);
            println!(
                "a-ha '{}' singles detected: {}/{} -> first 5 ordered: {:?}",
                aha_album.album,
                single_count,
                aha_tracks.len(),
                ordered
                    .iter()
                    .take(5)
                    .map(|t| format!("{} [single={}]", t.title, t.is_single))
                    .collect::<Vec<_>>()
            );
            assert!(single_count >= 3, "Expected at least 3 singles on Hunting High and Low");
            assert!(ordered[0].is_single);
            assert!(ordered[single_count - 1].is_single);
            if ordered.len() > single_count {
                assert!(!ordered[single_count].is_single);
            }
        }
    }
}
