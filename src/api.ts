import { invoke } from "@tauri-apps/api/core";
import type {
  AlbumFilter,
  AlbumSummary,
  AppSettings,
  ArtistSuggestion,
  CatalogOverview,
  PlaybackState,
  QueryResult,
  ScrubberMark,
  TrackInfo,
  WindowResponse,
} from "./types";

export const api = {
  getSettings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (settings: AppSettings) =>
    invoke<AppSettings>("update_settings", { settings }),
  getCatalogOverview: () => invoke<CatalogOverview>("get_catalog_overview"),
  reloadLibrary: () => invoke<CatalogOverview>("reload_library"),
  queryAlbums: (filter: AlbumFilter) =>
    invoke<QueryResult>("query_albums", { filter }),
  getAlbumWindow: (start: number, count: number) =>
    invoke<WindowResponse>("get_album_window", { start, count }),
  getScrubberMarks: (steps: number) =>
    invoke<ScrubberMark[]>("get_scrubber_marks", { steps }),
  suggestArtists: (query: string, limit = 24) =>
    invoke<ArtistSuggestion[]>("suggest_artists", { query, limit }),
  findAlbumPosition: (albumId: string) =>
    invoke<number | null>("find_album_position", { albumId }),
  fetchAlbumTracks: (albumId: string) =>
    invoke<TrackInfo[]>("fetch_album_tracks", { albumId }),
  getAlbumAccentColor: (albumId: string) =>
    invoke<[number, number, number]>("get_album_accent_color", { albumId }),
  previewAlbum: (
    albumId: string,
    opts?: {
      startTrackIndex?: number;
      startTrackId?: number;
      isPinned?: boolean;
      sourceView?: "coverflow" | "wall";
    }
  ) =>
    invoke<void>("preview_album", {
      albumId,
      startTrackIndex: opts?.startTrackIndex ?? 0,
      startTrackId: opts?.startTrackId ?? null,
      isPinned: opts?.isPinned ?? false,
      sourceView: opts?.sourceView ?? "coverflow",
    }),
  previewTrackAt: (trackIndex: number, customStartSec?: number | null) =>
    invoke<void>("preview_track_at", {
      trackIndex,
      customStartSec: customStartSec ?? null,
    }),
  togglePause: () => invoke<void>("playback_toggle_pause"),
  nextTrack: () => invoke<void>("playback_next_track"),
  prevTrack: () => invoke<void>("playback_prev_track"),
  stopPlayback: (onlyIfUnpinned = false) =>
    invoke<void>("playback_stop", { onlyIfUnpinned }),
  setPinned: (pinned: boolean) =>
    invoke<void>("playback_set_pinned", { pinned }),
  setAutoSurf: (enabled: boolean, tracksPerAlbum: number) =>
    invoke<void>("playback_set_auto_surf", { enabled, tracksPerAlbum }),
  setVolume: (volume: number) => invoke<void>("playback_set_volume", { volume }),
  getPlaybackState: () => invoke<PlaybackState>("get_playback_state"),
  clearCoverCache: () => invoke<number>("clear_cover_cache"),
  rebuildSonicIndex: () => invoke<number>("rebuild_sonic_index"),
  getAppVersion: () => invoke<string>("get_app_version"),
  toggleCrateAlbum: (albumId: string) =>
    invoke<string[]>("toggle_crate_album", { albumId }),
  clearCrate: () => invoke<string[]>("clear_crate"),
  getCrateAlbums: () => invoke<AlbumSummary[]>("get_crate_albums"),
  openAlbumFolder: (albumId: string) =>
    invoke<void>("open_album_folder", { albumId }),
  exportCrateM3u: () => invoke<string>("export_crate_m3u"),
};

export function coverUrl(albumId: string, size: 256 | 640 = 256): string {
  return `http://cover.localhost/${encodeURIComponent(albumId)}?s=${size}`;
}

export function formatSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function formatRating(rating: number | null): string | null {
  if (rating == null || rating <= 0) return null;
  // Normalize 0..100 ratings (MusicBee style) to 0..5 stars
  if (rating > 10) {
    const stars = rating / 20;
    return stars % 1 === 0 ? `${stars.toFixed(0)}★` : `${stars.toFixed(1)}★`;
  }
  return `${rating}★`;
}

export function bestChartBadge(a: {
  billboardRank: number | null;
  officialUkRank: number | null;
  vgListaRank: number | null;
}): string | null {
  if (a.billboardRank != null) return `BB #${a.billboardRank}`;
  if (a.officialUkRank != null) return `UK #${a.officialUkRank}`;
  if (a.vgListaRank != null) return `VG #${a.vgListaRank}`;
  return null;
}

export function previewModeLabel(mode: string): string {
  switch (mode) {
    case "smart_highlight":
      return "Smart Highlight";
    case "clap_best":
      return "CLAP Best";
    case "start":
      return "Start";
    case "middle":
      return "Middle";
    case "percentage":
      return "Custom %";
    case "fixed_offset":
      return "Fixed Offset";
    default:
      return mode;
  }
}
