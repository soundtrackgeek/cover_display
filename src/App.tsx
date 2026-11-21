import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Disc3,
  Download,
  Grid2x2,
  Layers,
  Search,
  Settings,
  Shuffle,
  X,
} from "lucide-react";
import { api } from "./api";
import { CoverFlowView } from "./components/CoverFlowView";
import { CoverWallView } from "./components/CoverWallView";
import { FilterBar } from "./components/FilterBar";
import { PlayerBar } from "./components/PlayerBar";
import { SettingsModal } from "./components/SettingsModal";
import { useAlbumWindow } from "./hooks/useAlbumWindow";
import { useUpdater } from "./hooks/useUpdater";
import type {
  AlbumFilter,
  AlbumSummary,
  AppSettings,
  CatalogOverview,
  PlaybackState,
  ViewMode,
} from "./types";
import { DEFAULT_FILTER } from "./types";

const INITIAL_SETTINGS: AppSettings = {
  libraryDir: "",
  clipDurationSec: 15,
  fadeMs: 650,
  previewMode: "smart_highlight",
  previewPercentage: 35,
  previewFixedOffsetSec: 60,
  trackOrder: "sequential",
  singlesFirst: true,
  normalizeLoudness: true,
  volume: 0.85,
  hoverDelayMs: 220,
  coverFlowDelayMs: 260,
  wallTileSize: 172,
  wallGap: 6,
  autoPlayOnSelect: true,
  autoInstallUpdates: true,
  savedFilters: [],
};

const INITIAL_PLAYBACK: PlaybackState = {
  status: "idle",
  albumId: null,
  albumTitle: "",
  albumArtist: "",
  albumYear: null,
  trackIndex: 0,
  totalTracks: 0,
  track: null,
  tracks: [],
  clipStartSec: 0,
  clipDurationSec: 15,
  clipElapsedSec: 0,
  trackDurationSec: 0,
  analysisReason: "",
  envelope: [],
  clapWindows: [],
  hasTimeline: false,
  hasClap: false,
  level: 0,
  volume: 0.85,
  isPinned: false,
  sourceView: "coverflow",
};

export function App() {
  const [view, setView] = useState<ViewMode>("coverflow");
  const [settings, setSettings] = useState<AppSettings>(INITIAL_SETTINGS);
  const [overview, setOverview] = useState<CatalogOverview | null>(null);
  const [filter, setFilter] = useState<AlbumFilter>(DEFAULT_FILTER);
  const [searchInput, setSearchInput] = useState("");

  const [queryId, setQueryId] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [initialItems, setInitialItems] = useState<AlbumSummary[]>([]);
  const [initialScores, setInitialScores] = useState<number[]>([]);
  const [similarSource, setSimilarSource] = useState<AlbumSummary | null>(null);
  const [loadingSimilar, setLoadingSimilar] = useState(false);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL_PLAYBACK);
  const [accentRgb, setAccentRgb] = useState<[number, number, number]>([217, 138, 46]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  const { updater, checkForUpdates, installUpdate } = useUpdater(
    settings.autoInstallUpdates
  );

  const { getAlbum, ensureRange } = useAlbumWindow(
    queryId,
    totalCount,
    initialItems,
    initialScores
  );

  // Initial bootstrap: load settings, catalog overview, and current playback state
  useEffect(() => {
    Promise.all([
      api.getSettings(),
      api.getCatalogOverview(),
      api.getPlaybackState(),
    ])
      .then(([cfg, ov, pb]) => {
        setSettings(cfg);
        setOverview(ov);
        setPlayback(pb);
      })
      .catch(console.error);
  }, []);

  // Listen for live audio playback telemetry & async catalog ready event from Rust
  useEffect(() => {
    const unlistenPlayback = listen<PlaybackState>("playback-state", (ev) => {
      setPlayback(ev.payload);
    });
    const unlistenCatalog = listen<CatalogOverview>("catalog-ready", (ev) => {
      setOverview(ev.payload);
      setFilter((f) => ({ ...f }));
    });
    return () => {
      void unlistenPlayback.then((fn) => fn());
      void unlistenCatalog.then((fn) => fn());
    };
  }, []);

  // Debounce search text into filter
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilter((cur) =>
        cur.search === searchInput ? cur : { ...cur, search: searchInput }
      );
    }, 140);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Execute Rust-side album filter & sort whenever filter changes
  useEffect(() => {
    let active = true;
    if (filter.similarToAlbumId) {
      setLoadingSimilar(true);
    }
    api
      .queryAlbums(filter)
      .then((res) => {
        if (!active) return;
        setQueryId(res.queryId);
        setTotalCount(res.totalCount);
        setInitialItems(res.initialItems);
        setInitialScores(res.similarityScores);
        setSimilarSource(res.similarSource);
        setSelectedIndex(0);
        setLoadingSimilar(false);
      })
      .catch((err) => {
        console.error(err);
        if (active) setLoadingSimilar(false);
      });
    return () => {
      active = false;
    };
  }, [filter]);

  // Update adaptive ambient accent color for the centered/active album
  const activeAccentAlbumId =
    view === "coverflow"
      ? getAlbum(selectedIndex).album?.id ?? playback.albumId
      : playback.albumId;

  useEffect(() => {
    if (!activeAccentAlbumId) return;
    let active = true;
    const timer = window.setTimeout(() => {
      api
        .getAlbumAccentColor(activeAccentAlbumId)
        .then((rgb) => {
          if (active) setAccentRgb(rgb);
        })
        .catch(() => {});
    }, 80);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [activeAccentAlbumId]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      if (inInput) return;

      if (e.code === "Space") {
        e.preventDefault();
        void api.togglePause();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        void api.nextTrack();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        void api.prevTrack();
      } else if (e.key === "1") {
        setView("coverflow");
      } else if (e.key === "2") {
        setView("wall");
      } else if ((e.key === "r" || e.key === "R") && totalCount > 1) {
        const randIdx = Math.floor(Math.random() * totalCount);
        ensureRange(randIdx - 24, randIdx + 24);
        setSelectedIndex(randIdx);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalCount, ensureRange]);

  const handleSaveSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    const saved = await api.updateSettings(next);
    setSettings(saved);
    const ov = await api.getCatalogOverview();
    setOverview(ov);
  }, []);

  const handleQuickUpdateSettings = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        void api.updateSettings(next);
        return next;
      });
    },
    []
  );

  const handleReloadLibrary = useCallback(async () => {
    const ov = await api.reloadLibrary();
    setOverview(ov);
    setFilter((f) => ({ ...f }));
  }, []);

  const handleFilterArtist = useCallback((artist: string) => {
    setSearchInput("");
    setFilter({
      ...DEFAULT_FILTER,
      artist,
      sortBy: "year_asc",
    });
  }, []);

  const handleFindSimilar = useCallback((albumId: string) => {
    setSearchInput("");
    setFilter({
      ...DEFAULT_FILTER,
      similarToAlbumId: albumId,
    });
  }, []);

  const handleSavePreset = useCallback(
    (name: string) => {
      const id = `preset_${Date.now()}`;
      const next: AppSettings = {
        ...settings,
        savedFilters: [...settings.savedFilters, { id, name, filter }],
      };
      void handleSaveSettings(next);
    },
    [settings, filter, handleSaveSettings]
  );

  const handleDeletePreset = useCallback(
    (id: string) => {
      const next: AppSettings = {
        ...settings,
        savedFilters: settings.savedFilters.filter((p) => p.id !== id),
      };
      void handleSaveSettings(next);
    },
    [settings, handleSaveSettings]
  );

  const handleJumpRandom = useCallback(() => {
    if (totalCount <= 1) return;
    let randIdx = Math.floor(Math.random() * totalCount);
    if (randIdx === selectedIndex) {
      randIdx = (randIdx + 1) % totalCount;
    }
    ensureRange(randIdx - 24, randIdx + 24);
    setSelectedIndex(randIdx);
    if (view !== "coverflow") {
      setView("coverflow");
    }
  }, [totalCount, selectedIndex, view, ensureRange]);

  const handleOpenInCoverFlow = useCallback((index: number) => {
    setSelectedIndex(index);
    setView("coverflow");
  }, []);

  return (
    <div className="w-full h-full flex flex-col bg-[#09090d] text-zinc-100 overflow-hidden">
      {/* Studio Top Bar */}
      <header className="relative z-40 h-14 px-5 border-b border-white/[0.07] bg-[#0b0c12]/90 backdrop-blur-2xl flex items-center justify-between gap-4">
        {/* Brand & View Mode Switcher */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Disc3 className="w-4.5 h-4.5 text-zinc-950 stroke-[2.2]" />
            </div>
            <div className="leading-tight hidden md:block">
              <div className="text-sm font-bold tracking-tight text-white">
                Cover Display
              </div>
              <div className="text-[10px] text-zinc-500 font-mono tabular-nums">
                {overview
                  ? `${overview.status.totalAlbums.toLocaleString()} albums`
                  : "Loading…"}
              </div>
            </div>
          </div>

          {/* Segmented View Toggle */}
          <div className="flex items-center p-1 rounded-xl bg-white/[0.05] border border-white/[0.08]">
            <button
              onClick={() => setView("coverflow")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                view === "coverflow"
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
              title="Classic 3D Cover Flow (1)"
            >
              <Layers className="w-3.5 h-3.5" />
              Cover Flow
            </button>
            <button
              onClick={() => {
                setView("wall");
                if (!playback.isPinned) {
                  void api.stopPlayback(true);
                }
              }}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                view === "wall"
                  ? "bg-white text-zinc-950 shadow-sm"
                  : "text-zinc-400 hover:text-white"
              }`}
              title="Endless Hover-Preview Cover Wall (2)"
            >
              <Grid2x2 className="w-3.5 h-3.5" />
              Cover Wall
            </button>
          </div>
        </div>

        {/* Instant Global Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            ref={searchRef}
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search artist, album, genre, year, label… ( / )"
            className="w-full pl-9 pr-8 py-1.5 rounded-xl bg-white/[0.05] border border-white/[0.09] text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400/50 focus:bg-white/[0.08] transition-all"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right Controls: Count, Random Jump, Update Pill, Settings */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="px-2.5 py-1 rounded-lg bg-white/[0.04] border border-white/[0.07] text-[11px] font-mono text-zinc-300 tabular-nums">
            {totalCount.toLocaleString()}{" "}
            <span className="text-zinc-500">
              {totalCount === 1 ? "album" : "albums"}
            </span>
          </div>

          <button
            onClick={handleJumpRandom}
            disabled={totalCount <= 1}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.08] text-xs text-zinc-200 transition-colors cursor-pointer disabled:opacity-30"
            title="Jump to a random album (R)"
          >
            <Shuffle className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden lg:inline">Surprise Me</span>
          </button>

          {/* In-App Auto-Update Pill */}
          {(updater.available || updater.downloading || updater.installing) && (
            <button
              onClick={() => void installUpdate()}
              disabled={updater.downloading || updater.installing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 text-xs font-semibold shadow-lg shadow-amber-500/25 transition-all cursor-pointer disabled:opacity-80"
              title="Download, install silently, and restart Cover Display automatically"
            >
              <Download className="w-3.5 h-3.5" />
              {updater.installing
                ? "Restarting…"
                : updater.downloading
                ? `Updating ${updater.progressPct}%`
                : `Update v${updater.newVersion}`}
            </button>
          )}

          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg bg-white/[0.05] hover:bg-white/[0.11] border border-white/[0.08] text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Settings & Updates"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Faceted Filter & Quick Discovery Bar */}
      <FilterBar
        filter={filter}
        onChange={(next) => {
          setFilter(next);
          if (next.search !== searchInput) setSearchInput(next.search);
        }}
        genres={overview?.genres ?? []}
        savedPresets={settings.savedFilters}
        onSavePreset={handleSavePreset}
        onDeletePreset={handleDeletePreset}
        similarSource={similarSource}
        loadingSimilar={loadingSimilar}
      />

      {/* Main Content Stage: Cover Flow OR Cover Wall */}
      <main className="relative flex-1 flex flex-col overflow-hidden">
        {overview && overview.status.totalAlbums === 0 && overview.status.libraryExists ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
            <Disc3 className="w-10 h-10 text-amber-400 animate-spin" />
            <div className="text-sm font-medium text-zinc-200">
              Loading your music library…
            </div>
            <div className="text-xs text-zinc-500 font-mono">
              Reading albums and cover art index
            </div>
          </div>
        ) : view === "coverflow" ? (
          <CoverFlowView
            queryId={queryId}
            totalCount={totalCount}
            getAlbum={getAlbum}
            ensureRange={ensureRange}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            settings={settings}
            playback={playback}
            accentRgb={accentRgb}
            onFilterArtist={handleFilterArtist}
            onFindSimilar={handleFindSimilar}
          />
        ) : (
          <CoverWallView
            queryId={queryId}
            totalCount={totalCount}
            getAlbum={getAlbum}
            ensureRange={ensureRange}
            settings={settings}
            onUpdateTileSize={(wallTileSize) =>
              handleQuickUpdateSettings({ wallTileSize })
            }
            playback={playback}
            onFilterArtist={handleFilterArtist}
            onFindSimilar={handleFindSimilar}
            onOpenInCoverFlow={handleOpenInCoverFlow}
          />
        )}
      </main>

      {/* Studio Preview Deck */}
      <PlayerBar
        playback={playback}
        settings={settings}
        onQuickUpdateSettings={handleQuickUpdateSettings}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {/* Settings & Auto-Updater Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
        overview={overview}
        onReloadLibrary={handleReloadLibrary}
        updater={updater}
        onCheckUpdates={() => void checkForUpdates(true)}
        onInstallUpdate={() => void installUpdate()}
      />
    </div>
  );
}

export default App;
