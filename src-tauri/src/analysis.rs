use crate::config::{app_cache_dir, AppSettings, PreviewMode};
use crate::library::{db_path, open_readonly_db};
use half::f16;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::PathBuf;

const TIMELINE_COLS: usize = 29;
const TIMELINE_BYTES_PER_ROW: usize = TIMELINE_COLS * 2; // 58 bytes of little-endian f16
const SONIC_DIM: usize = 23;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackPreviewPlan {
    pub start_sec: f32,
    pub clip_duration_sec: f32,
    pub track_duration_sec: f32,
    pub reason: String,
    pub envelope: Vec<f32>,
    pub clap_windows: Vec<f32>,
    pub loudness_db: Option<f32>,
    pub has_timeline: bool,
    pub has_clap: bool,
}

struct TimelineDecoded {
    rows: usize,
    chroma: Vec<[f32; 12]>,
    loudness_db: Vec<f32>,
    mfcc: Vec<[f32; 13]>, // mfcc0 (energy) + mfcc1..12
    track_loudness_db: Option<f32>,
}

fn lookup_audio_hash(library_dir: &str, file_path: &str, filename: &str) -> Option<String> {
    let conn = open_readonly_db(&db_path(library_dir, "music-analysis.sqlite3")).ok()?;
    let full_key = format!(
        "{}\\{}",
        file_path.trim_end_matches(['\\', '/']),
        filename
    )
    .to_lowercase();

    if let Ok(hash) = conn.query_row(
        "SELECT audio_hash FROM sonic_tracks WHERE track_key = ?1 LIMIT 1",
        [&full_key],
        |r| r.get::<_, String>(0),
    ) {
        return Some(hash);
    }

    conn.query_row(
        "SELECT audio_hash FROM sonic_tracks WHERE directory = ?1 AND filename = ?2 LIMIT 1",
        [file_path, filename],
        |r| r.get::<_, String>(0),
    )
    .ok()
}

fn lookup_clap_windows(library_dir: &str, audio_hash: &str) -> Vec<f32> {
    let conn = match open_readonly_db(&db_path(library_dir, "music-clap.sqlite3")) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let raw: Option<String> = conn
        .query_row(
            "SELECT windows FROM clap_audio WHERE audio_hash = ?1 AND windows IS NOT NULL LIMIT 1",
            [audio_hash],
            |r| r.get(0),
        )
        .ok();

    if let Some(json_str) = raw {
        if let Ok(nums) = serde_json::from_str::<Vec<f32>>(&json_str) {
            return nums;
        }
    }
    Vec::new()
}

fn lookup_timeline(library_dir: &str, audio_hash: &str) -> Option<TimelineDecoded> {
    let conn = open_readonly_db(&db_path(library_dir, "music-timelines.sqlite3")).ok()?;
    let (rows_i, left_db, right_db, blob): (i64, Option<f64>, Option<f64>, Vec<u8>) = conn
        .query_row(
            "SELECT rows, left_db, right_db, data FROM timelines WHERE audio_hash = ?1 AND data IS NOT NULL LIMIT 1",
            [audio_hash],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok()?;

    let rows = (rows_i.max(0) as usize).min(blob.len() / TIMELINE_BYTES_PER_ROW);
    if rows < 4 {
        return None;
    }

    let mut chroma = Vec::with_capacity(rows);
    let mut loudness_db = Vec::with_capacity(rows);
    let mut mfcc = Vec::with_capacity(rows);

    for r in 0..rows {
        let base = r * TIMELINE_BYTES_PER_ROW;
        let read_f16 = |col: usize| -> f32 {
            let off = base + col * 2;
            let val = f16::from_le_bytes([blob[off], blob[off + 1]]).to_f32();
            if val.is_finite() { val } else { 0.0 }
        };

        let mut ch = [0.0f32; 12];
        for c in 0..12 {
            ch[c] = read_f16(c);
        }
        chroma.push(ch);

        let ldb = read_f16(13);
        loudness_db.push(ldb);

        let mut mf = [0.0f32; 13];
        for m in 0..13 {
            mf[m] = read_f16(16 + m);
        }
        mfcc.push(mf);
    }

    let track_loudness_db = match (left_db, right_db) {
        (Some(l), Some(r)) if l.is_finite() && r.is_finite() => Some(((l + r) * 0.5) as f32),
        (Some(l), None) if l.is_finite() => Some(l as f32),
        (None, Some(r)) if r.is_finite() => Some(r as f32),
        _ => None,
    };

    Some(TimelineDecoded {
        rows,
        chroma,
        loudness_db,
        mfcc,
        track_loudness_db,
    })
}

fn build_envelope(tl: &TimelineDecoded, bins: usize) -> Vec<f32> {
    if tl.rows == 0 || bins == 0 {
        return Vec::new();
    }
    // Convert dB (-65..-4) to perceptually pleasing 0..1 amplitude bars
    let mut raw = Vec::with_capacity(bins);
    for b in 0..bins {
        let s = (b * tl.rows) / bins;
        let e = (((b + 1) * tl.rows) / bins).max(s + 1).min(tl.rows);
        let mut sum = 0.0f32;
        for i in s..e {
            let db = tl.loudness_db[i].clamp(-65.0, -2.0);
            sum += (db + 65.0) / 63.0;
        }
        raw.push(sum / (e - s) as f32);
    }
    // Mild contrast stretch so waveforms look crisp & expressive
    let min_v = raw.iter().copied().fold(1.0f32, f32::min);
    let max_v = raw.iter().copied().fold(0.0f32, f32::max);
    let span = (max_v - min_v).max(0.12);
    raw.into_iter()
        .map(|v| (((v - min_v) / span).clamp(0.0, 1.0)).powf(0.85).max(0.08))
        .collect()
}

fn cosine_sim(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for (&x, &y) in a.iter().zip(b.iter()) {
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    let denom = (na * nb).sqrt();
    if denom < 1e-6 { 0.0 } else { (dot / denom).clamp(-1.0, 1.0) }
}

fn feature_vec_for_range(tl: &TimelineDecoded, start: usize, end: usize) -> [f32; 24] {
    let mut out = [0.0f32; 24];
    let count = (end - start).max(1) as f32;
    for i in start..end {
        for c in 0..12 {
            out[c] += tl.chroma[i][c];
        }
        for m in 0..12 {
            // MFCC 1..12 scaled gently to sit on same magnitude as chroma
            out[12 + m] += tl.mfcc[i][m + 1] * 0.04;
        }
    }
    for v in &mut out {
        *v /= count;
    }
    out
}

fn pick_smart_highlight(
    tl: &TimelineDecoded,
    clap_windows: &[f32],
    clip_dur: usize,
) -> (f32, String) {
    let n = tl.rows;
    let win = clip_dur.clamp(4, n);
    if n <= win + 4 {
        return (0.0, "Full Track (Short)".to_string());
    }

    // Avoid extreme intro/outro tails when track has breathing room
    let min_t = ((n as f32 * 0.08).round() as usize).min(n.saturating_sub(win + 1));
    let max_t = ((n as f32 * 0.88).round() as usize)
        .saturating_sub(win)
        .max(min_t);

    // Precompute normalized per-second energy (combines RMS dB + MFCC0)
    let mut sec_energy = vec![0.0f32; n];
    let mut min_db = f32::MAX;
    let mut max_db = f32::MIN;
    for &db in &tl.loudness_db {
        if db > -90.0 {
            if db < min_db { min_db = db; }
            if db > max_db { max_db = db; }
        }
    }
    let db_span = (max_db - min_db).max(6.0);
    for i in 0..n {
        let norm_db = ((tl.loudness_db[i] - min_db) / db_span).clamp(0.0, 1.0);
        let norm_e = ((tl.mfcc[i][0] + 130.0) / 85.0).clamp(0.0, 1.0);
        sec_energy[i] = 0.65 * norm_db + 0.35 * norm_e;
    }

    // Build 6-second reference chunks across the track for chorus/hook repetition detection
    let chunk_step = 6usize;
    let mut chunks: Vec<(usize, [f32; 24], f32)> = Vec::new();
    let mut pos = 0usize;
    while pos + chunk_step <= n {
        let fv = feature_vec_for_range(tl, pos, pos + chunk_step);
        let avg_e: f32 = sec_energy[pos..pos + chunk_step].iter().sum::<f32>() / chunk_step as f32;
        chunks.push((pos, fv, avg_e));
        pos += chunk_step;
    }

    let step = if n > 600 { 2 } else { 1 };
    let mut best_t = min_t;
    let mut best_score = f32::NEG_INFINITY;
    let mut best_hook = 0.0f32;
    let mut best_clap_hit = false;

    let mut t = min_t;
    while t <= max_t {
        let end = (t + win).min(n);
        // 1. Window loudness & consistency (penalize quiet dips inside preview)
        let mut e_sum = 0.0f32;
        let mut e_min = 1.0f32;
        for &e in &sec_energy[t..end] {
            e_sum += e;
            if e < e_min { e_min = e; }
        }
        let e_mean = e_sum / (end - t) as f32;
        let energy_score = 0.72 * e_mean + 0.28 * e_min;

        // 2. Chorus / repeating hook self-similarity (top-2 non-overlapping matches)
        let wvec = feature_vec_for_range(tl, t, end);
        let mut top1 = 0.0f32;
        let mut top2 = 0.0f32;
        for (cpos, cvec, ce) in &chunks {
            // Must be at least `win` seconds away from candidate window
            if *cpos + chunk_step + 4 >= t && *cpos <= end + 4 {
                continue;
            }
            if *ce < 0.25 {
                continue;
            }
            let sim = cosine_sim(&wvec, cvec).max(0.0);
            if sim > top1 {
                top2 = top1;
                top1 = sim;
            } else if sim > top2 {
                top2 = sim;
            }
        }
        let hook_score = if top2 > 0.0 {
            0.6 * top1 + 0.4 * top2
        } else {
            top1
        };

        // 3. CLAP representative anchor affinity
        let mut clap_score = 0.0f32;
        for &cw in clap_windows {
            let d = (t as f32 - cw).abs();
            let g = (-0.5 * (d / 14.0).powi(2)).exp();
            if g > clap_score {
                clap_score = g;
            }
        }

        // Mild preference for first/main chorus region (~22%-65% of song) over late outro reprise
        let rel = t as f32 / n as f32;
        let pos_prior = if (0.20..=0.68).contains(&rel) {
            1.0
        } else {
            0.85
        };

        let total = (0.48 * energy_score + 0.36 * hook_score + 0.16 * clap_score) * pos_prior;
        if total > best_score {
            best_score = total;
            best_t = t;
            best_hook = hook_score;
            best_clap_hit = clap_score > 0.55;
        }
        t += step;
    }

    let reason = if best_hook > 0.72 && best_clap_hit {
        "Smart Highlight · Chorus + CLAP".to_string()
    } else if best_hook > 0.72 {
        "Smart Highlight · Chorus Hook".to_string()
    } else if best_clap_hit {
        "Smart Highlight · Peak + CLAP".to_string()
    } else {
        "Smart Highlight · Peak Energy".to_string()
    };

    (best_t as f32, reason)
}

pub fn analyze_track_preview(
    library_dir: &str,
    file_path: &str,
    filename: &str,
    duration_sec: i32,
    settings: &AppSettings,
    custom_start_override: Option<f32>,
) -> TrackPreviewPlan {
    let track_dur = (duration_sec.max(1)) as f32;
    let clip_dur = (settings.clip_duration_sec.clamp(5, 120) as f32).min(track_dur);
    let max_valid_start = (track_dur - clip_dur).max(0.0);

    let audio_hash = lookup_audio_hash(library_dir, file_path, filename);
    let timeline = audio_hash
        .as_deref()
        .and_then(|h| lookup_timeline(library_dir, h));
    let clap_windows = audio_hash
        .as_deref()
        .map(|h| lookup_clap_windows(library_dir, h))
        .unwrap_or_default();

    let effective_dur = timeline
        .as_ref()
        .map(|tl| (tl.rows as f32).max(track_dur))
        .unwrap_or(track_dur);
    let max_start = (effective_dur - clip_dur).max(0.0).min(max_valid_start.max(0.0));

    let envelope = timeline
        .as_ref()
        .map(|tl| build_envelope(tl, 64))
        .unwrap_or_else(|| vec![0.45; 64]);

    let loudness_db = timeline.as_ref().and_then(|tl| tl.track_loudness_db);
    let has_timeline = timeline.is_some();
    let has_clap = !clap_windows.is_empty();

    if let Some(custom) = custom_start_override {
        return TrackPreviewPlan {
            start_sec: custom.clamp(0.0, max_start),
            clip_duration_sec: clip_dur,
            track_duration_sec: effective_dur,
            reason: "Manual Scrub".to_string(),
            envelope,
            clap_windows,
            loudness_db,
            has_timeline,
            has_clap,
        };
    }

    let (raw_start, reason) = match settings.preview_mode {
        PreviewMode::Start => (0.0, "From Start".to_string()),
        PreviewMode::Middle => (
            ((effective_dur - clip_dur) * 0.5).max(0.0),
            "Middle of Track".to_string(),
        ),
        PreviewMode::Percentage => {
            let pct = (settings.preview_percentage.min(95) as f32) / 100.0;
            (
                (effective_dur * pct).min(max_start),
                format!("At {}% of Track", settings.preview_percentage),
            )
        }
        PreviewMode::FixedOffset => {
            let off = settings.preview_fixed_offset_sec as f32;
            let clamped = off.min(max_start);
            let mins = (clamped as u32) / 60;
            let secs = (clamped as u32) % 60;
            (clamped, format!("Fixed Offset · {mins}:{secs:02}"))
        }
        PreviewMode::ClapBest => {
            if !clap_windows.is_empty() {
                if let Some(ref tl) = timeline {
                    let mut best_w = clap_windows[clap_windows.len() / 2];
                    let mut best_e = f32::NEG_INFINITY;
                    let win = clip_dur as usize;
                    for &w in &clap_windows {
                        let s = (w as usize).min(tl.rows.saturating_sub(1));
                        let e = (s + win).min(tl.rows).max(s + 1);
                        let avg_db: f32 =
                            tl.loudness_db[s..e].iter().sum::<f32>() / (e - s) as f32;
                        if avg_db > best_e {
                            best_e = avg_db;
                            best_w = w;
                        }
                    }
                    (best_w, "CLAP Best Window".to_string())
                } else {
                    let mid = clap_windows[clap_windows.len() / 2];
                    (mid, "CLAP Representative".to_string())
                }
            } else if let Some(ref tl) = timeline {
                pick_smart_highlight(tl, &[], clip_dur as usize)
            } else {
                ((effective_dur * 0.35).min(max_start), "Fallback · 35%".to_string())
            }
        }
        PreviewMode::SmartHighlight => {
            if let Some(ref tl) = timeline {
                pick_smart_highlight(tl, &clap_windows, clip_dur as usize)
            } else if !clap_windows.is_empty() {
                (
                    clap_windows[clap_windows.len() / 2],
                    "CLAP Representative".to_string(),
                )
            } else {
                (
                    (effective_dur * 0.35).min(max_start),
                    "Smart Fallback · 35%".to_string(),
                )
            }
        }
    };

    TrackPreviewPlan {
        start_sec: raw_start.clamp(0.0, max_start),
        clip_duration_sec: clip_dur,
        track_duration_sec: effective_dur,
        reason,
        envelope,
        clap_windows,
        loudness_db,
        has_timeline,
        has_clap,
    }
}

// =========================================================================
// Sonic Similarity Index ("Similar Vibe") backed by music-analysis.sqlite3
// =========================================================================

pub struct SonicAlbumIndex {
    pub vectors: HashMap<String, [f32; SONIC_DIM]>,
}

const SONIC_CACHE_MAGIC: &[u8; 8] = b"CDSONIC1";

fn sonic_cache_path() -> PathBuf {
    app_cache_dir().join("sonic_album_vectors_v1.bin")
}

impl SonicAlbumIndex {
    pub fn load_cached() -> Option<Self> {
        let path = sonic_cache_path();
        let file = fs::File::open(path).ok()?;
        let mut r = BufReader::new(file);
        let mut magic = [0u8; 8];
        r.read_exact(&mut magic).ok()?;
        if &magic != SONIC_CACHE_MAGIC {
            return None;
        }
        let mut count_buf = [0u8; 4];
        r.read_exact(&mut count_buf).ok()?;
        let count = u32::from_le_bytes(count_buf) as usize;
        let mut vectors = HashMap::with_capacity(count);
        for _ in 0..count {
            let mut len_buf = [0u8; 2];
            r.read_exact(&mut len_buf).ok()?;
            let id_len = u16::from_le_bytes(len_buf) as usize;
            let mut id_bytes = vec![0u8; id_len];
            r.read_exact(&mut id_bytes).ok()?;
            let id = String::from_utf8(id_bytes).ok()?;
            let mut vec_buf = [0u8; SONIC_DIM * 4];
            r.read_exact(&mut vec_buf).ok()?;
            let mut v = [0.0f32; SONIC_DIM];
            for i in 0..SONIC_DIM {
                v[i] = f32::from_le_bytes([
                    vec_buf[i * 4],
                    vec_buf[i * 4 + 1],
                    vec_buf[i * 4 + 2],
                    vec_buf[i * 4 + 3],
                ]);
            }
            vectors.insert(id, v);
        }
        Some(Self { vectors })
    }

    pub fn save_cached(&self) -> Result<(), String> {
        let dir = app_cache_dir();
        fs::create_dir_all(&dir).map_err(|e| format!("Failed to create cache dir: {e}"))?;
        let file = fs::File::create(sonic_cache_path())
            .map_err(|e| format!("Failed to create sonic cache: {e}"))?;
        let mut w = BufWriter::new(file);
        w.write_all(SONIC_CACHE_MAGIC).map_err(|e| e.to_string())?;
        let count = self.vectors.len() as u32;
        w.write_all(&count.to_le_bytes()).map_err(|e| e.to_string())?;
        for (id, v) in &self.vectors {
            let bytes = id.as_bytes();
            if bytes.len() > u16::MAX as usize {
                continue;
            }
            w.write_all(&(bytes.len() as u16).to_le_bytes())
                .map_err(|e| e.to_string())?;
            w.write_all(bytes).map_err(|e| e.to_string())?;
            for &x in v {
                w.write_all(&x.to_le_bytes()).map_err(|e| e.to_string())?;
            }
        }
        w.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn build_from_dbs(library_dir: &str) -> Result<Self, String> {
        let lib = open_readonly_db(&db_path(library_dir, "music-library.sqlite3"))?;
        let ana = open_readonly_db(&db_path(library_dir, "music-analysis.sqlite3"))?;

        // Step 1: Map normalized directory -> album_id from music-library.sqlite3
        let mut dir_to_album: HashMap<String, String> = HashMap::with_capacity(80_000);
        {
            let mut stmt = lib
                .prepare("SELECT DISTINCT file_path, album_id FROM tracks WHERE file_path IS NOT NULL")
                .map_err(|e| format!("Failed to scan track dirs: {e}"))?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;
            for row in rows.flatten() {
                let d = row.0.trim_end_matches(['\\', '/']).to_lowercase();
                dir_to_album.entry(d).or_insert(row.1);
            }
        }

        // Optional weights from sonic_profiles
        let mut weights = [1.0f32; SONIC_DIM];
        if let Ok(w_json) = ana.query_row(
            "SELECT weights FROM sonic_profiles LIMIT 1",
            [],
            |r| r.get::<_, String>(0),
        ) {
            if let Ok(parsed) = serde_json::from_str::<Vec<f32>>(&w_json) {
                for (i, w) in parsed.iter().take(SONIC_DIM).enumerate() {
                    if w.is_finite() && *w > 0.0 {
                        weights[i] = w.sqrt();
                    }
                }
            }
        }

        // Step 2: Stream sonic_tracks joined with sonic_audio and accumulate album centroids
        let mut accum: HashMap<String, ([f32; SONIC_DIM], u32)> = HashMap::with_capacity(75_000);
        {
            let mut stmt = ana
                .prepare(
                    "SELECT t.directory, a.features
                     FROM sonic_tracks t
                     JOIN sonic_audio a ON t.audio_hash = a.audio_hash AND t.profile = a.profile",
                )
                .map_err(|e| format!("Failed to query sonic features: {e}"))?;

            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?;

            for row in rows.flatten() {
                let d = row.0.trim_end_matches(['\\', '/']).to_lowercase();
                let Some(album_id) = dir_to_album.get(&d) else {
                    continue;
                };
                if let Some(parsed) = parse_f32_array_23(&row.1) {
                    let entry = accum
                        .entry(album_id.clone())
                        .or_insert_with(|| ([0.0f32; SONIC_DIM], 0));
                    for i in 0..SONIC_DIM {
                        entry.0[i] += parsed[i];
                    }
                    entry.1 += 1;
                }
            }
        }

        // Step 3: Average, weight, and L2-normalize each album vector
        let mut vectors = HashMap::with_capacity(accum.len());
        for (aid, (mut sum, cnt)) in accum {
            if cnt == 0 {
                continue;
            }
            let inv = 1.0 / cnt as f32;
            let mut norm_sq = 0.0f32;
            for i in 0..SONIC_DIM {
                sum[i] = (sum[i] * inv) * weights[i];
                norm_sq += sum[i] * sum[i];
            }
            let norm = norm_sq.sqrt();
            if norm > 1e-6 {
                for v in &mut sum {
                    *v /= norm;
                }
                vectors.insert(aid, sum);
            }
        }

        let idx = Self { vectors };
        let _ = idx.save_cached();
        Ok(idx)
    }

    pub fn find_similar(&self, target_album_id: &str, limit: usize) -> Vec<(String, f32)> {
        let Some(target) = self.vectors.get(target_album_id) else {
            return Vec::new();
        };
        let mut scored: Vec<(String, f32)> = Vec::with_capacity(self.vectors.len());
        for (aid, vec) in &self.vectors {
            if aid == target_album_id {
                scored.push((aid.clone(), 1.0));
                continue;
            }
            let mut dot = 0.0f32;
            for i in 0..SONIC_DIM {
                dot += target[i] * vec[i];
            }
            scored.push((aid.clone(), dot));
        }
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        scored
    }
}

fn parse_f32_array_23(raw: &str) -> Option<[f32; SONIC_DIM]> {
    let trimmed = raw.trim().trim_start_matches('[').trim_end_matches(']');
    let mut out = [0.0f32; SONIC_DIM];
    let mut i = 0;
    for part in trimmed.split(',') {
        if i >= SONIC_DIM {
            break;
        }
        let v: f32 = part.trim().parse().ok()?;
        out[i] = if v.is_finite() { v } else { 0.0 };
        i += 1;
    }
    if i >= 16 { Some(out) } else { None }
}
