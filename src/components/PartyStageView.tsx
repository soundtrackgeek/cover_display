import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Disc3,
  FolderOpen,
  Heart,
  Sparkles,
  User,
} from "lucide-react";
import { bestChartBadge, coverUrl, formatRating } from "../api";
import type { AlbumSummary, PartyTransition, PlaybackState } from "../types";
import { CoverImage } from "./CoverImage";

export type StageScene = "spotlight" | "vinyl" | "mosaic";

interface PartyStageViewProps {
  scene: StageScene;
  transitionStyle: PartyTransition;
  transitionIndex: number;
  fadeMs: number;
  totalCount: number;
  selectedIndex: number;
  getAlbum: (idx: number) => { album: AlbumSummary | null; score: number };
  ensureRange: (start: number, end: number) => void;
  playback: PlaybackState;
  accentRgb: [number, number, number];
  crateSet: Set<string>;
  onToggleCrate: (albumId: string) => void;
  onFilterArtist: (artist: string) => void;
  onFindSimilar: (albumId: string) => void;
  onOpenFolder: (albumId: string) => void;
  onStepAlbum: (delta: number) => void;
}

const SCENE_ENTER_CLASSES = [
  "party-scene-enter",
  "party-scene-slide",
  "party-scene-zoom",
] as const;

interface MosaicSlot {
  offset: number;
  left: string;
  top: string;
  size: number;
  opacity: number;
  blur: number;
  drift: "a" | "b";
  delaySec: number;
}

const MOSAIC_SLOTS: MosaicSlot[] = [
  { offset: -7, left: "3%", top: "8%", size: 136, opacity: 0.34, blur: 1.5, drift: "a", delaySec: 0 },
  { offset: -6, left: "16%", top: "62%", size: 156, opacity: 0.4, blur: 1, drift: "b", delaySec: -4 },
  { offset: -5, left: "24%", top: "12%", size: 112, opacity: 0.28, blur: 2, drift: "b", delaySec: -9 },
  { offset: -4, left: "7%", top: "38%", size: 120, opacity: 0.32, blur: 1.5, drift: "a", delaySec: -6 },
  { offset: -3, left: "74%", top: "10%", size: 148, opacity: 0.38, blur: 1, drift: "a", delaySec: -2 },
  { offset: -2, left: "84%", top: "42%", size: 132, opacity: 0.34, blur: 1.5, drift: "b", delaySec: -7 },
  { offset: -1, left: "68%", top: "66%", size: 152, opacity: 0.4, blur: 1, drift: "a", delaySec: -11 },
  { offset: 1, left: "82%", top: "72%", size: 118, opacity: 0.28, blur: 2, drift: "b", delaySec: -3 },
  { offset: 2, left: "36%", top: "74%", size: 116, opacity: 0.26, blur: 2, drift: "a", delaySec: -8 },
  { offset: 3, left: "56%", top: "8%", size: 118, opacity: 0.26, blur: 2, drift: "b", delaySec: -5 },
  { offset: 4, left: "4%", top: "76%", size: 110, opacity: 0.26, blur: 2, drift: "b", delaySec: -12 },
  { offset: 5, left: "88%", top: "14%", size: 108, opacity: 0.25, blur: 2, drift: "a", delaySec: -1 },
];

interface TransitionCoverFrameProps {
  current: AlbumSummary;
  outgoing: AlbumSummary | null;
  style: PartyTransition;
  transitionKey: number;
  sizeClass: string;
  frameClass: string;
  frameStyle: React.CSSProperties;
  accentRgb: [number, number, number];
  showSpineCrease?: boolean;
}

const TransitionCoverFrame: React.FC<TransitionCoverFrameProps> = ({
  current,
  outgoing,
  style,
  transitionKey,
  sizeClass,
  frameClass,
  frameStyle,
  accentRgb,
  showSpineCrease = false,
}) => {
  const [r, g, b] = accentRgb;

  const spineOverlay = showSpineCrease ? (
    <div
      className="pointer-events-none absolute inset-y-0 left-0 w-4 z-10"
      style={{
        background:
          "linear-gradient(to right, rgba(255,255,255,0.16) 0%, rgba(0,0,0,0.22) 35%, transparent 100%)",
      }}
    />
  ) : null;

  // True 3D Two-Sided Card Flip when an outgoing album is present
  if (style === "flip" && outgoing) {
    return (
      <div className={`party-flip-perspective relative ${sizeClass}`}>
        <div
          key={`flip-${transitionKey}`}
          className="party-flip-rotor relative w-full h-full"
        >
          {/* Front face: outgoing album */}
          <div
            className={`party-flip-face absolute inset-0 overflow-hidden ${frameClass}`}
            style={frameStyle}
          >
            <CoverImage album={outgoing} size={640} eager className="w-full h-full" />
            {spineOverlay}
          </div>
          {/* Back face: incoming album */}
          <div
            className={`party-flip-face party-flip-back absolute inset-0 overflow-hidden ${frameClass}`}
            style={frameStyle}
          >
            <CoverImage album={current} size={640} eager className="w-full h-full" />
            {spineOverlay}
          </div>
        </div>
      </div>
    );
  }

  const outClass =
    style === "toss"
      ? "party-toss-out"
      : style === "wipe"
      ? "party-wipe-out"
      : "party-zoom-out";

  const inClass =
    style === "toss"
      ? "party-toss-in"
      : style === "wipe"
      ? "party-wipe-in"
      : style === "flip"
      ? "party-enter-flip"
      : "party-zoom-in";

  return (
    <div className={`relative ${sizeClass}`}>
      {/* Outgoing album layer */}
      {outgoing && (
        <div
          key={`out-${outgoing.id}-${transitionKey}`}
          className={`${outClass} pointer-events-none absolute inset-0 z-10 overflow-hidden ${frameClass}`}
          style={frameStyle}
        >
          <CoverImage album={outgoing} size={640} eager className="w-full h-full" />
          {spineOverlay}
        </div>
      )}

      {/* Incoming album layer */}
      <div
        key={`in-${current.id}-${transitionKey}`}
        className={`${inClass} relative z-20 w-full h-full overflow-hidden ${frameClass}`}
        style={frameStyle}
      >
        <CoverImage album={current} size={640} eager className="w-full h-full" />
        {spineOverlay}
      </div>

      {/* Luminous shutter light-sweep beam for Wipe transition */}
      {style === "wipe" && outgoing && (
        <div
          key={`beam-${transitionKey}`}
          className="party-shutter-beam pointer-events-none absolute inset-y-0 z-30 w-10 -skew-x-12"
          style={{
            background: `linear-gradient(90deg, transparent 0%, rgba(${r},${g},${b},0.92) 50%, transparent 100%)`,
            filter: "blur(6px)",
          }}
        />
      )}
    </div>
  );
};

export const PartyStageView: React.FC<PartyStageViewProps> = ({
  scene,
  transitionStyle,
  transitionIndex,
  fadeMs,
  totalCount,
  selectedIndex,
  getAlbum,
  ensureRange,
  playback,
  accentRgb,
  crateSet,
  onToggleCrate,
  onFilterArtist,
  onFindSimilar,
  onOpenFolder,
  onStepAlbum,
}) => {
  const { album } = getAlbum(selectedIndex);

  // Track outgoing album + color wash trigger for choreographed transitions
  const prevAlbumRef = useRef<AlbumSummary | null>(null);
  const [outgoingAlbum, setOutgoingAlbum] = useState<AlbumSummary | null>(null);
  const [washNonce, setWashNonce] = useState(0);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!album) return;
    const prev = prevAlbumRef.current;
    if (prev && prev.id !== album.id) {
      setOutgoingAlbum(prev);
      setWashNonce((n) => n + 1);
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(() => {
        setOutgoingAlbum(null);
      }, 840);
    }
    prevAlbumRef.current = album;
  }, [album]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (totalCount > 0) {
      ensureRange(selectedIndex - 16, selectedIndex + 16);
    }
  }, [selectedIndex, totalCount, ensureRange]);

  // Keyboard left/right skips albums directly in Party Stage
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onStepAlbum(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        onStepAlbum(-1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onStepAlbum]);

  const [r, g, b] = accentRgb;
  const isPlaying = playback.status === "playing";
  const level = Math.max(0, Math.min(1, playback.level * 1.65));
  const sceneEnterClass =
    SCENE_ENTER_CLASSES[transitionIndex % SCENE_ENTER_CLASSES.length];
  const washDurationMs = Math.max(600, Math.min(1800, fadeMs + 220));

  const progressPct = useMemo(() => {
    if (!playback.clipDurationSec || playback.clipDurationSec <= 0) return 0;
    const total = playback.fullTrackMode
      ? Math.max(1, playback.trackDurationSec)
      : playback.clipDurationSec;
    const elapsed = playback.fullTrackMode
      ? playback.clipStartSec + playback.clipElapsedSec
      : playback.clipElapsedSec;
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  }, [
    playback.clipDurationSec,
    playback.clipElapsedSec,
    playback.clipStartSec,
    playback.fullTrackMode,
    playback.trackDurationSec,
  ]);

  const mosaicNeighbors = useMemo(() => {
    if (scene !== "mosaic" || totalCount <= 1) return [];
    const seen = new Set<string>();
    if (album) seen.add(album.id);
    const items: { slot: MosaicSlot; item: AlbumSummary }[] = [];
    for (const slot of MOSAIC_SLOTS) {
      const idx = (selectedIndex + slot.offset + totalCount * 10) % totalCount;
      const candidate = getAlbum(idx).album;
      if (candidate && !seen.has(candidate.id)) {
        seen.add(candidate.id);
        items.push({ slot, item: candidate });
      }
    }
    return items;
  }, [scene, totalCount, selectedIndex, getAlbum, album]);

  if (!album) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3 bg-[#09090d]">
        <Disc3 className="w-10 h-10 text-amber-400 animate-spin" />
        <span className="text-xs text-zinc-400">Loading next party album…</span>
      </div>
    );
  }

  const isCrated = crateSet.has(album.id);
  const chartBadge = bestChartBadge(album);
  const ratingText = formatRating(album.rating);
  const activeTrackTitle =
    playback.albumId === album.id && playback.track
      ? playback.track.title
      : null;
  const activeTrackIsSingle =
    playback.albumId === album.id && playback.track?.isSingle;

  return (
    <div
      key={scene}
      className={`${sceneEnterClass} relative flex-1 flex flex-col items-center justify-center overflow-hidden bg-[#07080c] select-none`}
    >
      {/* Dynamic Backdrop Layer (with outgoing crossfade in Spotlight) */}
      {scene === "spotlight" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {outgoingAlbum?.hasCover && (
            <img
              key={`bg-out-${outgoingAlbum.id}`}
              src={coverUrl(outgoingAlbum.id, 640)}
              alt=""
              className="party-zoom-out absolute inset-0 w-full h-full object-cover opacity-35 blur-3xl saturate-150"
            />
          )}
          {album.hasCover && (
            <img
              key={`bg-in-${album.id}`}
              src={coverUrl(album.id, 640)}
              alt=""
              className="party-ken-burns absolute inset-0 w-full h-full object-cover opacity-35 blur-3xl saturate-150 transition-opacity duration-700"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#07080c] via-[#07080c]/55 to-[#07080c]/75" />
        </div>
      )}

      {scene === "mosaic" && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {mosaicNeighbors.map(({ slot, item }) => (
            <div
              key={`${slot.offset}-${item.id}`}
              className={
                slot.drift === "a"
                  ? "party-mosaic-drift-a absolute rounded-xl overflow-hidden shadow-2xl border border-white/10"
                  : "party-mosaic-drift-b absolute rounded-xl overflow-hidden shadow-2xl border border-white/10"
              }
              style={{
                left: slot.left,
                top: slot.top,
                width: slot.size,
                height: slot.size,
                opacity: slot.opacity,
                filter: `blur(${slot.blur}px) saturate(1.15)`,
                animationDelay: `${slot.delaySec}s`,
              }}
            >
              <CoverImage album={item} size={256} className="w-full h-full" />
            </div>
          ))}
          <div
            className="absolute inset-0 transition-all duration-700"
            style={{
              background: `radial-gradient(circle at 50% 48%, rgba(${r},${g},${b},0.16) 0%, rgba(7,8,12,0.72) 58%, rgba(7,8,12,0.94) 100%)`,
            }}
          />
        </div>
      )}

      {/* Beat-Reactive Ambient Accent Aurora (smoothly morphs palette across albums) */}
      <div
        className="pointer-events-none absolute inset-0 transition-all duration-500"
        style={{
          background: `radial-gradient(circle at ${
            scene === "vinyl" ? "44% 50%" : "50% 46%"
          }, rgba(${r},${g},${b},${0.2 + level * 0.22}) 0%, rgba(${r},${g},${b},${
            0.06 + level * 0.08
          }) 36%, transparent 72%)`,
          transform: `scale(${1 + level * 0.05})`,
        }}
      />

      {/* Audio-Synced Color Wash Pulse on Every Album Change */}
      {washNonce > 0 && (
        <div
          key={`wash-${washNonce}`}
          className="party-color-wash pointer-events-none absolute inset-0 z-[5]"
          style={
            {
              "--party-wash-ms": `${washDurationMs}ms`,
              background: `radial-gradient(circle at 50% 48%, rgba(${r},${g},${b},0.48) 0%, rgba(${r},${g},${b},0.16) 44%, transparent 76%)`,
            } as React.CSSProperties
          }
        />
      )}

      {/* Subtle Left / Right Skip Buttons */}
      {totalCount > 1 && (
        <>
          <button
            onClick={() => onStepAlbum(-1)}
            className="absolute left-5 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/40 hover:bg-black/70 border border-white/10 text-zinc-300 hover:text-white backdrop-blur-md transition-all cursor-pointer opacity-40 hover:opacity-100"
            title="Previous album (←)"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => onStepAlbum(1)}
            className="absolute right-5 top-1/2 -translate-y-1/2 z-20 p-2.5 rounded-full bg-black/40 hover:bg-black/70 border border-white/10 text-zinc-300 hover:text-white backdrop-blur-md transition-all cursor-pointer opacity-40 hover:opacity-100"
            title="Next album (→)"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* =====================================================================
          SCENE 1: CINEMA SPOTLIGHT
         ===================================================================== */}
      {scene === "spotlight" && (
        <div className="relative z-10 w-full max-w-5xl px-10 flex flex-col md:flex-row items-center justify-center gap-10 lg:gap-14">
          {/* Hero Cover Art with Energetic Outgoing + Incoming Transition */}
          <div
            className="relative shrink-0 transition-transform duration-150"
            style={{ transform: `scale(${1 + level * 0.018})` }}
          >
            <TransitionCoverFrame
              current={album}
              outgoing={outgoingAlbum}
              style={transitionStyle}
              transitionKey={transitionIndex}
              sizeClass="w-72 h-72 sm:w-80 sm:h-80 lg:w-[376px] lg:h-[376px]"
              frameClass="rounded-2xl border border-white/15"
              frameStyle={{
                boxShadow: `0 28px 80px rgba(0,0,0,0.85), 0 0 ${
                  44 + level * 52
                }px rgba(${r},${g},${b},${0.32 + level * 0.28})`,
              }}
              accentRgb={accentRgb}
            />
          </div>

          {/* Kinetic Metadata Column */}
          <div
            key={`spot-meta-${album.id}`}
            className="party-text-enter flex-1 min-w-0 max-w-lg text-center md:text-left space-y-4"
          >
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2">
              {album.year && (
                <span className="px-2.5 py-0.5 rounded-full bg-white/10 border border-white/15 text-xs font-mono text-zinc-200 tabular-nums">
                  {album.year}
                </span>
              )}
              {album.genre && (
                <span className="px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/10 text-xs text-zinc-300">
                  {album.genre}
                </span>
              )}
              {chartBadge && (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/40 text-xs font-semibold text-amber-200">
                  {chartBadge}
                </span>
              )}
              {ratingText && (
                <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-xs text-amber-300">
                  {ratingText}
                </span>
              )}
              {album.lovedTracks > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-400/30 text-xs text-rose-300">
                  <Heart className="w-3 h-3 fill-rose-400 text-rose-400" />
                  {album.lovedTracks}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-sm sm:text-base font-medium uppercase tracking-[0.18em] text-zinc-300/90 truncate">
                {album.artist}
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-[42px] font-bold tracking-tight text-white leading-[1.08] line-clamp-2">
                {album.album}
              </h1>
              {album.publisher && (
                <div className="text-xs text-zinc-400/90 truncate pt-0.5">
                  {album.publisher}
                </div>
              )}
            </div>

            {/* Active Track Bar */}
            {activeTrackTitle && (
              <div className="p-3.5 rounded-xl glass-panel space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex items-end gap-[2.5px] h-3.5 shrink-0">
                      {[0, 0.2, 0.4, 0.15].map((delay, i) => (
                        <span
                          key={i}
                          className={`w-[3px] rounded-full ${isPlaying ? "eq-bar" : ""}`}
                          style={{
                            height: isPlaying ? "100%" : "35%",
                            backgroundColor: `rgb(${r},${g},${b})`,
                            animationDelay: `${delay}s`,
                          }}
                        />
                      ))}
                    </div>
                    <span className="text-sm font-medium text-white truncate">
                      {activeTrackTitle}
                    </span>
                    {activeTrackIsSingle && (
                      <span className="shrink-0 px-1.5 py-[1px] rounded bg-fuchsia-500/25 border border-fuchsia-400/40 text-[9px] font-bold uppercase tracking-wider text-fuchsia-200">
                        Single
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono text-zinc-400 tabular-nums shrink-0">
                    {playback.trackIndex + 1}/{Math.max(1, playback.totalTracks)}
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-150"
                    style={{
                      width: `${progressPct}%`,
                      backgroundColor: `rgb(${r},${g},${b})`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Quick Interactive Actions */}
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 pt-1">
              <button
                onClick={() => onToggleCrate(album.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  isCrated
                    ? "bg-amber-400 text-zinc-950 border-amber-300"
                    : "bg-white/[0.06] hover:bg-white/[0.12] border-white/10 text-zinc-200"
                }`}
              >
                <Bookmark className={`w-3.5 h-3.5 ${isCrated ? "fill-zinc-950" : ""}`} />
                {isCrated ? "In Crate" : "Save to Crate"}
              </button>
              <button
                onClick={() => onFilterArtist(album.artist)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs text-zinc-200 transition-colors cursor-pointer"
              >
                <User className="w-3.5 h-3.5 text-zinc-400" />
                Artist
              </button>
              <button
                onClick={() => onFindSimilar(album.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs text-zinc-200 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                Similar Vibe
              </button>
              <button
                onClick={() => onOpenFolder(album.id)}
                className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                title="Open Album Folder"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SCENE 2: VINYL TURNTABLE / LP SLEEVE
         ===================================================================== */}
      {scene === "vinyl" && (
        <div className="relative z-10 w-full max-w-5xl px-8 flex flex-col items-center justify-center gap-8">
          {/* LP Jacket + Sliding Spinning Vinyl Record */}
          <div
            className="relative flex items-center justify-center"
            style={{ width: 510, height: 340 }}
          >
            {/* Spinning 12" Vinyl Disc (slides out fresh for each album) */}
            <div
              key={`vinyl-disc-${album.id}-${transitionIndex}`}
              className="party-vinyl-slide absolute right-2 top-1/2 -translate-y-1/2 w-[312px] h-[312px]"
            >
              <div
                className={`party-vinyl-spin ${
                  isPlaying ? "" : "party-vinyl-paused"
                } relative w-full h-full rounded-full flex items-center justify-center shadow-[0_24px_65px_rgba(0,0,0,0.9)]`}
                style={{
                  background: `
                    repeating-radial-gradient(
                      circle at 50% 50%,
                      #111216 0px,
                      #111216 2px,
                      #1b1d24 2.5px,
                      #111216 4px
                    )
                  `,
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              >
                {/* Specular vinyl sheen */}
                <div
                  className="pointer-events-none absolute inset-0 rounded-full"
                  style={{
                    background:
                      "conic-gradient(from 35deg, transparent 0deg, rgba(255,255,255,0.14) 28deg, transparent 58deg, transparent 180deg, rgba(255,255,255,0.11) 210deg, transparent 245deg)",
                  }}
                />
                {/* Center Record Label */}
                <div
                  className="relative w-[108px] h-[108px] rounded-full overflow-hidden border-[3px] shadow-inner flex items-center justify-center"
                  style={{ borderColor: `rgb(${r},${g},${b})` }}
                >
                  <CoverImage album={album} size={256} eager className="w-full h-full opacity-90" />
                  {/* Spindle Hole */}
                  <div className="absolute w-3.5 h-3.5 rounded-full bg-[#09090d] border border-white/25 shadow-inner" />
                </div>
              </div>
            </div>

            {/* Matte LP Jacket Sleeve with Choreographed Outgoing + Incoming Transition */}
            <div className="relative z-10 -ml-36">
              <TransitionCoverFrame
                current={album}
                outgoing={outgoingAlbum}
                style={transitionStyle}
                transitionKey={transitionIndex}
                sizeClass="w-[328px] h-[328px]"
                frameClass="rounded-xl border border-white/15"
                frameStyle={{
                  boxShadow: `16px 24px 70px rgba(0,0,0,0.9), 0 0 ${
                    36 + level * 42
                  }px rgba(${r},${g},${b},${0.28 + level * 0.22})`,
                }}
                accentRgb={accentRgb}
                showSpineCrease
              />
            </div>
          </div>

          {/* Vinyl Deck Placard */}
          <div
            key={`vinyl-meta-${album.id}`}
            className="party-text-enter text-center max-w-2xl space-y-2.5"
          >
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-400 font-medium">
              {album.artist}
              {album.year ? ` · ${album.year}` : ""}
              {album.genre ? ` · ${album.genre}` : ""}
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight truncate">
              {album.album}
            </h2>
            <div className="flex flex-wrap items-center justify-center gap-2.5 text-xs">
              {activeTrackTitle && (
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full glass-panel text-zinc-100">
                  <span
                    className={`w-2 h-2 rounded-full ${isPlaying ? "animate-pulse" : ""}`}
                    style={{ backgroundColor: `rgb(${r},${g},${b})` }}
                  />
                  <span className="max-w-xs truncate">{activeTrackTitle}</span>
                </span>
              )}
              {chartBadge && (
                <span className="px-2.5 py-1 rounded-full bg-amber-400/20 border border-amber-400/35 text-amber-200 font-semibold">
                  {chartBadge}
                </span>
              )}
              <button
                onClick={() => onToggleCrate(album.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
                  isCrated
                    ? "bg-amber-400 text-zinc-950 border-amber-300 font-semibold"
                    : "bg-white/[0.06] hover:bg-white/[0.12] border-white/10 text-zinc-300"
                }`}
              >
                <Bookmark className={`w-3 h-3 ${isCrated ? "fill-zinc-950" : ""}`} />
                {isCrated ? "Crated" : "Crate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          SCENE 3: FLOATING PARALLAX MOSAIC
         ===================================================================== */}
      {scene === "mosaic" && (
        <div className="relative z-10 w-full h-full flex flex-col items-center justify-center px-8 py-12 gap-7">
          {/* Center Pop-Forward Album with Energetic Outgoing + Incoming Transition */}
          <div
            className="relative transition-transform duration-150"
            style={{ transform: `scale(${1 + level * 0.022})` }}
          >
            <TransitionCoverFrame
              current={album}
              outgoing={outgoingAlbum}
              style={transitionStyle}
              transitionKey={transitionIndex}
              sizeClass="w-72 h-72 sm:w-80 sm:h-80 lg:w-[348px] lg:h-[348px]"
              frameClass="rounded-2xl border-2"
              frameStyle={{
                borderColor: `rgba(${r},${g},${b},0.65)`,
                boxShadow: `0 30px 90px rgba(0,0,0,0.92), 0 0 ${
                  48 + level * 60
                }px rgba(${r},${g},${b},${0.36 + level * 0.28})`,
              }}
              accentRgb={accentRgb}
            />
          </div>

          {/* Music-TV Style Lower-Third Card */}
          <div
            key={`mosaic-meta-${album.id}`}
            className="party-text-enter w-full max-w-xl rounded-2xl glass-panel px-5 py-3.5 shadow-2xl space-y-2.5"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-400 truncate">
                  {album.artist}
                  {album.year ? ` · ${album.year}` : ""}
                </div>
                <div className="text-lg sm:text-xl font-bold text-white truncate">
                  {album.album}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {chartBadge && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-400/20 border border-amber-400/35 text-[11px] font-semibold text-amber-200">
                    {chartBadge}
                  </span>
                )}
                <button
                  onClick={() => onToggleCrate(album.id)}
                  className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                    isCrated
                      ? "bg-amber-400 text-zinc-950 border-amber-300"
                      : "bg-white/[0.06] hover:bg-white/[0.12] border-white/10 text-zinc-200"
                  }`}
                  title={isCrated ? "Remove from Crate (B)" : "Save to Crate (B)"}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${isCrated ? "fill-zinc-950" : ""}`} />
                </button>
              </div>
            </div>

            {activeTrackTitle && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-300 gap-2">
                  <span className="truncate font-medium">{activeTrackTitle}</span>
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums shrink-0">
                    Track {playback.trackIndex + 1}/{Math.max(1, playback.totalTracks)}
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-150"
                    style={{
                      width: `${progressPct}%`,
                      backgroundColor: `rgb(${r},${g},${b})`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
