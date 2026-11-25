export type PreviewMode =
  | "smart_highlight"
  | "clap_best"
  | "start"
  | "middle"
  | "percentage"
  | "fixed_offset";

export type TrackOrder = "sequential" | "loved_first" | "rated_first" | "shuffle";

export type ViewMode = "coverflow" | "wall";

export type PartyScene = "spotlight" | "vinyl" | "mosaic" | "coverflow" | "wall";

export type PartySceneMode = "auto" | PartyScene;

export interface AlbumFilter {
  search: string;
  genres: string[];
  artist: string | null;
  yearMin: number | null;
  yearMax: number | null;
  chart: string | null;
  minRating: number | null;
  lovedOnly: boolean;
  hasCoverOnly: boolean;
  crateOnly: boolean;
  sortBy: string;
  similarToAlbumId: string | null;
  randomSeed: number;
}

export interface SavedFilterPreset {
  id: string;
  name: string;
  filter: AlbumFilter;
}

export interface AppSettings {
  libraryDir: string;
  clipDurationSec: number;
  fullTrackMode: boolean;
  fadeMs: number;
  previewMode: PreviewMode;
  previewPercentage: number;
  previewFixedOffsetSec: number;
  trackOrder: TrackOrder;
  singlesFirst: boolean;
  normalizeLoudness: boolean;
  volume: number;
  hoverDelayMs: number;
  coverFlowDelayMs: number;
  wallTileSize: number;
  wallGap: number;
  autoPlayOnSelect: boolean;
  autoSurfTracksPerAlbum: number;
  autoSurfOrder: "sequential" | "random";
  autoSurfPartyMode: boolean;
  autoSurfSceneMode: PartySceneMode;
  autoInstallUpdates: boolean;
  savedFilters: SavedFilterPreset[];
  crateAlbumIds: string[];
}

export interface AlbumSummary {
  id: string;
  album: string;
  artist: string;
  artistKey: string;
  genre: string;
  genreNorm: string;
  publisher: string;
  year: number | null;
  totalTracks: number;
  totalSeconds: number;
  lovedTracks: number;
  rating: number | null;
  albumScore: number | null;
  billboardRank: number | null;
  officialUkRank: number | null;
  vgListaRank: number | null;
  hasCover: boolean;
}

export interface TrackInfo {
  id: number;
  albumId: string;
  discNumber: number;
  trackNumber: number;
  title: string;
  artist: string;
  timeSeconds: number;
  rating: number | null;
  loved: boolean;
  filePath: string;
  filename: string;
  billboardSingleRank: number | null;
  officialUkRank: number | null;
  vgListaRank: number | null;
  isSingle: boolean;
  singleConfidence: string | null;
  singleYear: number | null;
}

export interface GenreFacet {
  name: string;
  count: number;
}

export interface ArtistSuggestion {
  name: string;
  count: number;
}

export interface DbStatus {
  libraryDir: string;
  libraryExists: boolean;
  analysisExists: boolean;
  clapExists: boolean;
  timelinesExists: boolean;
  totalAlbums: number;
  totalTracks: number;
  coversAvailable: number;
  sonicIndexReady: boolean;
}

export interface CatalogOverview {
  status: DbStatus;
  genres: GenreFacet[];
  yearMin: number;
  yearMax: number;
}

export interface QueryResult {
  queryId: number;
  totalCount: number;
  initialItems: AlbumSummary[];
  similarSource: AlbumSummary | null;
  similarityScores: number[];
}

export interface WindowResponse {
  items: AlbumSummary[];
  similarityScores: number[];
}

export interface ScrubberMark {
  index: number;
  label: string;
  sublabel: string;
  year: number | null;
}

export interface PlaybackState {
  status: "idle" | "playing" | "paused" | "loading";
  albumId: string | null;
  albumTitle: string;
  albumArtist: string;
  albumYear: number | null;
  trackIndex: number;
  totalTracks: number;
  track: TrackInfo | null;
  tracks: TrackInfo[];
  clipStartSec: number;
  clipDurationSec: number;
  clipElapsedSec: number;
  trackDurationSec: number;
  analysisReason: string;
  envelope: number[];
  clapWindows: number[];
  hasTimeline: boolean;
  hasClap: boolean;
  level: number;
  volume: number;
  isPinned: boolean;
  fullTrackMode: boolean;
  errorMessage: string | null;
  sourceView: string;
}

export const DEFAULT_FILTER: AlbumFilter = {
  search: "",
  genres: [],
  artist: null,
  yearMin: null,
  yearMax: null,
  chart: null,
  minRating: null,
  lovedOnly: false,
  hasCoverOnly: false,
  crateOnly: false,
  sortBy: "artist_asc",
  similarToAlbumId: null,
  randomSeed: 0,
};
