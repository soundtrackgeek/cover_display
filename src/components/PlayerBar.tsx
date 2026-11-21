import React, { useMemo, useRef, useState } from "react";
import {
  ChevronUp,
  Heart,
  ListMusic,
  Pause,
  Pin,
  PinOff,
  Play,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { api, coverUrl, formatSec, previewModeLabel } from "../api";
import type { AppSettings, PlaybackState, PreviewMode } from "../types";

interface PlayerBarProps {
  playback: PlaybackState;
  settings: AppSettings;
  onQuickUpdateSettings: (patch: Partial<AppSettings>) => void;
  onOpenSettings: () => void;
}

const QUICK_MODES: { value: PreviewMode; label: string }[] = [
  { value: "smart_highlight", label: "Smart Highlight" },
  { value: "clap_best", label: "CLAP Best" },
  { value: "start", label: "Start" },
  { value: "middle", label: "Middle" },
  { value: "percentage", label: "Custom %" },
  { value: "fixed_offset", label: "Fixed Offset" },
];

const QUICK_CLIP_SECS = [10, 15, 20, 30, 45];

export const PlayerBar: React.FC<PlayerBarProps> = ({
  playback,
  settings,
  onQuickUpdateSettings,
  onOpenSettings,
}) => {
  const [showTracks, setShowTracks] = useState(false);
  const [hoverSec, setHoverSec] = useState<number | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);

  const isPlaying = playback.status === "playing";
  const isActive = playback.albumId !== null && playback.status !== "idle";
  const bars = useMemo(
    () => (playback.envelope.length > 0 ? playback.envelope : new Array(64).fill(0.22)),
    [playback.envelope]
  );

  const trackDur = Math.max(1, playback.trackDurationSec || playback.track?.timeSeconds || 1);
  const clipStartPct = (playback.clipStartSec / trackDur) * 100;
  const clipWidthPct = Math.min(
    100 - clipStartPct,
    (playback.clipDurationSec / trackDur) * 100
  );
  const playheadSec = playback.clipStartSec + playback.clipElapsedSec;
  const playheadPct = Math.min(100, (playheadSec / trackDur) * 100);

  const handleWaveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!waveRef.current || !playback.track) return;
    const rect = waveRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const sec = pct * trackDur;
    void api.previewTrackAt(playback.trackIndex, sec);
  };

  const handleWaveMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!waveRef.current || !playback.track) return;
    const rect = waveRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverSec(pct * trackDur);
  };

  return (
    <div className="relative z-40 h-[76px] px-5 border-t border-white/[0.08] bg-[#0b0c12]/92 backdrop-blur-2xl flex items-center gap-4">
      {/* Expandable Tracklist Popover */}
      {showTracks && playback.tracks.length > 0 && (
        <div className="absolute right-5 bottom-[84px] w-96 max-h-[360px] rounded-2xl glass-panel shadow-2xl overflow-hidden flex flex-col z-50">
          <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">
                {playback.albumTitle}
              </div>
              <div className="text-[11px] text-zinc-400 truncate">
                {playback.albumArtist} · {playback.tracks.length} tracks
              </div>
            </div>
            <button
              onClick={() => setShowTracks(false)}
              className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/10 cursor-pointer"
            >
              Close
            </button>
          </div>
          <div className="overflow-y-auto p-1.5 space-y-0.5">
            {playback.tracks.map((tr, i) => {
              const active = i === playback.trackIndex && isActive;
              return (
                <button
                  key={tr.id}
                  onClick={() => void api.previewTrackAt(i)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                    active
                      ? "bg-amber-400/20 text-amber-100 font-medium"
                      : "text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="w-5 text-right font-mono text-[10px] opacity-60 tabular-nums">
                    {String(tr.trackNumber || i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex-1 truncate">{tr.title}</span>
                  {tr.loved && <Heart className="w-3 h-3 fill-rose-400 text-rose-400 shrink-0" />}
                  <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                    {formatSec(tr.timeSeconds)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Left: Active Cover + Track Info */}
      <div className="flex items-center gap-3 w-[270px] min-w-[220px] shrink-0">
        <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-zinc-900 ring-1 ring-white/10 shrink-0">
          {playback.albumId ? (
            <img
              src={coverUrl(playback.albumId, 256)}
              alt={playback.albumTitle}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600">
              <ListMusic className="w-5 h-5" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {playback.track && isActive ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-white truncate">
                  {playback.track.title}
                </span>
                <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.07] text-zinc-300 tabular-nums">
                  {playback.trackIndex + 1}/{playback.totalTracks}
                </span>
              </div>
              <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                {playback.albumArtist} · {playback.albumTitle}
              </div>
            </>
          ) : (
            <>
              <div className="text-xs font-medium text-zinc-400">Ready to preview</div>
              <div className="text-[11px] text-zinc-500 truncate">
                Select in Cover Flow or hover on Cover Wall
              </div>
            </>
          )}
        </div>
      </div>

      {/* Transport Buttons */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          onClick={() => void api.prevTrack()}
          disabled={!isActive}
          className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-25 transition-colors cursor-pointer"
          title="Previous track (↑)"
        >
          <SkipBack className="w-4 h-4" />
        </button>
        <button
          onClick={() => void api.togglePause()}
          disabled={!isActive}
          className="w-9 h-9 rounded-full bg-white text-zinc-950 hover:bg-amber-300 disabled:opacity-25 flex items-center justify-center shadow-md transition-colors cursor-pointer"
          title="Play / Pause (Space)"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-zinc-950" />
          ) : (
            <Play className="w-4 h-4 ml-0.5 fill-zinc-950" />
          )}
        </button>
        <button
          onClick={() => void api.nextTrack()}
          disabled={!isActive}
          className="p-1.5 rounded-lg text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-25 transition-colors cursor-pointer"
          title="Next track (↓)"
        >
          <SkipForward className="w-4 h-4" />
        </button>
        <button
          onClick={() => void api.stopPlayback(false)}
          disabled={!isActive}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-300 hover:bg-white/10 disabled:opacity-25 transition-colors cursor-pointer"
          title="Stop preview"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>
        {isActive && (
          <button
            onClick={() => void api.setPinned(!playback.isPinned)}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              playback.isPinned
                ? "bg-amber-400/20 text-amber-300"
                : "text-zinc-500 hover:text-zinc-200 hover:bg-white/10"
            }`}
            title={playback.isPinned ? "Unpin album (Esc)" : "Pin album playback"}
          >
            {playback.isPinned ? (
              <Pin className="w-3.5 h-3.5" />
            ) : (
              <PinOff className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>

      {/* Center: Interactive BLISS Timeline Energy Waveform + CLAP Markers */}
      <div className="flex-1 min-w-[200px] flex flex-col gap-1">
        <div className="flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1.5 min-w-0">
            {isActive ? (
              <>
                <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="text-zinc-300 truncate font-medium">
                  {playback.analysisReason || previewModeLabel(settings.previewMode)}
                </span>
                <span className="font-mono text-amber-300/90 tabular-nums shrink-0">
                  {formatSec(playback.clipStartSec)}–
                  {formatSec(
                    Math.min(trackDur, playback.clipStartSec + playback.clipDurationSec)
                  )}
                </span>
              </>
            ) : (
              <span className="text-zinc-500">
                Mode: {previewModeLabel(settings.previewMode)} · {settings.clipDurationSec}s
                clips
              </span>
            )}
          </div>

          <div className="font-mono text-zinc-400 tabular-nums shrink-0">
            {hoverSec !== null && isActive ? (
              <span className="text-amber-200">Seek {formatSec(hoverSec)}</span>
            ) : isActive ? (
              <span>
                {formatSec(playheadSec)} / {formatSec(trackDur)}
              </span>
            ) : null}
          </div>
        </div>

        {/* 64-bar Energy Waveform */}
        <div
          ref={waveRef}
          onClick={handleWaveClick}
          onMouseMove={handleWaveMove}
          onMouseLeave={() => setHoverSec(null)}
          className={`relative h-8 rounded-lg bg-white/[0.03] border border-white/[0.06] overflow-hidden flex items-end gap-[2px] px-1.5 py-1 ${
            isActive ? "cursor-pointer" : "opacity-50"
          }`}
          title={
            isActive
              ? "Click anywhere on the song timeline to preview from that spot"
              : undefined
          }
        >
          {/* Active Clip Window Highlight Region */}
          {isActive && (
            <div
              className="pointer-events-none absolute inset-y-0 bg-amber-400/15 border-x border-amber-400/50"
              style={{
                left: `${clipStartPct}%`,
                width: `${Math.max(1.5, clipWidthPct)}%`,
              }}
            />
          )}

          {/* Bars */}
          {bars.map((amp, i) => {
            const barPct = ((i + 0.5) / bars.length) * 100;
            const inWindow =
              isActive &&
              barPct >= clipStartPct &&
              barPct <= clipStartPct + clipWidthPct;
            const passed = isActive && inWindow && barPct <= playheadPct;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors duration-100"
                style={{
                  height: `${Math.round(Math.max(14, amp * 100))}%`,
                  backgroundColor: passed
                    ? "#fbbf24"
                    : inWindow
                    ? "rgba(251, 191, 36, 0.45)"
                    : "rgba(255, 255, 255, 0.16)",
                }}
              />
            );
          })}

          {/* CLAP Representative Timestamps (tiny cyan diamond dots along top) */}
          {isActive &&
            playback.clapWindows.map((w, idx) => {
              const p = Math.max(1, Math.min(99, (w / trackDur) * 100));
              return (
                <div
                  key={idx}
                  className="pointer-events-none absolute top-0.5 w-1.5 h-1.5 -translate-x-1/2 rounded-full bg-cyan-400/80 shadow-[0_0_6px_rgba(34,211,238,0.8)]"
                  style={{ left: `${p}%` }}
                />
              );
            })}

          {/* Live Playhead */}
          {isActive && (
            <div
              className="pointer-events-none absolute inset-y-0 w-[2px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.9)]"
              style={{ left: `${playheadPct}%` }}
            />
          )}
        </div>
      </div>

      {/* Right: Quick Preview Strategy + Clip Sec + Volume + Tracklist */}
      <div className="flex items-center gap-2 shrink-0">
        <select
          value={settings.previewMode}
          onChange={(e) =>
            onQuickUpdateSettings({ previewMode: e.target.value as PreviewMode })
          }
          className="px-2 py-1 rounded-lg bg-white/[0.05] border border-white/[0.08] text-[11px] text-zinc-200 focus:outline-none focus:border-amber-400/50 cursor-pointer"
          title="Quick-switch preview highlight strategy"
        >
          {QUICK_MODES.map((m) => (
            <option key={m.value} value={m.value} className="bg-[#12131a] text-zinc-100">
              {m.label}
            </option>
          ))}
        </select>

        <button
          onClick={() => {
            const idx = QUICK_CLIP_SECS.indexOf(settings.clipDurationSec);
            const next = QUICK_CLIP_SECS[(idx + 1) % QUICK_CLIP_SECS.length];
            onQuickUpdateSettings({ clipDurationSec: next });
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            onOpenSettings();
          }}
          className="px-2 py-1 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] font-mono text-amber-200 tabular-nums cursor-pointer"
          title="Click to cycle clip duration (right-click for full settings)"
        >
          {settings.clipDurationSec}s
        </button>

        {/* Volume */}
        <div className="flex items-center gap-1.5 pl-1">
          <button
            onClick={() =>
              void api.setVolume(playback.volume > 0.01 ? 0 : settings.volume || 0.85)
            }
            className="text-zinc-400 hover:text-white cursor-pointer"
            title="Mute / Unmute"
          >
            {playback.volume <= 0.01 ? (
              <VolumeX className="w-4 h-4 text-zinc-500" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={playback.volume}
            onChange={(e) => void api.setVolume(Number(e.target.value))}
            className="studio-range w-20"
          />
        </div>

        {/* Tracklist Drawer Toggle */}
        <button
          onClick={() => setShowTracks((s) => !s)}
          disabled={playback.tracks.length === 0}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs transition-colors cursor-pointer disabled:opacity-25 ${
            showTracks
              ? "bg-amber-400/20 border-amber-400/40 text-amber-100"
              : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.1]"
          }`}
          title="Album tracklist"
        >
          <ListMusic className="w-3.5 h-3.5" />
          <ChevronUp
            className={`w-3 h-3 transition-transform ${showTracks ? "rotate-180" : ""}`}
          />
        </button>
      </div>
    </div>
  );
};
