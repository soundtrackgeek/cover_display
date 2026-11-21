use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PreviewMode {
    SmartHighlight,
    ClapBest,
    Start,
    Middle,
    Percentage,
    FixedOffset,
}

impl Default for PreviewMode {
    fn default() -> Self {
        Self::SmartHighlight
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrackOrder {
    Sequential,
    LovedFirst,
    RatedFirst,
    Shuffle,
}

impl Default for TrackOrder {
    fn default() -> Self {
        Self::Sequential
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AlbumFilter {
    #[serde(default)]
    pub search: String,
    #[serde(default)]
    pub genres: Vec<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub year_min: Option<i32>,
    #[serde(default)]
    pub year_max: Option<i32>,
    #[serde(default)]
    pub chart: Option<String>,
    #[serde(default)]
    pub min_rating: Option<i32>,
    #[serde(default)]
    pub loved_only: bool,
    #[serde(default)]
    pub has_cover_only: bool,
    #[serde(default = "default_sort_by")]
    pub sort_by: String,
    #[serde(default)]
    pub similar_to_album_id: Option<String>,
    #[serde(default)]
    pub random_seed: u64,
}

fn default_sort_by() -> String {
    "artist_asc".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFilterPreset {
    pub id: String,
    pub name: String,
    pub filter: AlbumFilter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_library_dir")]
    pub library_dir: String,
    #[serde(default = "default_clip_duration")]
    pub clip_duration_sec: u32,
    #[serde(default = "default_fade_ms")]
    pub fade_ms: u32,
    #[serde(default)]
    pub preview_mode: PreviewMode,
    #[serde(default = "default_preview_percentage")]
    pub preview_percentage: u32,
    #[serde(default = "default_fixed_offset")]
    pub preview_fixed_offset_sec: u32,
    #[serde(default)]
    pub track_order: TrackOrder,
    #[serde(default = "default_true")]
    pub singles_first: bool,
    #[serde(default = "default_true")]
    pub normalize_loudness: bool,
    #[serde(default = "default_volume")]
    pub volume: f32,
    #[serde(default = "default_hover_delay")]
    pub hover_delay_ms: u32,
    #[serde(default = "default_cover_flow_delay")]
    pub cover_flow_delay_ms: u32,
    #[serde(default = "default_wall_tile_size")]
    pub wall_tile_size: u32,
    #[serde(default = "default_wall_gap")]
    pub wall_gap: u32,
    #[serde(default = "default_true")]
    pub auto_play_on_select: bool,
    #[serde(default = "default_true")]
    pub auto_install_updates: bool,
    #[serde(default)]
    pub saved_filters: Vec<SavedFilterPreset>,
}

pub fn default_library_dir() -> String {
    if let Some(roaming) = dirs::config_dir() {
        let p = roaming.join("com.local.musiclibrary");
        if p.exists() {
            return p.to_string_lossy().to_string();
        }
    }
    r"C:\Users\jtill\AppData\Roaming\com.local.musiclibrary".to_string()
}

fn default_clip_duration() -> u32 {
    15
}
fn default_fade_ms() -> u32 {
    650
}
fn default_preview_percentage() -> u32 {
    35
}
fn default_fixed_offset() -> u32 {
    60
}
fn default_true() -> bool {
    true
}
fn default_volume() -> f32 {
    0.85
}
fn default_hover_delay() -> u32 {
    220
}
fn default_cover_flow_delay() -> u32 {
    260
}
fn default_wall_tile_size() -> u32 {
    172
}
fn default_wall_gap() -> u32 {
    6
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            library_dir: default_library_dir(),
            clip_duration_sec: default_clip_duration(),
            fade_ms: default_fade_ms(),
            preview_mode: PreviewMode::SmartHighlight,
            preview_percentage: default_preview_percentage(),
            preview_fixed_offset_sec: default_fixed_offset(),
            track_order: TrackOrder::Sequential,
            singles_first: true,
            normalize_loudness: true,
            volume: default_volume(),
            hover_delay_ms: default_hover_delay(),
            cover_flow_delay_ms: default_cover_flow_delay(),
            wall_tile_size: default_wall_tile_size(),
            wall_gap: default_wall_gap(),
            auto_play_on_select: true,
            auto_install_updates: true,
            saved_filters: Vec::new(),
        }
    }
}

pub fn app_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.soundtrackgeek.coverdisplay")
}

pub fn app_cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.soundtrackgeek.coverdisplay")
}

pub fn settings_path() -> PathBuf {
    app_config_dir().join("settings.json")
}

pub fn load_settings() -> AppSettings {
    let path = settings_path();
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(mut parsed) = serde_json::from_str::<AppSettings>(&raw) {
            parsed.clip_duration_sec = parsed.clip_duration_sec.clamp(5, 120);
            parsed.fade_ms = parsed.fade_ms.min(2500);
            parsed.volume = parsed.volume.clamp(0.0, 1.0);
            parsed.wall_tile_size = parsed.wall_tile_size.clamp(96, 320);
            parsed.wall_gap = parsed.wall_gap.min(24);
            return parsed;
        }
    }
    AppSettings::default()
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let dir = app_config_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create settings dir: {e}"))?;
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {e}"))?;
    fs::write(settings_path(), json).map_err(|e| format!("Failed to write settings: {e}"))?;
    Ok(())
}
