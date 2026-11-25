import React, { useState } from "react";
import {
  CheckCircle2,
  Database,
  Download,
  FolderOpen,
  RefreshCw,
  Sliders,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { api, formatSec } from "../api";
import type { UpdaterState } from "../hooks/useUpdater";
import type {
  AppSettings,
  CatalogOverview,
  PreviewMode,
  TrackOrder,
} from "../types";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSaveSettings: (next: AppSettings) => Promise<void>;
  overview: CatalogOverview | null;
  onReloadLibrary: () => Promise<void>;
  updater: UpdaterState;
  onCheckUpdates: () => void;
  onInstallUpdate: () => void;
}

const PREVIEW_STRATEGIES: {
  id: PreviewMode;
  title: string;
  desc: string;
}[] = [
  {
    id: "smart_highlight",
    title: "Smart Highlight (BLISS Timelines + CLAP)",
    desc: "Analyzes 1-second chroma repetition, loudness peaks, and CLAP anchors to jump straight to the chorus or strongest section.",
  },
  {
    id: "clap_best",
    title: "CLAP Representative Window",
    desc: "Uses the precomputed 3×10s CLAP timestamps from music-clap.sqlite3 and picks the highest-energy window.",
  },
  {
    id: "middle",
    title: "Middle of Track",
    desc: "Centers each preview clip right at the midpoint (50%) of every song.",
  },
  {
    id: "start",
    title: "From Start (0:00)",
    desc: "Plays the opening seconds of each track from the very beginning.",
  },
  {
    id: "percentage",
    title: "Custom Percentage",
    desc: "Starts at a chosen percentage into every track (e.g. 25%, 35%, 60%).",
  },
  {
    id: "fixed_offset",
    title: "Fixed Timestamp Offset",
    desc: "Jumps to an exact time like 0:30, 1:00, 1:30, or 2:00 (automatically clamped for shorter songs).",
  },
];

const FIXED_OFFSETS = [15, 30, 45, 60, 90, 120, 150, 180];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  settings,
  onSaveSettings,
  overview,
  onReloadLibrary,
  updater,
  onCheckUpdates,
  onInstallUpdate,
}) => {
  const [tab, setTab] = useState<"playback" | "library" | "updates">("playback");
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) setDraft(settings);
  }, [open, settings]);

  if (!open) return null;

  const patch = (p: Partial<AppSettings>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    void onSaveSettings(next);
  };

  const handleRebuildSonic = async () => {
    setBusyMsg("Building Sonic Vibe album index from music-analysis.sqlite3…");
    try {
      const count = await api.rebuildSonicIndex();
      setBusyMsg(`Indexed ${count.toLocaleString()} album sonic vectors!`);
      await onReloadLibrary();
    } catch (e) {
      setBusyMsg(`Failed: ${String(e)}`);
    }
  };

  const handleClearCache = async () => {
    setBusyMsg("Clearing thumbnail cache…");
    try {
      const n = await api.clearCoverCache();
      setBusyMsg(`Cleared ${n.toLocaleString()} cached cover thumbnails.`);
    } catch (e) {
      setBusyMsg(`Failed: ${String(e)}`);
    }
  };

  const status = overview?.status;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[84vh] rounded-2xl glass-panel shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-4 h-4 text-amber-400" />
            <h2 className="text-base font-semibold text-white">Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 flex gap-1 border-b border-white/[0.06]">
          {(
            [
              { id: "playback", label: "Preview & Audio", icon: Sparkles },
              { id: "library", label: "Library & Databases", icon: Database },
              { id: "updates", label: "Updates & About", icon: Download },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                  active
                    ? "border-amber-400 text-amber-200"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {tab === "playback" && (
            <>
              {/* Preview Strategy */}
              <div className="space-y-2.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Preview Start Strategy
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PREVIEW_STRATEGIES.map((s) => {
                    const selected = draft.previewMode === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => patch({ previewMode: s.id })}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          selected
                            ? "bg-amber-400/15 border-amber-400/50 text-white"
                            : "bg-white/[0.03] border-white/[0.07] text-zinc-300 hover:bg-white/[0.06]"
                        }`}
                      >
                        <div className="text-xs font-semibold flex items-center justify-between">
                          <span>{s.title}</span>
                          {selected && (
                            <span className="w-2 h-2 rounded-full bg-amber-400" />
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                          {s.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Conditional controls for Percentage / Fixed Offset */}
                {draft.previewMode === "percentage" && (
                  <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-300">Start Position Percentage</span>
                      <span className="font-mono text-amber-300 tabular-nums">
                        {draft.previewPercentage}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={90}
                      step={5}
                      value={draft.previewPercentage}
                      onChange={(e) =>
                        patch({ previewPercentage: Number(e.target.value) })
                      }
                      className="studio-range w-full"
                    />
                  </div>
                )}

                {draft.previewMode === "fixed_offset" && (
                  <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-2.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-300">Fixed Start Timestamp</span>
                      <span className="font-mono text-amber-300 tabular-nums">
                        {formatSec(draft.previewFixedOffsetSec)} ({draft.previewFixedOffsetSec}s)
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FIXED_OFFSETS.map((sec) => (
                        <button
                          key={sec}
                          onClick={() => patch({ previewFixedOffsetSec: sec })}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono border cursor-pointer ${
                            draft.previewFixedOffsetSec === sec
                              ? "bg-amber-400/20 border-amber-400/50 text-amber-100"
                              : "bg-white/[0.04] border-white/[0.07] text-zinc-300 hover:bg-white/[0.08]"
                          }`}
                        >
                          {formatSec(sec)}
                        </button>
                      ))}
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={300}
                      step={5}
                      value={draft.previewFixedOffsetSec}
                      onChange={(e) =>
                        patch({ previewFixedOffsetSec: Number(e.target.value) })
                      }
                      className="studio-range w-full"
                    />
                  </div>
                )}
              </div>

              {/* Clip Duration & Crossfade */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300 font-medium">Clip Duration</span>
                    <span className="font-mono text-amber-300 tabular-nums">
                      {draft.clipDurationSec} seconds
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    step={1}
                    value={draft.clipDurationSec}
                    onChange={(e) =>
                      patch({ clipDurationSec: Number(e.target.value) })
                    }
                    className="studio-range w-full"
                  />
                  <div className="flex gap-1.5">
                    {[10, 15, 20, 30, 45].map((s) => (
                      <button
                        key={s}
                        onClick={() => patch({ clipDurationSec: s })}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono border cursor-pointer ${
                          draft.clipDurationSec === s
                            ? "bg-amber-400/20 border-amber-400/40 text-amber-100"
                            : "bg-white/[0.04] border-white/[0.06] text-zinc-400 hover:text-white"
                        }`}
                      >
                        {s}s
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300 font-medium">Fade In / Out</span>
                    <span className="font-mono text-amber-300 tabular-nums">
                      {draft.fadeMs} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1800}
                    step={50}
                    value={draft.fadeMs}
                    onChange={(e) => patch({ fadeMs: Number(e.target.value) })}
                    className="studio-range w-full"
                  />
                </div>
              </div>

              {/* Track Order & Delays */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    Track Preview Order
                  </label>
                  <select
                    value={draft.trackOrder}
                    onChange={(e) =>
                      patch({ trackOrder: e.target.value as TrackOrder })
                    }
                    className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400/50"
                  >
                    <option value="sequential" className="bg-[#12131a]">
                      Album Order (Track 1 → N)
                    </option>
                    <option value="loved_first" className="bg-[#12131a]">
                      Loved Tracks First
                    </option>
                    <option value="rated_first" className="bg-[#12131a]">
                      Highest Rated Tracks First
                    </option>
                    <option value="shuffle" className="bg-[#12131a]">
                      Shuffle Tracks
                    </option>
                  </select>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300 font-medium">Cover Wall Hover Delay</span>
                    <span className="font-mono text-zinc-300 tabular-nums">
                      {draft.hoverDelayMs} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={800}
                    step={20}
                    value={draft.hoverDelayMs}
                    onChange={(e) =>
                      patch({ hoverDelayMs: Number(e.target.value) })
                    }
                    className="studio-range w-full"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300 font-medium">
                      Cover Flow Settle Delay
                    </span>
                    <span className="font-mono text-zinc-300 tabular-nums">
                      {draft.coverFlowDelayMs} ms
                    </span>
                  </div>
                  <input
                    type="range"
                    min={80}
                    max={900}
                    step={20}
                    value={draft.coverFlowDelayMs}
                    onChange={(e) =>
                      patch({ coverFlowDelayMs: Number(e.target.value) })
                    }
                    className="studio-range w-full"
                  />
                </div>

                <div className="space-y-2.5 flex flex-col justify-center">
                  <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
                    <span>Full Track Playback (no clip cutoff)</span>
                    <input
                      type="checkbox"
                      checked={draft.fullTrackMode}
                      onChange={(e) =>
                        patch({ fullTrackMode: e.target.checked })
                      }
                      className="accent-amber-400"
                    />
                  </label>
                  <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
                    <span>Play Singles First (MusicBrainz + Charts)</span>
                    <input
                      type="checkbox"
                      checked={draft.singlesFirst}
                      onChange={(e) =>
                        patch({ singlesFirst: e.target.checked })
                      }
                      className="accent-fuchsia-400"
                    />
                  </label>
                  <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
                    <span>Loudness Normalization (Timelines dB)</span>
                    <input
                      type="checkbox"
                      checked={draft.normalizeLoudness}
                      onChange={(e) =>
                        patch({ normalizeLoudness: e.target.checked })
                      }
                      className="accent-amber-400"
                    />
                  </label>
                  <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
                    <span>Auto-preview when selecting in Cover Flow</span>
                    <input
                      type="checkbox"
                      checked={draft.autoPlayOnSelect}
                      onChange={(e) =>
                        patch({ autoPlayOnSelect: e.target.checked })
                      }
                      className="accent-amber-400"
                    />
                  </label>
                </div>
              </div>

              {/* Hands-Free Auto-Surf Jukebox */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-white/[0.06]">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300 font-medium">Auto-Surf Clips per Album</span>
                    <span className="font-mono text-amber-300 tabular-nums">
                      {draft.autoSurfTracksPerAlbum}{" "}
                      {draft.autoSurfTracksPerAlbum === 1 ? "track" : "tracks"}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => patch({ autoSurfTracksPerAlbum: n })}
                        className={`flex-1 py-1 rounded-lg text-xs font-mono border cursor-pointer ${
                          draft.autoSurfTracksPerAlbum === n
                            ? "bg-amber-400/20 border-amber-400/50 text-amber-100"
                            : "bg-white/[0.04] border-white/[0.06] text-zinc-400 hover:text-white"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium text-zinc-300">Auto-Surf Order</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        { id: "sequential", label: "Next Album" },
                        { id: "random", label: "Random Album" },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => patch({ autoSurfOrder: opt.id })}
                        className={`py-1.5 px-2 rounded-lg text-xs border cursor-pointer ${
                          draft.autoSurfOrder === opt.id
                            ? "bg-amber-400/20 border-amber-400/50 text-amber-100"
                            : "bg-white/[0.04] border-white/[0.06] text-zinc-400 hover:text-white"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === "library" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <FolderOpen className="w-3.5 h-3.5" /> Music Library Data Directory
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft.libraryDir}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, libraryDir: e.target.value }))
                    }
                    className="flex-1 px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-xs font-mono text-zinc-100 focus:outline-none focus:border-amber-400/50"
                  />
                  <button
                    onClick={() => void onSaveSettings(draft)}
                    className="px-3.5 py-2 rounded-lg bg-amber-400 text-zinc-950 font-semibold text-xs hover:bg-amber-300 cursor-pointer"
                  >
                    Apply & Reload
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  All databases are opened strictly read-only so they never lock or interfere with your main music library app.
                </p>
              </div>

              {/* Database Status Grid */}
              {status && (
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    {
                      name: "music-library.sqlite3",
                      ok: status.libraryExists,
                      detail: `${status.totalAlbums.toLocaleString()} albums · ${status.totalTracks.toLocaleString()} tracks`,
                    },
                    {
                      name: "music-timelines.sqlite3",
                      ok: status.timelinesExists,
                      detail: "BLISS 1s chroma & loudness timelines",
                    },
                    {
                      name: "music-clap.sqlite3",
                      ok: status.clapExists,
                      detail: "CLAP 3×10s representative windows",
                    },
                    {
                      name: "music-analysis.sqlite3",
                      ok: status.analysisExists,
                      detail: status.sonicIndexReady
                        ? "Sonic Vibe index cached & ready"
                        : "Sonic index builds lazily on first use",
                    },
                  ].map((db) => (
                    <div
                      key={db.name}
                      className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-start gap-2.5"
                    >
                      {db.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-zinc-100 truncate">
                          {db.name}
                        </div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">
                          {db.detail}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Maintenance Actions */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
                <button
                  onClick={() => void onReloadLibrary()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs text-zinc-200 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reload Library Catalog
                </button>
                <button
                  onClick={() => void handleRebuildSonic()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-amber-400/20 text-xs text-amber-200 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Build / Refresh Sonic Vibe Index
                </button>
                <button
                  onClick={() => void handleClearCache()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-rose-500/20 text-xs text-zinc-300 hover:text-rose-200 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Thumbnail Cache
                </button>
              </div>

              {busyMsg && (
                <div className="px-3.5 py-2 rounded-lg bg-amber-400/10 border border-amber-400/30 text-xs text-amber-200">
                  {busyMsg}
                </div>
              )}
            </div>
          )}

          {tab === "updates" && (
            <div className="space-y-5">
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-white">
                    Cover Display v{updater.currentVersion}
                  </div>
                  <div className="text-xs text-zinc-400 mt-0.5">
                    Automatically checks for updates on startup and every 30 minutes.
                    {updater.lastCheckedAt && ` Last checked at ${updater.lastCheckedAt}.`}
                  </div>
                </div>

                <button
                  onClick={onCheckUpdates}
                  disabled={updater.checking || updater.downloading || updater.installing}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white disabled:opacity-40 cursor-pointer shrink-0"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${updater.checking ? "animate-spin" : ""}`}
                  />
                  {updater.checking ? "Checking…" : "Check Now"}
                </button>
              </div>

              <label className="flex items-center justify-between p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] cursor-pointer">
                <div>
                  <div className="text-xs font-medium text-zinc-100">
                    Fully Automatic Background Updates
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">
                    When enabled, newly detected versions download, install silently, and restart the app automatically.
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={draft.autoInstallUpdates}
                  onChange={(e) =>
                    patch({ autoInstallUpdates: e.target.checked })
                  }
                  className="accent-amber-400 ml-4"
                />
              </label>

              {updater.available && (
                <div className="p-4 rounded-xl bg-amber-400/12 border border-amber-400/35 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-amber-200">
                        Update Ready: v{updater.newVersion}
                      </div>
                      {updater.releaseNotes && (
                        <p className="text-[11px] text-zinc-300 mt-1 whitespace-pre-line">
                          {updater.releaseNotes}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={onInstallUpdate}
                      disabled={updater.downloading || updater.installing}
                      className="px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-950 font-semibold text-xs shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      {updater.installing
                        ? "Installing & Restarting…"
                        : updater.downloading
                        ? `Downloading ${updater.progressPct}%`
                        : "Update & Restart"}
                    </button>
                  </div>

                  {(updater.downloading || updater.installing) && (
                    <div className="w-full h-1.5 rounded-full bg-black/40 overflow-hidden">
                      <div
                        className="h-full bg-amber-400 transition-all duration-150"
                        style={{ width: `${updater.progressPct}%` }}
                      />
                    </div>
                  )}
                </div>
              )}

              {updater.upToDateNotice && (
                <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200">
                  You are running the latest version (v{updater.currentVersion}).
                </div>
              )}

              {updater.error && (
                <div className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
                  Update check note: {updater.error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
