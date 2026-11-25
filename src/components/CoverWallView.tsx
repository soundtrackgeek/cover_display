import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bookmark,
  Disc3,
  FolderOpen,
  Layers,
  Pin,
  Sparkles,
  User,
} from "lucide-react";
import { api } from "../api";
import type { AlbumSummary, AppSettings, PlaybackState } from "../types";
import { CoverImage } from "./CoverImage";

interface CoverWallViewProps {
  queryId: number;
  totalCount: number;
  getAlbum: (idx: number) => { album: AlbumSummary | null; score: number };
  ensureRange: (start: number, end: number) => void;
  settings: AppSettings;
  onUpdateTileSize: (size: number) => void;
  playback: PlaybackState;
  onFilterArtist: (artist: string) => void;
  onFindSimilar: (albumId: string) => void;
  onOpenInCoverFlow: (index: number) => void;
  crateSet: Set<string>;
  onToggleCrate: (albumId: string) => void;
  onOpenFolder: (albumId: string) => void;
}

const OVERSCAN_ROWS = 3;

export const CoverWallView: React.FC<CoverWallViewProps> = ({
  queryId,
  totalCount,
  getAlbum,
  ensureRange,
  settings,
  onUpdateTileSize,
  playback,
  onFilterArtist,
  onFindSimilar,
  onOpenInCoverFlow,
  crateSet,
  onToggleCrate,
  onOpenFolder,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1200, height: 700 });
  const [scrollTop, setScrollTop] = useState(0);
  const [hoveredAlbumId, setHoveredAlbumId] = useState<string | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  // Track viewport size cleanly with ResizeObserver
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll to top when filter changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [queryId]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
      if (leaveTimerRef.current) window.clearTimeout(leaveTimerRef.current);
    };
  }, []);

  // Esc unpins locked album
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && playback.isPinned) {
        void api.stopPlayback(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playback.isPinned]);

  const gap = settings.wallGap;
  const paddingX = 16;
  const usableWidth = Math.max(240, viewport.width - paddingX * 2);
  const cols = Math.max(2, Math.floor((usableWidth + gap) / (settings.wallTileSize + gap)));
  const tileSize = Math.floor((usableWidth - gap * (cols - 1)) / cols);
  const rowHeight = tileSize + gap;
  const totalRows = Math.ceil(totalCount / cols);
  const totalHeight = Math.max(0, totalRows * rowHeight + 24);

  const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS);
  const endRow = Math.min(
    totalRows - 1,
    Math.ceil((scrollTop + viewport.height) / rowHeight) + OVERSCAN_ROWS
  );

  // Prefetch visible + overscan album pages from Rust
  useEffect(() => {
    if (totalCount <= 0 || endRow < startRow) return;
    const firstIdx = startRow * cols;
    const lastIdx = Math.min(totalCount - 1, (endRow + 1) * cols - 1);
    ensureRange(firstIdx, lastIdx);
  }, [startRow, endRow, cols, totalCount, ensureRange]);

  const handleTileEnter = useCallback(
    (album: AlbumSummary) => {
      setHoveredAlbumId(album.id);
      if (leaveTimerRef.current) {
        window.clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }

      // If another album is pinned, don't override it on casual mouseover
      if (playback.isPinned && playback.albumId !== album.id) {
        return;
      }

      if (playback.albumId === album.id && playback.status === "playing") {
        return;
      }

      hoverTimerRef.current = window.setTimeout(() => {
        void api.previewAlbum(album.id, {
          startTrackIndex: 0,
          isPinned: false,
          sourceView: "wall",
        });
      }, settings.hoverDelayMs);
    },
    [playback.isPinned, playback.albumId, playback.status, settings.hoverDelayMs]
  );

  const handleTileLeave = useCallback(
    (albumId: string) => {
      setHoveredAlbumId((cur) => (cur === albumId ? null : cur));
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (playback.isPinned) return;

      // Brief grace period so moving cleanly between adjacent covers feels seamless
      leaveTimerRef.current = window.setTimeout(() => {
        void api.stopPlayback(true);
      }, 180);
    },
    [playback.isPinned]
  );

  const handleTileClick = useCallback(
    (album: AlbumSummary) => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      if (playback.albumId === album.id && playback.isPinned) {
        // Click again to unpin and stop
        void api.stopPlayback(false);
      } else if (playback.albumId === album.id && playback.status === "playing") {
        // Pin currently playing hovered album
        void api.setPinned(true);
      } else {
        // Start playing and pin immediately
        void api.previewAlbum(album.id, {
          startTrackIndex: 0,
          isPinned: true,
          sourceView: "wall",
        });
      }
    },
    [playback.albumId, playback.isPinned, playback.status]
  );

  const visibleRows = useMemo(() => {
    const list: number[] = [];
    for (let r = startRow; r <= endRow; r++) {
      list.push(r);
    }
    return list;
  }, [startRow, endRow]);

  if (totalCount === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3">
        <Disc3 className="w-12 h-12 opacity-30" />
        <p className="text-sm font-medium text-zinc-400">No albums match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden bg-[#08090d]">
      {/* Virtualized Endless Cover Wall */}
      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="w-full h-full overflow-y-auto overflow-x-hidden"
        style={{ paddingLeft: paddingX, paddingRight: paddingX, paddingTop: 12 }}
      >
        <div className="relative w-full" style={{ height: totalHeight }}>
          {visibleRows.map((rowIdx) => {
            const top = rowIdx * rowHeight;
            const rowStart = rowIdx * cols;
            return (
              <div
                key={rowIdx}
                className="absolute left-0 right-0 flex"
                style={{
                  top,
                  height: tileSize,
                  gap,
                }}
              >
                {Array.from({ length: cols }).map((_, colIdx) => {
                  const idx = rowStart + colIdx;
                  if (idx >= totalCount) {
                    return <div key={colIdx} style={{ width: tileSize, height: tileSize }} />;
                  }
                  const { album, score } = getAlbum(idx);
                  if (!album) {
                    return (
                      <div
                        key={idx}
                        style={{ width: tileSize, height: tileSize }}
                        className="rounded-lg bg-zinc-900/70 animate-pulse"
                      />
                    );
                  }

                  const isPlaying =
                    playback.albumId === album.id && playback.status === "playing";
                  const isPinned = playback.albumId === album.id && playback.isPinned;
                  const isHovered = hoveredAlbumId === album.id;
                  const isCrated = crateSet.has(album.id);

                  return (
                    <div
                      key={album.id}
                      onMouseEnter={() => handleTileEnter(album)}
                      onMouseLeave={() => handleTileLeave(album.id)}
                      onClick={() => handleTileClick(album)}
                      style={{ width: tileSize, height: tileSize }}
                      className={`group relative rounded-lg overflow-hidden cursor-pointer transition-all duration-200 will-change-transform ${
                        isPlaying || isPinned
                          ? "z-20 scale-[1.045] ring-2 ring-amber-400 shadow-[0_14px_38px_rgba(251,191,36,0.28)]"
                          : isHovered
                          ? "z-10 scale-[1.03] ring-1 ring-white/35 shadow-[0_12px_30px_rgba(0,0,0,0.75)]"
                          : "ring-1 ring-white/[0.06]"
                      }`}
                    >
                      <CoverImage album={album} size={256} className="w-full h-full" />

                      {/* Subtle similarity match badge */}
                      {score > 0 && (
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-sm text-[10px] font-mono text-emerald-300 border border-emerald-400/25">
                          {Math.round(score * 100)}%
                        </div>
                      )}

                      {/* Pinned / Crated indicator */}
                      {isPinned ? (
                        <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-400 text-zinc-950 text-[10px] font-semibold shadow">
                          <Pin className="w-2.5 h-2.5 fill-zinc-950" />
                          Pinned
                        </div>
                      ) : isCrated && score <= 0 ? (
                        <div className="absolute top-1.5 left-1.5 p-1 rounded-md bg-black/75 backdrop-blur-sm border border-amber-400/40 text-amber-300 shadow">
                          <Bookmark className="w-2.5 h-2.5 fill-amber-300" />
                        </div>
                      ) : null}

                      {/* Quick Action buttons on hover */}
                      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleCrate(album.id);
                          }}
                          className={`p-1.5 rounded-md backdrop-blur-md transition-colors cursor-pointer ${
                            isCrated
                              ? "bg-amber-400 text-zinc-950"
                              : "bg-black/75 hover:bg-amber-400 text-zinc-200 hover:text-zinc-950"
                          }`}
                          title={isCrated ? "Remove from Discovery Crate" : "Save to Discovery Crate"}
                        >
                          <Bookmark className={`w-3 h-3 ${isCrated ? "fill-zinc-950" : ""}`} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenFolder(album.id);
                          }}
                          className="p-1.5 rounded-md bg-black/75 hover:bg-white text-zinc-200 hover:text-zinc-950 backdrop-blur-md transition-colors cursor-pointer"
                          title="Open album folder in Explorer"
                        >
                          <FolderOpen className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onFilterArtist(album.artist);
                          }}
                          className="p-1.5 rounded-md bg-black/75 hover:bg-amber-400 text-zinc-200 hover:text-zinc-950 backdrop-blur-md transition-colors cursor-pointer"
                          title={`Artist discography: ${album.artist}`}
                        >
                          <User className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onFindSimilar(album.id);
                          }}
                          className="p-1.5 rounded-md bg-black/75 hover:bg-amber-400 text-amber-300 hover:text-zinc-950 backdrop-blur-md transition-colors cursor-pointer"
                          title="Find sonically similar albums"
                        >
                          <Sparkles className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenInCoverFlow(idx);
                          }}
                          className="p-1.5 rounded-md bg-black/75 hover:bg-white text-zinc-200 hover:text-zinc-950 backdrop-blur-md transition-colors cursor-pointer"
                          title="Inspect in Cover Flow"
                        >
                          <Layers className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Bottom Info & Live Playing Strip */}
                      <div
                        className={`absolute inset-x-0 bottom-0 p-2 pt-7 bg-gradient-to-t from-black/95 via-black/75 to-transparent transition-opacity duration-150 ${
                          isPlaying || isPinned || isHovered ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        <div className="flex items-end justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold text-white truncate leading-tight">
                              {album.album}
                            </div>
                            <div className="text-[10px] text-zinc-300/90 truncate">
                              {album.artist}
                              {album.year ? ` · ${album.year}` : ""}
                            </div>
                          </div>

                          {/* Live equalizer bars when playing */}
                          {isPlaying && (
                            <div className="shrink-0 flex items-end gap-[2px] h-4 pb-0.5">
                              {[0, 1, 2].map((b) => (
                                <span
                                  key={b}
                                  className="w-[3px] rounded-full bg-amber-400 transition-all duration-75"
                                  style={{
                                    height: `${Math.max(
                                      4,
                                      Math.min(
                                        15,
                                        4 + playback.level * (10 + ((b * 4) % 6))
                                      )
                                    )}px`,
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>

                        {isPlaying && playback.track && (
                          <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-300 truncate font-medium">
                            <span className="font-mono opacity-80 tabular-nums">
                              {playback.trackIndex + 1}/{playback.totalTracks}
                            </span>
                            <span className="truncate">{playback.track.title}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Floating Wall Density & Navigation Controls */}
      <div className="fixed right-5 bottom-[92px] z-30 flex items-center gap-2">
        {scrollTop > 400 && (
          <button
            onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            className="p-2 rounded-full glass-panel text-zinc-300 hover:text-white hover:bg-white/10 shadow-xl transition-all cursor-pointer"
            title="Scroll to top"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full glass-panel shadow-xl">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-medium">
            Size
          </span>
          <input
            type="range"
            min={104}
            max={280}
            step={8}
            value={settings.wallTileSize}
            onChange={(e) => onUpdateTileSize(Number(e.target.value))}
            className="studio-range w-24"
          />
        </div>
      </div>
    </div>
  );
};
