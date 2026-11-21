use crate::config::app_cache_dir;
use image::imageops::FilterType;
use image::ImageFormat;
use lru::LruCache;
use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Cursor;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};

pub struct CoverCache {
    mem_lru: Mutex<LruCache<String, Vec<u8>>>,
    accent_lru: Mutex<LruCache<String, [u8; 3]>>,
    disk_dir: PathBuf,
}

impl CoverCache {
    pub fn new() -> Self {
        let disk_dir = app_cache_dir().join("thumb-cache");
        let _ = fs::create_dir_all(&disk_dir);
        Self {
            mem_lru: Mutex::new(LruCache::new(NonZeroUsize::new(600).unwrap())),
            accent_lru: Mutex::new(LruCache::new(NonZeroUsize::new(1000).unwrap())),
            disk_dir,
        }
    }

    pub fn clear_disk_cache(&self) -> Result<usize, String> {
        self.mem_lru.lock().clear();
        self.accent_lru.lock().clear();
        let mut removed = 0usize;
        if let Ok(entries) = fs::read_dir(&self.disk_dir) {
            for e in entries.flatten() {
                if fs::remove_file(e.path()).is_ok() {
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }

    pub fn get_cover_bytes(
        &self,
        album_id: &str,
        source_path: &str,
        target_size: u32,
    ) -> Option<(Vec<u8>, &'static str)> {
        let size_bucket = if target_size <= 280 { 256u32 } else { 640u32 };
        let key = format!("{album_id}:{size_bucket}");

        if let Some(hit) = self.mem_lru.lock().get(&key).cloned() {
            return Some((hit, "image/jpeg"));
        }

        let disk_file = self.disk_thumb_path(album_id, size_bucket);
        if let Ok(bytes) = fs::read(&disk_file) {
            self.mem_lru.lock().put(key, bytes.clone());
            return Some((bytes, "image/jpeg"));
        }

        let raw = read_source_image(source_path)?;

        // For large hero covers (640px), if original file is already compact JPEG (<260KB), serve directly!
        if size_bucket >= 640 && raw.len() < 260_000 && raw.starts_with(&[0xFF, 0xD8]) {
            self.mem_lru.lock().put(key, raw.clone());
            return Some((raw, "image/jpeg"));
        }

        // Decode & fast resize to square thumbnail
        let img = image::load_from_memory(&raw).ok()?;
        let resized = if img.width() > size_bucket || img.height() > size_bucket {
            img.resize(size_bucket, size_bucket, FilterType::Triangle)
        } else {
            img
        };

        let mut out = Cursor::new(Vec::with_capacity(28_000));
        resized.to_rgb8().write_to(&mut out, ImageFormat::Jpeg).ok()?;
        let jpeg_bytes = out.into_inner();

        let _ = fs::write(&disk_file, &jpeg_bytes);
        self.mem_lru.lock().put(key, jpeg_bytes.clone());
        Some((jpeg_bytes, "image/jpeg"))
    }

    pub fn get_accent_color(&self, album_id: &str, source_path: Option<&str>) -> [u8; 3] {
        if let Some(&rgb) = self.accent_lru.lock().get(album_id) {
            return rgb;
        }
        let fallback = [217, 138, 46]; // warm studio amber
        let Some(src) = source_path else {
            return fallback;
        };

        let bytes = self
            .get_cover_bytes(album_id, src, 256)
            .map(|(b, _)| b)
            .or_else(|| read_source_image(src));

        let Some(data) = bytes else {
            return fallback;
        };
        let Ok(img) = image::load_from_memory(&data) else {
            return fallback;
        };

        let small = img.resize_exact(24, 24, FilterType::Nearest).to_rgb8();
        // Pick weighted vibrant color (favors saturated mid-bright pixels, avoids muddy black/white)
        let mut r_sum = 0.0f32;
        let mut g_sum = 0.0f32;
        let mut b_sum = 0.0f32;
        let mut w_sum = 0.0f32;

        for p in small.pixels() {
            let r = p[0] as f32 / 255.0;
            let g = p[1] as f32 / 255.0;
            let b = p[2] as f32 / 255.0;
            let max_c = r.max(g).max(b);
            let min_c = r.min(g).min(b);
            let sat = if max_c > 0.001 {
                (max_c - min_c) / max_c
            } else {
                0.0
            };
            let luma = 0.299 * r + 0.587 * g + 0.114 * b;
            let luma_weight = if (0.14..=0.86).contains(&luma) { 1.0 } else { 0.15 };
            let weight = (0.15 + sat * sat * 3.0) * luma_weight;
            r_sum += r * weight;
            g_sum += g * weight;
            b_sum += b * weight;
            w_sum += weight;
        }

        let rgb = if w_sum > 0.01 {
            let mut r = (r_sum / w_sum).clamp(0.0, 1.0);
            let mut g = (g_sum / w_sum).clamp(0.0, 1.0);
            let mut b = (b_sum / w_sum).clamp(0.0, 1.0);
            // Boost subtle luminance so dark covers still emit an atmospheric glow
            let max_c = r.max(g).max(b);
            if max_c < 0.45 && max_c > 0.05 {
                let scale = 0.55 / max_c;
                r = (r * scale).min(1.0);
                g = (g * scale).min(1.0);
                b = (b * scale).min(1.0);
            }
            [(r * 255.0) as u8, (g * 255.0) as u8, (b * 255.0) as u8]
        } else {
            fallback
        };

        self.accent_lru.lock().put(album_id.to_string(), rgb);
        rgb
    }

    fn disk_thumb_path(&self, album_id: &str, size: u32) -> PathBuf {
        let mut hasher = Sha256::new();
        hasher.update(album_id.as_bytes());
        let hex_id = hex::encode(hasher.finalize());
        self.disk_dir.join(format!("{}_{}.jpg", &hex_id[..24], size))
    }
}

fn read_source_image(source_path: &str) -> Option<Vec<u8>> {
    if let Ok(b) = fs::read(Path::new(source_path)) {
        return Some(b);
    }
    if let Some(stripped) = source_path.strip_prefix(r"\\?\") {
        if let Ok(b) = fs::read(Path::new(stripped)) {
            return Some(b);
        }
    }
    None
}
