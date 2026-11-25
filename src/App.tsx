import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
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
import { CrateDrawer } from "./components/CrateDrawer";
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
  fullTrackMode: false,
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
  crateAlbumIds: [],
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
  fullTrackMode: false,
  sourceView: "coverflow",
};

interface NavEntry {
  filter: AlbumFilter;
  selectedIndex: number;
  view: ViewMode;
}

const MAX_HISTORY = 50;

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
  const [wallScrollNonce, setWallScrollNonce] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState>(INITIAL_PLAYBACK);
  const [accentRgb, setAccentRgb] = useState<[number, number, number]>([217, 138, 46]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [crateOpen, setCrateOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Browser-style navigation history stack (Back / Forward)
  const historyRef = useRef<NavEntry[]>([
    { filter: DEFAULT_FILTER, selectedIndex: 0, view: "coverflow" },
  ]);
  const historyIdxRef = useRef<number>(0);
  const [, setHistoryTick] = useState(0);
  const pendingRestoreIndexRef = useRef<number | null>(null);
  const skipSearchDebounceRef = useRef<boolean>(false);
  const selectedIndexRef = useRef<number>(0);
  const viewRef = useRef<ViewMode>("coverflow");
  selectedIndexRef.current = selectedIndex;
  viewRef.current = view;

  const canGoBack = historyIdxRef.current > 0;
  const canGoForward = historyIdxRef.current < historyRef.current.length - 1;

  const navigateToFilter = useCallback(
    (
      nextFilter: AlbumFilter,
      opts?: { replace?: boolean; nextView?: ViewMode; syncSearch?: boolean }
    ) => {
      const stack = historyRef.current;
      const curIdx = historyIdxRef.current;
      if (stack[curIdx]) {
        stack[curIdx] = {
          ...stack[curIdx],
          selectedIndex: selectedIndexRef.current,
          view: viewRef.current,
        };
      }

      const targetView = opts?.nextView ?? viewRef.current;
      const newEntry: NavEntry = {
        filter: nextFilter,
        selectedIndex: 0,
        view: targetView,
      };

      if (opts?.replace && curIdx >= 0) {
        stack[curIdx] = newEntry;
      } else {
        const sliced = stack.slice(0, curIdx + 1);
        sliced.push(newEntry);
        if (sliced.length > MAX_HISTORY) {
          sliced.shift();
        }
        historyRef.current = sliced;
        historyIdxRef.current = sliced.length - 1;
      }

      setHistoryTick((t) => t + 1);
      if (opts?.syncSearch) {
        skipSearchDebounceRef.current = true;
        setSearchInput(nextFilter.search);
      }
      if (opts?.nextView) {
        setView(opts.nextView);
      }
      setFilter(nextFilter);
    },
    []
  );

  const handleHistoryBack = useCallback(() => {
    const stack = historyRef.current;
    const curIdx = historyIdxRef.current;
    if (curIdx <= 0) return;

    stack[curIdx] = {
      ...stack[curIdx],
      selectedIndex: selectedIndexRef.current,
      view: viewRef.current,
    };

    const nextIdx = curIdx - 1;
    historyIdxRef.current = nextIdx;
    const target = stack[nextIdx];
    pendingRestoreIndexRef.current = target.selectedIndex;
    skipSearchDebounceRef.current = true;
    setHistoryTick((t) => t + 1);
    setView(target.view);
    setSearchInput(target.filter.search);
    setFilter({ ...target.filter });
  }, []);

  const handleHistoryForward = useCallback(() => {
    const stack = historyRef.current;
    const curIdx = historyIdxRef.current;
    if (curIdx >= stack.length - 1) return;

    stack[curIdx] = {
      ...stack[curIdx],
      selectedIndex: selectedIndexRef.current,
      view: viewRef.current,
    };

    const nextIdx = curIdx + 1;
    historyIdxRef.current = nextIdx;
    const target = stack[nextIdx];
    pendingRestoreIndexRef.current = target.selectedIndex;
    skipSearchDebounceRef.current = true;
    setHistoryTick((t) => t + 1);
    setView(target.view);
    setSearchInput(target.filter.search);
    setFilter({ ...target.filter });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 2600);
  }, []);

  const crateSet = useMemo(
    () => new Set(settings.crateAlbumIds),
    [settings.crateAlbumIds]
  );

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

  // Debounce search text into filter (coalescing consecutive typing into a single history step)
  useEffect(() => {
    if (skipSearchDebounceRef.current) {
      skipSearchDebounceRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (filter.search === searchInput) return;
      const replace = filter.search.trim() !== "" && searchInput.trim() !== "";
      navigateToFilter({ ...filter, search: searchInput }, { replace });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [searchInput, filter, navigateToFilter]);

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
        const restore = pendingRestoreIndexRef.current;
        pendingRestoreIndexRef.current = null;
        const nextSelected =
          restore != null
            ? Math.max(0, Math.min(Math.max(0, res.totalCount - 1), restore))
            : 0;
        setQueryId(res.queryId);
        setTotalCount(res.totalCount);
        setInitialItems(res.initialItems);
        setInitialScores(res.similarityScores);
        setSimilarSource(res.similarSource);
        setSelectedIndex(nextSelected);
        if (restore != null) {
          setWallScrollNonce((n) => n + 1);
        }
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

  const handleToggleCrate = useCallback(
    (albumId: string) => {
      const wasIn = crateSet.has(albumId);
      api
        .toggleCrateAlbum(albumId)
        .then((nextIds) => {
          setSettings((prev) => ({ ...prev, crateAlbumIds: nextIds }));
          showToast(wasIn ? "Removed from Discovery Crate" : "Saved to Discovery Crate");
          setFilter((f) => (f.crateOnly ? { ...f } : f));
        })
        .catch((err) => showToast(`Crate error: ${String(err)}`));
    },
    [crateSet, showToast]
  );

  const handleClearCrate = useCallback(() => {
    api
      .clearCrate()
      .then((nextIds) => {
        setSettings((prev) => ({ ...prev, crateAlbumIds: nextIds }));
        showToast("Cleared Discovery Crate");
        setFilter((f) => (f.crateOnly ? { ...DEFAULT_FILTER } : f));
      })
      .catch((err) => showToast(`Failed to clear crate: ${String(err)}`));
  }, [showToast]);

  const handleOpenFolder = useCallback(
    (albumId: string) => {
      api
        .openAlbumFolder(albumId)
        .catch((err) => showToast(String(err)));
    },
    [showToast]
  );

  const handleExportCrateM3u = useCallback(async () => {
    try {
      const savedPath = await api.exportCrateM3u();
      showToast(`Exported playlist to ${savedPath}`);
    } catch (err) {
      showToast(`Export failed: ${String(err)}`);
    }
  }, [showToast]);

  const handleBrowseCrate = useCallback(() => {
    navigateToFilter(
      {
        ...DEFAULT_FILTER,
        crateOnly: true,
      },
      { syncSearch: true }
    );
    setCrateOpen(false);
  }, [navigateToFilter]);

  const handleSwitchView = useCallback(
    (nextView: ViewMode) => {
      if (nextView === view) return;
      if (nextView === "wall") {
        if (!playback.isPinned) {
          void api.stopPlayback(true);
        }
        setWallScrollNonce((n) => n + 1);
      }
      setView(nextView);
    },
    [view, playback.isPinned]
  );

  // Global keyboard shortcuts + mouse Back/Forward buttons
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        handleHistoryBack();
        return;
      }
      if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        handleHistoryForward();
        return;
      }

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
        handleSwitchView("coverflow");
      } else if (e.key === "2") {
        handleSwitchView("wall");
      } else if ((e.key === "r" || e.key === "R") && totalCount > 1) {
        const randIdx = Math.floor(Math.random() * totalCount);
        ensureRange(randIdx - 24, randIdx + 24);
        setSelectedIndex(randIdx);
        setWallScrollNonce((n) => n + 1);
      } else if (e.key === "b" || e.key === "B") {
        const targetId =
          view === "coverflow"
            ? getAlbum(selectedIndex).album?.id ?? playback.albumId
            : playback.albumId;
        if (targetId) {
          e.preventDefault();
          handleToggleCrate(targetId);
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        handleHistoryBack();
      } else if (e.button === 4) {
        e.preventDefault();
        handleHistoryForward();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    totalCount,
    ensureRange,
    view,
    getAlbum,
    selectedIndex,
    playback.albumId,
    handleToggleCrate,
    handleHistoryBack,
    handleHistoryForward,
    handleSwitchView,
  ]);

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

  const handleFilterArtist = useCallback(
    (artist: string) => {
      navigateToFilter(
        {
          ...DEFAULT_FILTER,
          artist,
          sortBy: "year_asc",
        },
        { syncSearch: true }
      );
    },
    [navigateToFilter]
  );

  const handleFindSimilar = useCallback(
    (albumId: string) => {
      navigateToFilter(
        {
          ...DEFAULT_FILTER,
          similarToAlbumId: albumId,
        },
        { syncSearch: true }
      );
    },
    [navigateToFilter]
  );

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
    setWallScrollNonce((n) => n + 1);
  }, [totalCount, selectedIndex, ensureRange]);

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

          {/* Back / Forward Navigation History */}
          <div className="flex items-center p-0.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
            <button
              onClick={handleHistoryBack}
              disabled={!canGoBack}
              className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-25 disabled:hover:bg-transparent transition-colors cursor-pointer"
              title="Back (Alt+← or Mouse Back)"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleHistoryForward}
              disabled={!canGoForward}
              className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-25 disabled:hover:bg-transparent transition-colors cursor-pointer"
              title="Forward (Alt+→ or Mouse Forward)"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Segmented View Toggle */}
          <div className="flex items-center p-1 rounded-xl bg-white/[0.05] border border-white/[0.08]">
            <button
              onClick={() => handleSwitchView("coverflow")}
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
              onClick={() => handleSwitchView("wall")}
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

          <button
            onClick={() => setCrateOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer ${
              settings.crateAlbumIds.length > 0
                ? "bg-amber-400/12 hover:bg-amber-400/20 border-amber-400/35 text-amber-100"
                : "bg-white/[0.05] hover:bg-white/[0.11] border-white/[0.08] text-zinc-300"
            }`}
            title="Open Discovery Crate (press B on any cover to save)"
          >
            <Bookmark
              className={`w-3.5 h-3.5 ${
                settings.crateAlbumIds.length > 0
                  ? "text-amber-300 fill-amber-300"
                  : "text-zinc-400"
              }`}
            />
            <span className="hidden lg:inline">Crate</span>
            {settings.crateAlbumIds.length > 0 && (
              <span className="px-1.5 py-[1px] rounded-full bg-amber-400 text-zinc-950 font-mono text-[10px] font-bold tabular-nums">
                {settings.crateAlbumIds.length}
              </span>
            )}
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
          navigateToFilter(next, { syncSearch: next.search !== searchInput });
        }}
        genres={overview?.genres ?? []}
        savedPresets={settings.savedFilters}
        onSavePreset={handleSavePreset}
        onDeletePreset={handleDeletePreset}
        similarSource={similarSource}
        loadingSimilar={loadingSimilar}
        crateCount={settings.crateAlbumIds.length}
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
            crateSet={crateSet}
            onToggleCrate={handleToggleCrate}
            onOpenFolder={handleOpenFolder}
          />
        ) : (
          <CoverWallView
            queryId={queryId}
            totalCount={totalCount}
            getAlbum={getAlbum}
            ensureRange={ensureRange}
            selectedIndex={selectedIndex}
            onSelectIndex={setSelectedIndex}
            scrollSyncNonce={wallScrollNonce}
            settings={settings}
            onUpdateTileSize={(wallTileSize) =>
              handleQuickUpdateSettings({ wallTileSize })
            }
            playback={playback}
            onFilterArtist={handleFilterArtist}
            onFindSimilar={handleFindSimilar}
            onOpenInCoverFlow={handleOpenInCoverFlow}
            crateSet={crateSet}
            onToggleCrate={handleToggleCrate}
            onOpenFolder={handleOpenFolder}
          />
        )}
      </main>

      {/* Studio Preview Deck */}
      <PlayerBar
        playback={playback}
        settings={settings}
        onQuickUpdateSettings={handleQuickUpdateSettings}
        onOpenSettings={() => setSettingsOpen(true)}
        isCrated={playback.albumId != null && crateSet.has(playback.albumId)}
        onToggleCrate={handleToggleCrate}
        onOpenFolder={handleOpenFolder}
      />

      {/* Discovery Crate Slide-Over Drawer */}
      <CrateDrawer
        open={crateOpen}
        onClose={() => setCrateOpen(false)}
        crateAlbumIds={settings.crateAlbumIds}
        activeAlbumId={playback.albumId}
        onRemoveAlbum={handleToggleCrate}
        onClearCrate={handleClearCrate}
        onBrowseCrate={handleBrowseCrate}
        onOpenFolder={handleOpenFolder}
        onExportM3u={handleExportCrateM3u}
      />

      {/* Subtle Floating Action Toast */}
      {toast && (
        <div className="pointer-events-none fixed left-1/2 -translate-x-1/2 bottom-[92px] z-50 px-3.5 py-1.5 rounded-full glass-panel border border-amber-400/35 text-xs font-medium text-amber-100 shadow-2xl">
          {toast}
        </div>
      )}

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
