# Changelog

All notable changes to Cover Display will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-11-25

### Added
- **Music TV / Lounge Overlays (`PartyLoungeOverlays`)** for Auto-Surf:
  - **TV / Lounge Auto-Hide Chrome**: After 4 seconds of mouse/keyboard inactivity during Auto-Surf, the top bar, filter bar, player bar, Party HUD, and cursor smoothly fade away for an edge-to-edge full-window canvas—revealing a minimal bottom-left **Now Playing** corner HUD with a live `accentRgb` progress bar. Moving the mouse brings all controls back instantly.
  - **Pre-Rolled "Up Next" Teaser Pill**: Pre-selects and prefetches the upcoming album (even in Random order) and slides a clickable **"Up Next"** teaser card with mini cover art and countdown into the bottom-right corner ~4.5 seconds before the clip ends.
  - **Music-TV Pop-Up Trivia Tags**: Surfaces chart rankings (`Billboard`, `UK Official`, `VG-lista`), ratings, loved track counts, Discovery Crate status, and release year/label as a sleek pop-up tag whenever a new album lands.
  - **Celebratory Crate Save Reaction**: Pressing `B` or clicking Crate during Auto-Surf pops a floating confirmation burst over the stage without interrupting the party flow.
  - **Quick Toggle & Persistence**: Toggle `Lounge` in the floating Party HUD, press `L` during Auto-Surf, or configure **TV / Lounge Auto-Hide Chrome** in **Settings → Preview & Audio**.

## [0.8.0] - 2026-11-25

### Added
- **60fps Audio-Reactive Party Effects (`PartyVisualizer`)**: Powered by live RMS audio telemetry (`playback.level`), track energy envelopes, and dual-tone palettes derived from each album's `accentRgb`, with transient beat-peak detection:
  - **Horizon Spectrum Bars** (Cinema Spotlight & Cover Flow Spin): Translucent mirrored equalizer bars rising from a glowing studio horizon line.
  - **Radial Vinyl Soundwave & Shockwaves** (Vinyl Turntable): 64-spoke circular radial pulse ring behind the spinning LP with expanding beat shockwave rings on loud peaks.
  - **Dual-Tone Aurora Orbs & Wave Ribbon** (Floating Mosaic & Cover Wall Spotlight): Breathing ambient beat orbs paired with a sleek bottom waveform ribbon.
  - **Dynamic Cover Lift**: Subtle physical scale & elevation lift on strong musical peaks.
- **Quick Toggle & Persistence**: Toggle `Pulse` directly in the floating Party HUD, press `A` during Auto-Surf, or configure **Audio-Reactive Visualizer & Beat Glow** in **Settings → Preview & Audio**.

## [0.7.0] - 2026-11-25

### Added
- **Energetic Album-to-Album Party Transitions**: Added true choreographed outgoing + incoming cover transitions across Party Stage scenes (Spotlight, Vinyl, and Mosaic), configurable via the floating Party HUD (`FX:` pill), `T` shortcut, or **Settings → Preview & Audio**:
  - **3D Card Flip**: Two-sided 3D perspective card flip where the outgoing album flips 180° to reveal the incoming album on the back face.
  - **Crate Toss**: Outgoing cover flicks off to the side with rotational momentum while the incoming cover drops and springs into place.
  - **Shutter Wipe**: Clean Music-TV clip-path wipe with a luminous `accentRgb` leading shutter beam.
  - **Color Wash + Zoom Bloom**: Outgoing artwork dissolves smoothly while the new cover blooms forward alongside a full-stage radial `accentRgb` color-wash pulse synced to the audio crossfade (`fadeMs`).
  - **Auto-Mix** (default): Automatically cycles through all 4 transitions on every album change, paired with varied scene-to-scene stage transitions (`Fade`, `Slide`, `Zoom`).

## [0.6.0] - 2026-11-25

### Added
- **Auto-Surf Rotating Party Views**: Auto-Surf now cycles through 5 animated visual scenes on every album change (or lets you lock your favorite scene via the floating Party HUD or **Settings → Preview & Audio**):
  - **Cinema Spotlight**: Full-bleed blurred Ken Burns album backdrop, beat-reactive `accentRgb` ambient aurora, alternating cover entrance animations (pop, 3D flip, glide), oversized studio typography, and live EQ/progress card.
  - **Vinyl Turntable**: 12" matte LP jacket with a spinning vinyl record sliding out from the sleeve, complete with grooves, specular sheen, and a custom album-art center label.
  - **Floating Parallax Mosaic**: Neighboring albums drift in soft-focused parallax depth layers behind the spotlighted active album and a Music-TV lower-third card.
  - **Cover Flow Spin**: Dramatic high-speed slot-machine carousel spin when jumping across distant albums in Cover Flow.
  - **Cover Wall Spotlight**: Smooth-scrolls to the active tile on the wall, dims surrounding covers, and lifts the playing album with a vibrant `accentRgb` glow.
- **Floating Party Scene HUD & Shortcut**: Quickly toggle Party Views on/off, pick or lock any scene (`Auto`, `Spotlight`, `Vinyl`, `Mosaic`, `Flow`, `Wall`), skip to the next album, or press `V` to cycle scenes on the fly.

## [0.5.0] - 2026-11-25

### Added
- **Hands-Free Auto-Surf Mode**: Toggle **Auto-Surf** (`S` shortcut or top-bar button) to preview a configurable number of tracks per album (1, 2, 3, or 5) and automatically glide to the next (or random) album in Cover Flow or Cover Wall.
- **Audio Unavailable Feedback**: Displays a clear status message in the player bar when an album's audio files are offline, moved, or unreadable instead of silently stopping.

### Changed
- **Faster Smart Highlight Lookups**: Reuses persistent read-only SQLite connections (`AnalysisDbCache`) on the Rust audio thread instead of reopening `music-analysis`, `music-clap`, and `music-timelines` on every track start.
- **Click-Free Track & Scrub Transitions**: Overlaps an 85ms cosine early fade-out while preparing the next track or waveform scrub position so transitions never pop or click.

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
