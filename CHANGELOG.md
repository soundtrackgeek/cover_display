# Changelog

All notable changes to Cover Display will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-11-25

### Added
- **Browser-Style Navigation History (Back / Forward)**: Added top-bar Back/Forward buttons, `Alt+←` / `Alt+→` shortcuts, and mouse Back/Forward side-button support that remember your exact filter, view mode, and album scroll position when diving into Artist discographies, Similar Vibe matches, Crate filters, or searches.
- **Cover Wall Fast-Scrubbing Rail**: Added a vertical fast-scrubbing rail along the right edge of Cover Wall with live Artist / Album / Year + index HUD tooltips for instant leaping across 74,000+ albums.
- **Seamless Cover Flow ↔ Cover Wall Sync**: Switching between Cover Flow (`1`) and Cover Wall (`2`) now preserves your active album position, and **Surprise Me** (`R`) now works directly inside Cover Wall without forcing a view switch.

## [0.3.0] - 2026-11-25

### Added
- **Full Track Playback Mode**: Toggle `Full` in the player bar (or **Settings → Preview & Audio**) to let songs play continuously to the end without clip truncation. Switching into Full Track mode mid-preview seamlessly continues from the current playhead.
- **Local Discovery Crate**: Save and collect albums while browsing (`B` shortcut or bookmark buttons in Cover Flow, Cover Wall, and the player bar), persisted locally in Cover Display's own config without modifying any read-only SQLite databases.
- **Discovery Crate Drawer & Quick Filter**: Open the slide-over Crate drawer from the top bar to preview saved albums, filter the main view to your Crate (`Crate (N)` chip), or clear the Crate.
- **Open Album Folder & `.m3u8` Playlist Export**: Reveal any album's folder directly in Explorer/Finder or export your entire Discovery Crate as a ready-to-play `Cover Display Crate.m3u8` playlist.

## [0.2.1] - 2026-11-21

### Fixed
- Fixed a bidirectional state ping-pong loop in Cover Flow when jumping to distant albums via **Surprise Me** (or `R`), which caused cover artwork to stay stuck loading and prevented audio preview from switching to the newly selected album.
- Prefetch target album window pages immediately on **Surprise Me** jumps for instant cover rendering.

## [0.2.0] - 2026-11-21

### Added
- **Play Singles First** mode powered by MusicBrainz `track_singles` and single chart metadata in `music-library.sqlite3` (including remaster/edition suffix fallback matching).
- Quick **Singles 1st** toggle pill in the bottom player bar and corresponding option in **Settings → Preview & Audio** (enabled by default).
- Visual `SINGLE` badges and tooltips in the Cover Flow track strip, active player track header, and expandable album tracklist drawer.
- Exact track-ID targeting when clicking any track in Cover Flow so clicked tracks always start accurately regardless of track order or Singles-first grouping.

## [0.1.0] - 2026-11-21

### Added
- Initial release of Cover Display built with Rust + Tauri 2 + React + TypeScript + Tailwind CSS.
- Classic 3D Cover Flow view with 60fps momentum scrolling, mirrored reflections, adaptive ambient lighting, turbo scrubbing rail, and automatic sequential track previews.
- Endless virtualized Cover Wall view with hover-to-preview playback, click-to-pin locking, adjustable tile size density, and quick hover actions.
- Native Rust audio preview engine (`rodio` + `symphonia`) with smooth cosine fade-in/out, loudness normalization, and live RMS level metering.
- Smart Highlight preview picker combining BLISS 1-second chroma/MFCC/loudness timelines (`music-timelines.sqlite3`) with CLAP representative windows (`music-clap.sqlite3`), plus Start, Middle, Custom Percentage, Fixed Offset, and CLAP Best modes.
- Interactive 64-bar song energy timeline waveform with CLAP markers and click-to-scrub support.
- "Similar Vibe" sonic similarity discovery backed by `music-analysis.sqlite3` with cached album vector indexing.
- Fast faceted filtering by search, genre, decade/year range, artist discography, charts, ratings, loved tracks, and saved filter presets.
- Automated GitHub Actions release workflow building signed Windows NSIS `setup.exe` installers and `latest.json` updater manifests on every version bump.
- In-app auto-updater checking on startup, every 30 minutes, and manually, with unattended silent installation and automatic restart.
