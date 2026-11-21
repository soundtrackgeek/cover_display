import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  Heart,
  Play,
  Sparkles,
  User,
} from "lucide-react";
import { api, bestChartBadge, formatRating, formatSec } from "../api";
import type {
  AlbumSummary,
  AppSettings,
  PlaybackState,
  ScrubberMark,
  TrackInfo,
} from "../types";
import { CoverImage } from "./CoverImage";

interface CoverFlowViewProps {
  queryId: number;
  totalCount: number;
  getAlbum: (idx: number) => { album: AlbumSummary | null; score: number };
  ensureRange: (start: number, end: number) => void;
  selectedIndex: number;
  onSelectIndex: (idx: number) => void;
  settings: AppSettings;
  playback: PlaybackState;
  accentRgb: [number, number, number];
  onFilterArtist: (artist: string) => void;
  onFindSimilar: (albumId: string) => void;
}

const VISIBLE_SIDE = 8;

export const CoverFlowView: React.FC<CoverFlowViewProps> = ({
  queryId,
  totalCount,
  getAlbum,
  ensureRange,
  selectedIndex,
  onSelectIndex,
  settings,
  playback,
  accentRgb,
  onFilterArtist,
  onFindSimilar,
}) => {
  // Smooth continuous float position for silky 60fps Cover Flow physics
  const posRef = useRef<number>(selectedIndex);
  const targetRef = useRef<number | null>(null);
  const velRef = useRef<number>(0);
  const [renderPos, setRenderPos] = useState<number>(selectedIndex);

  const [scrubberMarks, setScrubberMarks] = useState<ScrubberMark[]>([]);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubHoverPct, setScrubHoverPct] = useState<number | null>(null);
  const [centerTracks, setCenterTracks] = useState<TrackInfo[]>([]);
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startPos: number } | null>(
    null
  );

  // Sync external selectedIndex jumps (e.g. jump from Cover Wall or filter reset)
  useEffect(() => {
    const clamped = Math.max(0, Math.min(Math.max(0, totalCount - 1), selectedIndex));
    if (Math.abs(posRef.current - clamped) > 0.6) {
      if (Math.abs(posRef.current - clamped) > 40) {
        posRef.current = clamped;
        velRef.current = 0;
        targetRef.current = null;
        setRenderPos(clamped);
      } else {
        targetRef.current = clamped;
      }
    }
  }, [selectedIndex, totalCount]);

  // Reset physics on query change
  useEffect(() => {
    const clamped = Math.max(0, Math.min(Math.max(0, totalCount - 1), selectedIndex));
    posRef.current = clamped;
    velRef.current = 0;
    targetRef.current = null;
    setRenderPos(clamped);
  }, [queryId, totalCount]);

  // Fetch lightweight scrubber index marks for instant ultra-fast navigation across 74k albums
  useEffect(() => {
    if (totalCount === 0) {
      setScrubberMarks([]);
      return;
    }
    let active = true;
    api.getScrubberMarks(Math.min(180, totalCount)).then((marks) => {
      if (active) setScrubberMarks(marks);
    });
    return () => {
      active = false;
    };
  }, [queryId, totalCount]);

  // Ensure albums around current position are always prefetched
  const centerIdx = useMemo(
    () => Math.max(0, Math.min(Math.max(0, totalCount - 1), Math.round(renderPos))),
    [renderPos, totalCount]
  );

  useEffect(() => {
    if (totalCount > 0) {
      ensureRange(centerIdx - 24, centerIdx + 24);
    }
  }, [centerIdx, totalCount, ensureRange]);

  // Main 60fps physics & momentum animation loop
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      const maxIdx = Math.max(0, totalCount - 1);
      let pos = posRef.current;
      let vel = velRef.current;
      const target = targetRef.current;
      let moved = false;

      if (target !== null) {
        const diff = target - pos;
        if (Math.abs(diff) < 0.004) {
          pos = target;
          targetRef.current = null;
          vel = 0;
          moved = true;
        } else {
          // Smooth exponential glide
          pos += diff * Math.min(1, dt * 13);
          moved = true;
        }
      } else if (Math.abs(vel) > 0.01) {
        pos += vel * dt;
        // Exponential friction tuned for fast flicks + crisp landing
        vel *= Math.pow(0.035, dt);
        if (pos < 0) {
          pos = 0;
          vel = 0;
        } else if (pos > maxIdx) {
          pos = maxIdx;
          vel = 0;
        }
        if (Math.abs(vel) < 0.55) {
          targetRef.current = Math.round(pos);
          vel = 0;
        }
        moved = true;
      } else {
        const snapped = Math.round(pos);
        if (Math.abs(pos - snapped) > 0.003) {
          pos += (snapped - pos) * Math.min(1, dt * 15);
          moved = true;
        }
      }

      if (moved) {
        posRef.current = pos;
        velRef.current = vel;
        setRenderPos(pos);
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [totalCount]);

  // Report settled integer selection up to parent
  useEffect(() => {
    if (totalCount === 0) return;
    if (centerIdx !== selectedIndex) {
      onSelectIndex(centerIdx);
    }
  }, [centerIdx, totalCount, selectedIndex, onSelectIndex]);

  const { album: centeredAlbum, score: centeredScore } = getAlbum(centerIdx);

  const displayTracks = useMemo(() => {
    if (!settings.singlesFirst) return centerTracks;
    const rank = (t: TrackInfo) => {
      if (!t.isSingle) return 3;
      if (t.singleConfidence === "confirmed") return 0;
      if (t.singleConfidence === "chart") return 1;
      return 2;
    };
    return [...centerTracks].sort((a, b) => rank(a) - rank(b));
  }, [centerTracks, settings.singlesFirst]);

  // Fetch tracklist & trigger debounced auto-preview when settled on a cover!
  useEffect(() => {
    if (!centeredAlbum) {
      setCenterTracks([]);
      return;
    }

    let cancelled = false;
    const albumId = centeredAlbum.id;

    // Fetch tracklist for the spotlight strip quickly
    const trackTimer = window.setTimeout(() => {
      api
        .fetchAlbumTracks(albumId)
        .then((tracks) => {
          if (!cancelled) setCenterTracks(tracks);
        })
        .catch(() => {});
    }, 90);

    // Debounced auto-preview so zooming past 500 covers never stutters audio
    const playTimer = window.setTimeout(() => {
      if (cancelled || !settings.autoPlayOnSelect) return;
      if (playback.albumId === albumId && playback.status === "playing") return;
      void api.previewAlbum(albumId, {
        startTrackIndex: 0,
        isPinned: false,
        sourceView: "coverflow",
      });
    }, settings.coverFlowDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(trackTimer);
      window.clearTimeout(playTimer);
    };
    // Intentionally trigger when centered album ID or delay changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centeredAlbum?.id, settings.autoPlayOnSelect, settings.coverFlowDelayMs]);

  const jumpTo = useCallback(
    (idx: number, instant = false) => {
      const clamped = Math.max(0, Math.min(Math.max(0, totalCount - 1), idx));
      velRef.current = 0;
      if (instant || Math.abs(posRef.current - clamped) > 35) {
        posRef.current = clamped;
        targetRef.current = null;
        setRenderPos(clamped);
      } else {
        targetRef.current = clamped;
      }
    },
    [totalCount]
  );

  // Mouse wheel fast momentum scrolling (supports both vertical and horizontal wheel)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (totalCount <= 1) return;
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(raw) < 1) return;
      targetRef.current = null;
      // Non-linear turbo boost: gentle ticks step 1-by-1, rapid spins fly through thousands!
      const sign = Math.sign(raw);
      const mag = Math.abs(raw);
      if (mag < 65 && Math.abs(velRef.current) < 4) {
        // Precise single-step feel on discrete mouse wheel notch
        const next = Math.round(posRef.current) + sign;
        jumpTo(next);
      } else {
        const boost = Math.pow(mag / 38, 1.38) * 6.5;
        velRef.current = Math.max(-220, Math.min(220, velRef.current + sign * boost));
      }
    },
    [totalCount, jumpTo]
  );

  // Keyboard navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (totalCount === 0) return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        jumpTo(Math.round(posRef.current) + (e.shiftKey ? 10 : 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        jumpTo(Math.round(posRef.current) - (e.shiftKey ? 10 : 1));
      } else if (e.key === "PageDown") {
        e.preventDefault();
        jumpTo(Math.round(posRef.current) + 50);
      } else if (e.key === "PageUp") {
        e.preventDefault();
        jumpTo(Math.round(posRef.current) - 50);
      } else if (e.key === "Home") {
        e.preventDefault();
        jumpTo(0, true);
      } else if (e.key === "End") {
        e.preventDefault();
        jumpTo(totalCount - 1, true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [totalCount, jumpTo]);

  // Scrubbing rail logic
  const scrubFromClientX = useCallback(
    (clientX: number) => {
      if (!railRef.current || totalCount <= 1) return;
      const rect = railRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const idx = Math.round(pct * (totalCount - 1));
      setScrubHoverPct(pct);
      jumpTo(idx, true);
    },
    [totalCount, jumpTo]
  );

  useEffect(() => {
    if (!isScrubbing) return;
    const onMove = (e: MouseEvent) => scrubFromClientX(e.clientX);
    const onUp = () => {
      setIsScrubbing(false);
      setScrubHoverPct(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isScrubbing, scrubFromClientX]);

  const scrubTooltipMark = useMemo(() => {
    if (scrubHoverPct == null || scrubberMarks.length === 0) return null;
    const idx = Math.round(scrubHoverPct * (scrubberMarks.length - 1));
    return scrubberMarks[Math.max(0, Math.min(scrubberMarks.length - 1, idx))];
  }, [scrubHoverPct, scrubberMarks]);

  const visibleIndices = useMemo(() => {
    if (totalCount === 0) return [];
    const base = Math.round(renderPos);
    const arr: number[] = [];
    for (let d = -VISIBLE_SIDE; d <= VISIBLE_SIDE; d++) {
      const idx = base + d;
      if (idx >= 0 && idx < totalCount) arr.push(idx);
    }
    return arr;
  }, [renderPos, totalCount]);

  if (totalCount === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
        <Disc3 className="w-12 h-12 opacity-30" />
        <p className="text-sm font-medium text-zinc-400">No albums match the current filters.</p>
      </div>
    );
  }

  const [ar, ag, ab] = accentRgb;
  const scrubPct = totalCount > 1 ? (centerIdx / (totalCount - 1)) * 100 : 0;
  const isCenteredPlaying =
    centeredAlbum != null &&
    playback.albumId === centeredAlbum.id &&
    playback.status === "playing";

  const chartBadge = centeredAlbum ? bestChartBadge(centeredAlbum) : null;
  const ratingBadge = centeredAlbum ? formatRating(centeredAlbum.rating) : null;

  return (
    <div
      className="relative flex-1 flex flex-col justify-between overflow-hidden select-none"
      onWheel={handleWheel}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button, [data-rail]")) return;
        dragRef.current = { active: true, startX: e.clientX, startPos: posRef.current };
      }}
      onMouseMove={(e) => {
        if (!dragRef.current?.active) return;
        const dx = e.clientX - dragRef.current.startX;
        if (Math.abs(dx) > 4) {
          targetRef.current = null;
          velRef.current = 0;
          const nextPos = Math.max(
            0,
            Math.min(totalCount - 1, dragRef.current.startPos - dx / 135)
          );
          posRef.current = nextPos;
          setRenderPos(nextPos);
        }
      }}
      onMouseUp={() => {
        if (dragRef.current?.active) {
          dragRef.current = null;
          targetRef.current = Math.round(posRef.current);
        }
      }}
      onMouseLeave={() => {
        if (dragRef.current?.active) {
          dragRef.current = null;
          targetRef.current = Math.round(posRef.current);
        }
      }}
    >
      {/* Adaptive ambient studio lighting */}
      <div
        className="pointer-events-none absolute inset-0 transition-all duration-700"
        style={{
          background: `radial-gradient(ellipse 68% 58% at 50% 38%, rgba(${ar}, ${ag}, ${ab}, 0.24) 0%, rgba(${ar}, ${ag}, ${ab}, 0.06) 44%, rgba(9, 9, 13, 0) 76%)`,
        }}
      />

      {/* Horizon studio floor sheen */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[44%]"
        style={{
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0.025) 0%, rgba(9,9,13,0.92) 38%, #09090d 100%)",
        }}
      />

      {/* 3D Cover Flow Carousel Stage */}
      <div className="relative flex-1 flex items-center justify-center min-h-[300px]">
        {/* Subtle left/right step buttons */}
        <button
          onClick={() => jumpTo(centerIdx - 1)}
          disabled={centerIdx <= 0}
          className="absolute left-5 z-30 p-2.5 rounded-full glass-panel text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all cursor-pointer"
          title="Previous album (←)"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        <button
          onClick={() => jumpTo(centerIdx + 1)}
          disabled={centerIdx >= totalCount - 1}
          className="absolute right-5 z-30 p-2.5 rounded-full glass-panel text-zinc-300 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all cursor-pointer"
          title="Next album (→)"
        >
          <ChevronRight className="w-5 h-5" />
        </button>

        <div
          className="relative w-full h-full flex items-center justify-center"
          style={{
            perspective: "1450px",
            transformStyle: "preserve-3d",
          }}
        >
          {visibleIndices.map((idx) => {
            const { album } = getAlbum(idx);
            if (!album) return null;
            const offset = idx - renderPos;
            const abs = Math.abs(offset);
            const sign = Math.sign(offset);

            // Classic iTunes Cover Flow geometry: spacious center gap + tight fanned side stack
            const x =
              abs < 1
                ? offset * 240
                : sign * (240 + (abs - 1) * 92);
            const z = abs < 1 ? (1 - abs) * 120 - 60 : -110 - Math.min(abs, 6) * 26;
            const rotateY = abs < 0.08 ? 0 : -sign * Math.min(62, 42 + abs * 14);
            const scale = abs < 1 ? 1.06 - abs * 0.16 : Math.max(0.72, 0.88 - abs * 0.03);
            const opacity = Math.max(0, 1 - Math.max(0, abs - 4.8) * 0.32);
            const zIndex = 100 - Math.round(abs * 10);
            const isCenter = abs < 0.35;

            return (
              <div
                key={album.id}
                onClick={() => {
                  if (isCenter) {
                    if (isCenteredPlaying) {
                      void api.togglePause();
                    } else {
                      void api.previewAlbum(album.id, {
                        startTrackIndex: 0,
                        isPinned: false,
                        sourceView: "coverflow",
                      });
                    }
                  } else {
                    jumpTo(idx);
                  }
                }}
                style={{
                  position: "absolute",
                  width: "272px",
                  height: "272px",
                  transform: `translate3d(${x}px, -24px, ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
                  opacity,
                  zIndex,
                  willChange: "transform, opacity",
                }}
                className="cursor-pointer group"
              >
                {/* Main Album Cover */}
                <div
                  className={`relative w-full h-full rounded-xl overflow-hidden transition-shadow duration-300 ${
                    isCenter
                      ? "ring-1 ring-white/25 shadow-[0_28px_70px_rgba(0,0,0,0.85)]"
                      : "ring-1 ring-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.7)] brightness-[0.72] group-hover:brightness-95"
                  }`}
                >
                  <CoverImage album={album} size={isCenter ? 640 : 256} className="w-full h-full" eager={abs < 3} />

                  {/* Glossy specular top highlight */}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.12] via-transparent to-black/30" />

                  {/* Live playing badge on centered cover */}
                  {isCenter && isCenteredPlaying && (
                    <div className="absolute bottom-3 right-3 flex items-end gap-[3px] px-2.5 py-1.5 rounded-full bg-black/65 backdrop-blur-md border border-white/15">
                      {[0, 1, 2, 3].map((b) => (
                        <span
                          key={b}
                          className="w-[3px] rounded-full bg-amber-400 transition-all duration-75"
                          style={{
                            height: `${Math.max(
                              5,
                              Math.min(
                                16,
                                5 + playback.level * (11 + ((b * 5) % 7))
                              )
                            )}px`,
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {/* Click-to-play hover icon when paused/idle */}
                  {isCenter && !isCenteredPlaying && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/25">
                      <div className="w-14 h-14 rounded-full bg-black/70 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-xl">
                        <Play className="w-6 h-6 ml-0.5 fill-white" />
                      </div>
                    </div>
                  )}
                </div>

                {/* Mirror Reflection on Obsidian Floor */}
                {abs < 5.5 && (
                  <div className="cover-reflection mt-2.5 w-full h-[110px] rounded-xl overflow-hidden opacity-60">
                    <CoverImage album={album} size={256} className="w-full h-[272px]" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Centered Album Spotlight + Interactive Track Strip + Turbo Scrub Rail */}
      <div className="relative z-20 px-8 pb-4 pt-1 flex flex-col items-center gap-3">
        {centeredAlbum && (
          <div className="w-full max-w-3xl flex flex-col items-center text-center gap-1.5">
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold tracking-tight text-white truncate max-w-[540px]">
                {centeredAlbum.album}
              </h2>
              {centeredAlbum.year && (
                <span className="px-2 py-0.5 rounded-md bg-white/[0.08] text-xs font-mono text-zinc-300 tabular-nums">
                  {centeredAlbum.year}
                </span>
              )}
            </div>

            <div className="flex items-center justify-center gap-2.5 flex-wrap text-xs">
              <button
                onClick={() => onFilterArtist(centeredAlbum.artist)}
                className="flex items-center gap-1 text-sm font-medium text-amber-300 hover:text-amber-200 transition-colors cursor-pointer"
                title="Show full artist discography"
              >
                <User className="w-3.5 h-3.5 opacity-80" />
                {centeredAlbum.artist}
              </button>

              {centeredAlbum.genre && (
                <span className="px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-zinc-300">
                  {centeredAlbum.genre}
                </span>
              )}

              {chartBadge && (
                <span className="px-2 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/30 text-sky-200 font-mono text-[11px]">
                  {chartBadge}
                </span>
              )}

              {ratingBadge && (
                <span className="px-2 py-0.5 rounded-full bg-amber-400/15 border border-amber-400/30 text-amber-200 font-mono text-[11px]">
                  {ratingBadge}
                </span>
              )}

              {centeredAlbum.lovedTracks > 0 && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-400/30 text-rose-200 text-[11px]">
                  <Heart className="w-2.5 h-2.5 fill-rose-400 text-rose-400" />
                  {centeredAlbum.lovedTracks}
                </span>
              )}

              {centeredScore > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-200 font-mono text-[11px]">
                  {Math.round(centeredScore * 100)}% match
                </span>
              )}

              <button
                onClick={() => onFindSimilar(centeredAlbum.id)}
                className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/[0.06] hover:bg-amber-400/20 border border-white/10 hover:border-amber-400/40 text-zinc-200 hover:text-amber-100 transition-colors cursor-pointer"
                title="Find sonically similar albums using BLISS sonic analysis"
              >
                <Sparkles className="w-3 h-3 text-amber-300" />
                Similar Vibe
              </button>
            </div>

            {/* Compact interactive album tracklist strip */}
            {displayTracks.length > 0 && (
              <div className="w-full max-w-2xl mt-1 flex items-center gap-1.5 overflow-x-auto py-1 px-1">
                {displayTracks.map((tr, i) => {
                  const isActive =
                    playback.albumId === centeredAlbum.id &&
                    playback.track?.id === tr.id;
                  const singleTooltip = tr.isSingle
                    ? tr.singleConfidence === "chart"
                      ? "Chart Single"
                      : `MusicBrainz Single${tr.singleYear ? ` (${tr.singleYear})` : ""}`
                    : undefined;
                  return (
                    <button
                      key={tr.id}
                      title={singleTooltip}
                      onClick={() => {
                        if (playback.albumId === centeredAlbum.id) {
                          const idxInPlayback = playback.tracks.findIndex(
                            (p) => p.id === tr.id
                          );
                          if (idxInPlayback >= 0) {
                            void api.previewTrackAt(idxInPlayback);
                            return;
                          }
                        }
                        void api.previewAlbum(centeredAlbum.id, {
                          startTrackId: tr.id,
                          isPinned: false,
                          sourceView: "coverflow",
                        });
                      }}
                      className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] border transition-all cursor-pointer ${
                        isActive
                          ? "bg-amber-400/20 border-amber-400/50 text-amber-100 font-medium shadow-sm"
                          : tr.isSingle
                          ? "bg-fuchsia-500/[0.09] border-fuchsia-400/25 text-zinc-200 hover:bg-fuchsia-500/20"
                          : "bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.08]"
                      }`}
                    >
                      <span className="font-mono text-[10px] opacity-60 tabular-nums">
                        {String(tr.trackNumber || i + 1).padStart(2, "0")}
                      </span>
                      {tr.isSingle && (
                        <span className="px-1 py-[1px] rounded bg-fuchsia-400/20 text-fuchsia-200 text-[9px] font-semibold uppercase tracking-wider">
                          Single
                        </span>
                      )}
                      <span className="max-w-[140px] truncate">{tr.title}</span>
                      <span className="font-mono text-[10px] opacity-50 tabular-nums">
                        {formatSec(tr.timeSeconds)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Ultra-Fast Scrubbing Rail across entire filtered library */}
        <div className="w-full max-w-3xl flex items-center gap-3" data-rail>
          <span className="text-[11px] font-mono text-zinc-500 tabular-nums min-w-[78px] text-right">
            {(centerIdx + 1).toLocaleString()} / {totalCount.toLocaleString()}
          </span>

          <div
            ref={railRef}
            onMouseDown={(e) => {
              setIsScrubbing(true);
              scrubFromClientX(e.clientX);
            }}
            onMouseMove={(e) => {
              if (!railRef.current || totalCount <= 1) return;
              const rect = railRef.current.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setScrubHoverPct(pct);
            }}
            onMouseLeave={() => {
              if (!isScrubbing) setScrubHoverPct(null);
            }}
            className="relative flex-1 h-7 flex items-center cursor-ew-resize group"
          >
            {/* Floating Scrub HUD Tooltip */}
            {scrubTooltipMark && scrubHoverPct != null && (
              <div
                className="pointer-events-none absolute -top-11 -translate-x-1/2 px-3 py-1 rounded-lg glass-panel shadow-xl whitespace-nowrap z-40"
                style={{ left: `${Math.max(8, Math.min(92, scrubHoverPct * 100))}%` }}
              >
                <div className="text-[11px] font-semibold text-white truncate max-w-[220px]">
                  {scrubTooltipMark.label}
                </div>
                <div className="text-[10px] text-zinc-400 truncate max-w-[220px]">
                  {scrubTooltipMark.sublabel}
                  {scrubTooltipMark.year ? ` (${scrubTooltipMark.year})` : ""}
                </div>
              </div>
            )}

            {/* Track background */}
            <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500/80 to-amber-300"
                style={{ width: `${scrubPct}%` }}
              />
            </div>

            {/* Scrubber thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_12px_rgba(251,191,36,0.75)] ring-2 ring-amber-400/70 transition-transform group-hover:scale-125"
              style={{ left: `${scrubPct}%` }}
            />
          </div>

          <span className="text-[10px] text-zinc-500 min-w-[78px] hidden sm:inline">
            Scroll / Drag
          </span>
        </div>
      </div>
    </div>
  );
};
