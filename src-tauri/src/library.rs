use crate::config::AlbumFilter;
use rand::seq::SliceRandom;
use rand::SeedableRng;
use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSummary {
    pub id: String,
    pub album: String,
    pub artist: String,
    pub artist_key: String,
    pub genre: String,
    pub genre_norm: String,
    pub publisher: String,
    pub year: Option<i32>,
    pub total_tracks: i32,
    pub total_seconds: i32,
    pub loved_tracks: i32,
    pub rating: Option<i32>,
    pub album_score: Option<f64>,
    pub billboard_rank: Option<i32>,
    pub official_uk_rank: Option<i32>,
    pub vg_lista_rank: Option<i32>,
    pub has_cover: bool,
    #[serde(skip_serializing, skip_deserializing)]
    pub search_blob: String,
    #[serde(skip_serializing, skip_deserializing)]
    pub sort_artist: String,
    #[serde(skip_serializing, skip_deserializing)]
    pub sort_album: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInfo {
    pub id: i64,
    pub album_id: String,
    pub disc_number: i32,
    pub track_number: i32,
    pub title: String,
    pub artist: String,
    pub time_seconds: i32,
    pub rating: Option<i32>,
    pub loved: bool,
    pub file_path: String,
    pub filename: String,
    pub billboard_single_rank: Option<i32>,
    pub official_uk_rank: Option<i32>,
    pub vg_lista_rank: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenreFacet {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistSuggestion {
    pub name: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbStatus {
    pub library_dir: String,
    pub library_exists: bool,
    pub analysis_exists: bool,
    pub clap_exists: bool,
    pub timelines_exists: bool,
    pub total_albums: usize,
    pub total_tracks: usize,
    pub covers_available: usize,
    pub sonic_index_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogOverview {
    pub status: DbStatus,
    pub genres: Vec<GenreFacet>,
    pub year_min: i32,
    pub year_max: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub query_id: u64,
    pub total_count: usize,
    pub initial_items: Vec<AlbumSummary>,
    pub similar_source: Option<AlbumSummary>,
    pub similarity_scores: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrubberMark {
    pub index: usize,
    pub label: String,
    pub sublabel: String,
    pub year: Option<i32>,
}

pub struct Catalog {
    pub library_dir: String,
    pub albums: Vec<AlbumSummary>,
    pub album_idx_by_id: HashMap<String, usize>,
    pub cover_paths: HashMap<String, String>,
    pub genres: Vec<GenreFacet>,
    pub artists_index: Vec<(String, String, usize)>, // (lowercase, display, album_count)
    pub year_min: i32,
    pub year_max: i32,
    pub total_tracks: usize,
    pub active_query_id: u64,
    pub filtered_indices: Vec<usize>,
    pub filtered_scores: HashMap<usize, f32>,
}

impl Default for Catalog {
    fn default() -> Self {
        Self {
            library_dir: String::new(),
            albums: Vec::new(),
            album_idx_by_id: HashMap::new(),
            cover_paths: HashMap::new(),
            genres: Vec::new(),
            artists_index: Vec::new(),
            year_min: 1950,
            year_max: 2026,
            total_tracks: 0,
            active_query_id: 0,
            filtered_indices: Vec::new(),
            filtered_scores: HashMap::new(),
        }
    }
}

pub fn open_readonly_db(path: &Path) -> Result<Connection, String> {
    if !path.exists() {
        return Err(format!("Database not found: {}", path.display()));
    }
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)
        .map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    let _ = conn.busy_timeout(std::time::Duration::from_millis(3000));
    let _ = conn.execute_batch("PRAGMA query_only = ON;");
    // Register custom unicode_lower function used by some expression indexes in music-library.sqlite3
    let _ = conn.create_scalar_function(
        "unicode_lower",
        1,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let val: Option<String> = ctx.get(0)?;
            Ok(val.map(|s| s.to_lowercase()))
        },
    );
    Ok(conn)
}

pub fn db_path(library_dir: &str, filename: &str) -> PathBuf {
    Path::new(library_dir).join(filename)
}

pub fn load_catalog_from_dir(library_dir: &str) -> Result<Catalog, String> {
    let lib_db = db_path(library_dir, "music-library.sqlite3");
    let conn = open_readonly_db(&lib_db)?;

    let total_tracks: usize = conn
        .query_row("SELECT COALESCE(SUM(total_tracks), 0) FROM albums", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0)
        .max(0) as usize;

    let mut stmt = conn
        .prepare(
            "SELECT
                a.id,
                COALESCE(a.album, ''),
                COALESCE(a.album_artist_display, ''),
                COALESCE(a.artist_identity_key, ''),
                COALESCE(a.canonical_genre, ''),
                COALESCE(a.genre_normalized, ''),
                COALESCE(a.publisher, ''),
                COALESCE(a.year, a.release_year),
                COALESCE(a.total_tracks, 0),
                COALESCE(a.total_seconds, 0),
                COALESCE(a.loved_tracks, 0),
                COALESCE(a.effective_album_rating, a.album_rating, a.calculated_album_rating),
                a.album_score,
                a.billboard_rank,
                a.official_uk_rank,
                a.vg_lista_rank,
                c.cache_path
            FROM albums a
            LEFT JOIN album_covers c ON a.id = c.album_id",
        )
        .map_err(|e| format!("Failed to prepare albums query: {e}"))?;

    let mut albums = Vec::with_capacity(80_000);
    let mut album_idx_by_id = HashMap::with_capacity(80_000);
    let mut cover_paths = HashMap::with_capacity(80_000);
    let mut genre_counts: HashMap<String, usize> = HashMap::new();
    let mut artist_counts: HashMap<String, (String, usize)> = HashMap::new();
    let mut year_min = 2026i32;
    let mut year_max = 1950i32;

    let rows = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let album: String = row.get(1)?;
            let artist: String = row.get(2)?;
            let artist_key: String = row.get(3)?;
            let genre: String = row.get(4)?;
            let genre_norm: String = row.get(5)?;
            let publisher: String = row.get(6)?;
            let year: Option<i32> = row.get(7)?;
            let total_tracks: i32 = row.get(8)?;
            let total_seconds: i32 = row.get(9)?;
            let loved_tracks: i32 = row.get(10)?;
            let rating: Option<i32> = row.get(11)?;
            let album_score: Option<f64> = row.get(12)?;
            let billboard_rank: Option<i32> = row.get(13)?;
            let official_uk_rank: Option<i32> = row.get(14)?;
            let vg_lista_rank: Option<i32> = row.get(15)?;
            let cache_path: Option<String> = row.get(16)?;
            Ok((
                id,
                album,
                artist,
                artist_key,
                genre,
                genre_norm,
                publisher,
                year,
                total_tracks,
                total_seconds,
                loved_tracks,
                rating,
                album_score,
                billboard_rank,
                official_uk_rank,
                vg_lista_rank,
                cache_path,
            ))
        })
        .map_err(|e| format!("Failed to read albums: {e}"))?;

    for item in rows {
        let (
            id,
            album,
            artist,
            artist_key,
            genre,
            genre_norm,
            publisher,
            year,
            total_tracks_val,
            total_seconds,
            loved_tracks,
            rating,
            album_score,
            billboard_rank,
            official_uk_rank,
            vg_lista_rank,
            cache_path,
        ) = item.map_err(|e| format!("Row read error: {e}"))?;

        let has_cover = cache_path
            .as_ref()
            .map(|p| !p.trim().is_empty())
            .unwrap_or(false);
        if let Some(cp) = cache_path {
            if !cp.trim().is_empty() {
                cover_paths.insert(id.clone(), cp);
            }
        }

        if !genre.is_empty() {
            *genre_counts.entry(genre.clone()).or_insert(0) += 1;
        }

        if !artist.is_empty() {
            let low = artist.to_lowercase();
            let entry = artist_counts
                .entry(low)
                .or_insert_with(|| (artist.clone(), 0));
            entry.1 += 1;
        }

        if let Some(y) = year {
            if (1900..=2035).contains(&y) {
                if y < year_min {
                    year_min = y;
                }
                if y > year_max {
                    year_max = y;
                }
            }
        }

        let sort_artist = artist.to_lowercase();
        let sort_album = album.to_lowercase();
        let search_blob = format!(
            "{} {} {} {}",
            sort_artist,
            sort_album,
            genre.to_lowercase(),
            publisher.to_lowercase()
        );

        let idx = albums.len();
        album_idx_by_id.insert(id.clone(), idx);
        albums.push(AlbumSummary {
            id,
            album,
            artist,
            artist_key,
            genre,
            genre_norm,
            publisher,
            year,
            total_tracks: total_tracks_val,
            total_seconds,
            loved_tracks,
            rating,
            album_score,
            billboard_rank,
            official_uk_rank,
            vg_lista_rank,
            has_cover,
            search_blob,
            sort_artist,
            sort_album,
        });
    }

    let mut genres: Vec<GenreFacet> = genre_counts
        .into_iter()
        .map(|(name, count)| GenreFacet { name, count })
        .collect();
    genres.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));

    let mut artists_index: Vec<(String, String, usize)> = artist_counts
        .into_iter()
        .map(|(low, (disp, cnt))| (low, disp, cnt))
        .collect();
    artists_index.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| a.0.cmp(&b.0)));

    if year_min > year_max {
        year_min = 1950;
        year_max = 2026;
    }

    let mut filtered_indices: Vec<usize> = (0..albums.len()).collect();
    filtered_indices.sort_by(|&a, &b| {
        albums[a]
            .sort_artist
            .cmp(&albums[b].sort_artist)
            .then_with(|| albums[a].year.unwrap_or(9999).cmp(&albums[b].year.unwrap_or(9999)))
            .then_with(|| albums[a].sort_album.cmp(&albums[b].sort_album))
    });

    Ok(Catalog {
        library_dir: library_dir.to_string(),
        albums,
        album_idx_by_id,
        cover_paths,
        genres,
        artists_index,
        year_min,
        year_max,
        total_tracks,
        active_query_id: 1,
        filtered_indices,
        filtered_scores: HashMap::new(),
    })
}

impl Catalog {
    pub fn overview(&self, sonic_index_ready: bool) -> CatalogOverview {
        CatalogOverview {
            status: DbStatus {
                library_dir: self.library_dir.clone(),
                library_exists: db_path(&self.library_dir, "music-library.sqlite3").exists(),
                analysis_exists: db_path(&self.library_dir, "music-analysis.sqlite3").exists(),
                clap_exists: db_path(&self.library_dir, "music-clap.sqlite3").exists(),
                timelines_exists: db_path(&self.library_dir, "music-timelines.sqlite3").exists(),
                total_albums: self.albums.len(),
                total_tracks: self.total_tracks,
                covers_available: self.cover_paths.len(),
                sonic_index_ready,
            },
            genres: self.genres.clone(),
            year_min: self.year_min,
            year_max: self.year_max,
        }
    }

    pub fn apply_filter(
        &mut self,
        filter: &AlbumFilter,
        similar_ranked: Option<Vec<(String, f32)>>,
    ) -> QueryResult {
        self.active_query_id += 1;
        self.filtered_scores.clear();

        let search_terms: Vec<String> = filter
            .search
            .trim()
            .to_lowercase()
            .split_whitespace()
            .map(|s| s.to_string())
            .collect();

        let genres_lower: Vec<String> = filter
            .genres
            .iter()
            .map(|g| g.trim().to_lowercase())
            .filter(|g| !g.is_empty())
            .collect();

        let artist_lower = filter
            .artist
            .as_ref()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());

        let chart_mode = filter
            .chart
            .as_deref()
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty() && s != "all");

        let mut indices: Vec<usize>;

        if let Some(ranked) = similar_ranked {
            indices = Vec::with_capacity(ranked.len());
            for (aid, score) in ranked {
                if let Some(&idx) = self.album_idx_by_id.get(&aid) {
                    if self.matches_facets(
                        &self.albums[idx],
                        &search_terms,
                        &genres_lower,
                        &artist_lower,
                        &chart_mode,
                        filter,
                    ) {
                        indices.push(idx);
                        self.filtered_scores.insert(idx, score);
                    }
                }
            }
        } else {
            indices = Vec::with_capacity(self.albums.len().min(4096));
            for (idx, a) in self.albums.iter().enumerate() {
                if self.matches_facets(
                    a,
                    &search_terms,
                    &genres_lower,
                    &artist_lower,
                    &chart_mode,
                    filter,
                ) {
                    indices.push(idx);
                }
            }

            let albums = &self.albums;
            match filter.sort_by.as_str() {
                "artist_desc" => indices.sort_by(|&a, &b| {
                    albums[b]
                        .sort_artist
                        .cmp(&albums[a].sort_artist)
                        .then_with(|| albums[a].year.unwrap_or(9999).cmp(&albums[b].year.unwrap_or(9999)))
                }),
                "album_asc" => indices.sort_by(|&a, &b| {
                    albums[a]
                        .sort_album
                        .cmp(&albums[b].sort_album)
                        .then_with(|| albums[a].sort_artist.cmp(&albums[b].sort_artist))
                }),
                "year_asc" => indices.sort_by(|&a, &b| {
                    albums[a]
                        .year
                        .unwrap_or(9999)
                        .cmp(&albums[b].year.unwrap_or(9999))
                        .then_with(|| albums[a].sort_artist.cmp(&albums[b].sort_artist))
                        .then_with(|| albums[a].sort_album.cmp(&albums[b].sort_album))
                }),
                "year_desc" => indices.sort_by(|&a, &b| {
                    albums[b]
                        .year
                        .unwrap_or(0)
                        .cmp(&albums[a].year.unwrap_or(0))
                        .then_with(|| albums[a].sort_artist.cmp(&albums[b].sort_artist))
                        .then_with(|| albums[a].sort_album.cmp(&albums[b].sort_album))
                }),
                "rating_desc" => indices.sort_by(|&a, &b| {
                    let ra = albums[a].rating.unwrap_or(-1);
                    let rb = albums[b].rating.unwrap_or(-1);
                    rb.cmp(&ra)
                        .then_with(|| {
                            albums[b]
                                .album_score
                                .unwrap_or(-1.0)
                                .partial_cmp(&albums[a].album_score.unwrap_or(-1.0))
                                .unwrap_or(std::cmp::Ordering::Equal)
                        })
                        .then_with(|| albums[a].sort_artist.cmp(&albums[b].sort_artist))
                }),
                "tracks_desc" => indices.sort_by(|&a, &b| {
                    albums[b]
                        .total_tracks
                        .cmp(&albums[a].total_tracks)
                        .then_with(|| albums[a].sort_artist.cmp(&albums[b].sort_artist))
                }),
                "chart_rank" => indices.sort_by(|&a, &b| {
                    let best = |x: &AlbumSummary| {
                        [x.billboard_rank, x.official_uk_rank, x.vg_lista_rank]
                            .into_iter()
                            .flatten()
                            .min()
                            .unwrap_or(9999)
                    };
                    best(&albums[a])
                        .cmp(&best(&albums[b]))
                        .then_with(|| albums[a].year.unwrap_or(9999).cmp(&albums[b].year.unwrap_or(9999)))
                }),
                "random" => {
                    let seed = if filter.random_seed == 0 {
                        42
                    } else {
                        filter.random_seed
                    };
                    let mut rng = rand::rngs::StdRng::seed_from_u64(seed);
                    indices.shuffle(&mut rng);
                }
                _ => {
                    // artist_asc (default: Artist A-Z, chronological discography)
                    indices.sort_by(|&a, &b| {
                        albums[a]
                            .sort_artist
                            .cmp(&albums[b].sort_artist)
                            .then_with(|| {
                                albums[a]
                                    .year
                                    .unwrap_or(9999)
                                    .cmp(&albums[b].year.unwrap_or(9999))
                            })
                            .then_with(|| albums[a].sort_album.cmp(&albums[b].sort_album))
                    });
                }
            }
        }

        self.filtered_indices = indices;
        let total_count = self.filtered_indices.len();
        let initial_len = total_count.min(120);
        let initial_items: Vec<AlbumSummary> = self.filtered_indices[..initial_len]
            .iter()
            .map(|&i| self.albums[i].clone())
            .collect();
        let similarity_scores: Vec<f32> = self.filtered_indices[..initial_len]
            .iter()
            .map(|i| self.filtered_scores.get(i).copied().unwrap_or(0.0))
            .collect();

        let similar_source = filter
            .similar_to_album_id
            .as_ref()
            .and_then(|id| self.album_idx_by_id.get(id))
            .map(|&i| self.albums[i].clone());

        QueryResult {
            query_id: self.active_query_id,
            total_count,
            initial_items,
            similar_source,
            similarity_scores,
        }
    }

    fn matches_facets(
        &self,
        a: &AlbumSummary,
        search_terms: &[String],
        genres_lower: &[String],
        artist_lower: &Option<String>,
        chart_mode: &Option<String>,
        filter: &AlbumFilter,
    ) -> bool {
        if filter.has_cover_only && !a.has_cover {
            return false;
        }
        if filter.loved_only && a.loved_tracks <= 0 {
            return false;
        }
        if let Some(min_r) = filter.min_rating {
            if a.rating.unwrap_or(0) < min_r {
                return false;
            }
        }
        if let Some(ymin) = filter.year_min {
            match a.year {
                Some(y) if y >= ymin => {}
                _ => return false,
            }
        }
        if let Some(ymax) = filter.year_max {
            match a.year {
                Some(y) if y <= ymax => {}
                _ => return false,
            }
        }
        if let Some(ref cm) = chart_mode {
            let hit = match cm.as_str() {
                "any" => {
                    a.billboard_rank.is_some()
                        || a.official_uk_rank.is_some()
                        || a.vg_lista_rank.is_some()
                }
                "billboard" => a.billboard_rank.is_some(),
                "uk" => a.official_uk_rank.is_some(),
                "vg_lista" => a.vg_lista_rank.is_some(),
                _ => true,
            };
            if !hit {
                return false;
            }
        }
        if !genres_lower.is_empty() {
            let gn = a.genre.to_lowercase();
            let gn2 = a.genre_norm.to_lowercase();
            if !genres_lower.iter().any(|g| gn == *g || gn2 == *g) {
                return false;
            }
        }
        if let Some(ref art) = artist_lower {
            if !a.sort_artist.contains(art) && !a.artist_key.to_lowercase().contains(art) {
                return false;
            }
        }
        if !search_terms.is_empty() {
            for term in search_terms {
                if !a.search_blob.contains(term) {
                    // Also allow matching year tokens like "1984"
                    let year_match = a
                        .year
                        .map(|y| y.to_string().contains(term))
                        .unwrap_or(false);
                    if !year_match {
                        return false;
                    }
                }
            }
        }
        true
    }

    pub fn get_window(&self, start: usize, count: usize) -> (Vec<AlbumSummary>, Vec<f32>) {
        if start >= self.filtered_indices.len() || count == 0 {
            return (Vec::new(), Vec::new());
        }
        let end = (start + count).min(self.filtered_indices.len());
        let mut items = Vec::with_capacity(end - start);
        let mut scores = Vec::with_capacity(end - start);
        for &idx in &self.filtered_indices[start..end] {
            items.push(self.albums[idx].clone());
            scores.push(self.filtered_scores.get(&idx).copied().unwrap_or(0.0));
        }
        (items, scores)
    }

    pub fn get_scrubber_marks(&self, steps: usize) -> Vec<ScrubberMark> {
        let len = self.filtered_indices.len();
        if len == 0 {
            return Vec::new();
        }
        let actual_steps = steps.clamp(2, 240).min(len);
        let mut out = Vec::with_capacity(actual_steps);
        for s in 0..actual_steps {
            let pos = if actual_steps == 1 {
                0
            } else {
                (s * (len - 1)) / (actual_steps - 1)
            };
            let a = &self.albums[self.filtered_indices[pos]];
            out.push(ScrubberMark {
                index: pos,
                label: a.artist.clone(),
                sublabel: a.album.clone(),
                year: a.year,
            });
        }
        out
    }

    pub fn suggest_artists(&self, query: &str, limit: usize) -> Vec<ArtistSuggestion> {
        let q = query.trim().to_lowercase();
        let lim = limit.clamp(1, 50);
        let mut starts = Vec::new();
        let mut contains = Vec::new();
        for (low, disp, cnt) in &self.artists_index {
            if q.is_empty() {
                starts.push(ArtistSuggestion {
                    name: disp.clone(),
                    count: *cnt,
                });
                if starts.len() >= lim {
                    break;
                }
            } else if low.starts_with(&q) {
                starts.push(ArtistSuggestion {
                    name: disp.clone(),
                    count: *cnt,
                });
            } else if low.contains(&q) && contains.len() < lim {
                contains.push(ArtistSuggestion {
                    name: disp.clone(),
                    count: *cnt,
                });
            }
            if starts.len() >= lim {
                break;
            }
        }
        for c in contains {
            if starts.len() >= lim {
                break;
            }
            starts.push(c);
        }
        starts
    }

    pub fn index_of_album_in_filtered(&self, album_id: &str) -> Option<usize> {
        let &global_idx = self.album_idx_by_id.get(album_id)?;
        self.filtered_indices.iter().position(|&i| i == global_idx)
    }
}

pub fn get_album_tracks(library_dir: &str, album_id: &str) -> Result<Vec<TrackInfo>, String> {
    let conn = open_readonly_db(&db_path(library_dir, "music-library.sqlite3"))?;
    let mut stmt = conn
        .prepare(
            "SELECT
                id,
                album_id,
                COALESCE(disc_number, 1),
                COALESCE(track_number, 0),
                COALESCE(title, ''),
                COALESCE(display_artist, album_artist_display, ''),
                COALESCE(time_seconds, 0),
                normalized_rating,
                COALESCE(love, ''),
                COALESCE(file_path, ''),
                COALESCE(filename, ''),
                billboard_single_rank,
                official_uk_rank,
                vg_lista_rank
            FROM tracks
            WHERE album_id = ?1
            ORDER BY COALESCE(disc_number, 1) ASC, COALESCE(track_number, 0) ASC, id ASC",
        )
        .map_err(|e| format!("Failed to prepare tracks query: {e}"))?;

    let rows = stmt
        .query_map([album_id], |r| {
            let love_str: String = r.get(8)?;
            let loved = !love_str.trim().is_empty()
                && love_str.trim() != "0"
                && !love_str.eq_ignore_ascii_case("false");
            Ok(TrackInfo {
                id: r.get(0)?,
                album_id: r.get(1)?,
                disc_number: r.get(2)?,
                track_number: r.get(3)?,
                title: r.get(4)?,
                artist: r.get(5)?,
                time_seconds: r.get(6)?,
                rating: r.get(7)?,
                loved,
                file_path: r.get(9)?,
                filename: r.get(10)?,
                billboard_single_rank: r.get(11)?,
                official_uk_rank: r.get(12)?,
                vg_lista_rank: r.get(13)?,
            })
        })
        .map_err(|e| format!("Failed to fetch tracks: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        if let Ok(t) = row {
            out.push(t);
        }
    }
    Ok(out)
}
