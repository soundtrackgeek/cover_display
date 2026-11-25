# Cover Display

A fast, studio-grade desktop music library cover browser and audio preview player built with **Rust + Tauri 2 + React**. Designed to effortlessly browse tens of thousands of albums (74,000+ albums / 1.1M+ tracks) with instant filtering, smart chorus/highlight audio previews, and zero-lock read-only SQLite integration.

## Features

- **Classic 3D Cover Flow**
  - Smooth 60fps momentum physics, mouse wheel turbo-scrolling, click-drag, keyboard navigation, and mirrored studio floor reflections.
  - Adaptive ambient radial lighting extracted from the selected album cover.
  - Ultra-fast scrubbing rail with live Artist / Album / Year HUD tooltips to leap across 74,000+ albums instantaneously.
  - Automatic sequential track previews (configurable 15s default clips) with smooth cosine fade-in/out and inline clickable tracklist.
- **Endless Virtualized Cover Wall**
  - High-density row-virtualized album cover wall with adjustable tile size slider and a **vertical fast-scrubbing rail** with live Artist / Album / Year HUD tooltips to leap across 74,000+ covers instantaneously.
  - **Seamless View Sync**: Switching between Cover Flow (`1`) and Cover Wall (`2`) or pressing `R` ("Surprise Me") preserves and scrolls straight to your active album.
  - **Mouse Hover Preview**: Hover over any cover to smoothly preview clips of each track on the album with live equalizer meters.
  - Click any cover to **Pin/Lock** playback while navigating or scrubbing the waveform (`Esc` to unpin).
  - Quick hover actions for Discovery Crate, Open Folder, Artist Discography, Similar Vibe, and jumping straight to Cover Flow.
- **Smart Highlight & Configurable Preview Engine**
  - Native Rust (`rodio` + `symphonia`) audio engine with zero browser autoplay restrictions, ReplayGain-style loudness normalization, and smooth fade-in/out.
  - **Smart Highlight (BLISS Timelines + CLAP)**: Combines 1-second chroma/MFCC chorus-repetition detection and loudness peaks from `music-timelines.sqlite3` with representative windows from `music-clap.sqlite3` to jump straight to each song's strongest section.
  - **CLAP Best Window**, **Start**, **Middle**, **Custom Percentage**, and **Fixed Offset** (`0:30`, `1:00`, `1:30`, `2:00`, or any custom timestamp).
  - **Play Singles First (MusicBrainz + Charts)**: Prioritizes each album's MusicBrainz `track_singles` and charted single tracks ahead of the rest of the album (with quick toggle in the player bar, Settings control, and `SINGLE` badges in tracklists).
  - **Full Track Playback Mode**: One-click `Full` toggle in the player bar lets any track continue playing cleanly to the end without clip cutoff.
  - **Hands-Free Auto-Surf & Rotating Party Views**: Toggle `Auto-Surf` (`S`) to preview 1–5 highlights per album and automatically glide to the next (or random) album while cycling through 5 animated **Party Views** (**Cinema Spotlight**, **Vinyl Turntable**, **Floating Parallax Mosaic**, **Cover Flow Spin**, and **Cover Wall Spotlight**) with choreographed outgoing/incoming **Album Transitions** (**3D Card Flip**, **Crate Toss**, **Shutter Wipe**, and audio-fade-synced **Color Wash**) and a 60fps **Audio-Reactive Visualizer** (mirrored horizon spectrum bars, vinyl radial pulse ring & beat shockwaves, dual-tone aurora orbs, and reactive cover lift). Press `V` to cycle scenes, `T` to cycle transitions, or `A` to toggle audio-reactive effects.
  - **Studio-Smooth Audio Engine**: Persistent read-only SQLite connections on the audio thread, click-free cosine fade transitions on track switch/scrub, and clear inline feedback if an album's files are offline or unavailable.
  - Interactive **64-bar Energy Timeline Waveform** in the bottom player dock showing the active clip window and CLAP anchor markers—click anywhere to scrub.
- **Local Discovery Crate & File Actions**
  - Press `B` or click the bookmark button on any cover (in Cover Flow, Cover Wall, or the player bar) to collect albums in a local **Discovery Crate** stored in Cover Display's own config—never touching your read-only SQLite databases.
  - Filter Cover Flow or Cover Wall down to your Crate in one click, **Open Album Folder** in Explorer, or export your entire Crate as a `.m3u8` playlist for your main music player.
- **Sonic Similarity ("Similar Vibe")**
  - Uses `music-analysis.sqlite3` (23-dimensional BLISS sonic descriptors) to build a compact cached album centroid index and find sonically similar albums across the entire library in milliseconds.
- **Fast Faceted Filtering, Navigation History & Saved Presets**
  - Browser-style **Back / Forward navigation history** (`Alt+←` / `Alt+→`, mouse Back/Forward buttons, and top-bar arrows) that remembers your exact filter, view, and album position so you can dive down Artist and Similar Vibe rabbit holes fearlessly.
  - Instant search across Artist, Album, Genre, Year, and Label (`/`).
  - Filter by Genre (multi-select with counts), Decade / Year Range, Artist Discography, Chart Appearances (Billboard, UK Official, VG-lista), Minimum Rating, Loved Tracks, and Cover Availability.
  - Starter discovery chips (`80s Synthpop`, `70s Metal & Hard Rock`, `Synthwave`, `Charted Hits`, `Top Rated`, `Loved`, `Soundtracks`) plus custom saved filter presets.
- **Hands-Free In-App Auto-Updater**
  - Automatically checks GitHub Releases on startup and every 30 minutes, plus a manual check button in Settings.
  - Downloads, installs silently (`passive` NSIS mode), and restarts Cover Display automatically without installer prompts.

## Database Integration (Read-Only)

By default, Cover Display reads from:

```text
C:\Users\jtill\AppData\Roaming\com.local.musiclibrary\
├── music-library.sqlite3     # Albums, tracks, covers, charts, ratings
├── music-analysis.sqlite3    # Track audio hashes & BLISS sonic descriptors
├── music-clap.sqlite3        # CLAP 3×10s representative window timestamps
└── music-timelines.sqlite3   # 1-second chroma, loudness & MFCC timelines
```

All databases are opened strictly **read-only** (`SQLITE_OPEN_READ_ONLY` + `PRAGMA query_only = ON`) and never modify or lock your library. The library path can be customized in **Settings → Library & Databases**.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `←` / `→` | Previous / next album in Cover Flow (`Shift` = ±10) |
| `PageUp` / `PageDown` | Jump ±50 albums in Cover Flow |
| `Home` / `End` | First / last album in Cover Flow |
| `↑` / `↓` | Previous / next track on active album |
| `Space` | Play / Pause preview |
| `1` / `2` | Switch between Cover Flow and Cover Wall (preserves active album) |
| `Alt+←` / `Alt+→` | Navigate Back / Forward through filter & browsing history (also Mouse Back/Forward) |
| `/` | Focus search bar |
| `R` | Jump to a random album |
| `S` | Toggle hands-free Auto-Surf jukebox mode |
| `V` | Cycle active Auto-Surf Party View scene |
| `T` | Cycle Auto-Surf album transition effect (`Mix`, `3D Flip`, `Toss`, `Wipe`, `Wash`) |
| `A` | Toggle Auto-Surf audio-reactive visualizer & beat glow |
| `B` | Save / remove active album in Discovery Crate |
| `Esc` | Unpin locked album in Cover Wall / close Crate drawer |

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri:dev

# Build Windows NSIS installer locally
npm run tauri:build

# Clean Tauri/Cargo build artifacts
npm run tauri:clean
```

## Releases & Auto-Updates

Every version bump pushed to `master` (updating `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`) automatically triggers `.github/workflows/release.yml` to build a signed Windows NSIS `setup.exe` installer and `latest.json` updater manifest on GitHub Releases.
