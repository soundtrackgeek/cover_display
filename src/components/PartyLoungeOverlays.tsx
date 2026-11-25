import React, { useEffect, useMemo, useState } from "react";
import { Award, Bookmark, Disc3, Heart, SkipForward, Sparkles, Star } from "lucide-react";
import { bestChartBadge, formatRating } from "../api";
import type { AlbumSummary, PlaybackState } from "../types";
import { CoverImage } from "./CoverImage";

interface PartyLoungeOverlaysProps {
  currentAlbum: AlbumSummary | null;
  upNextAlbum: AlbumSummary | null;
  playback: PlaybackState;
  accentRgb: [number, number, number];
  isLoungeIdle: boolean;
  isCrated: boolean;
  crateBurst: { id: number; added: boolean; albumTitle: string } | null;
  onJumpUpNext: () => void;
}

export const PartyLoungeOverlays: React.FC<PartyLoungeOverlaysProps> = ({
  currentAlbum,
  upNextAlbum,
  playback,
  accentRgb,
  isLoungeIdle,
  isCrated,
  crateBurst,
  onJumpUpNext,
}) => {
  const [r, g, b] = accentRgb;
  const [showTrivia, setShowTrivia] = useState(false);

  // Show Music-TV pop-up trivia badge briefly whenever a new album lands
  useEffect(() => {
    if (!currentAlbum) {
      setShowTrivia(false);
      return;
    }
    const startTimer = window.setTimeout(() => setShowTrivia(true), 450);
    const hideTimer = window.setTimeout(() => setShowTrivia(false), 6200);
    return () => {
      window.clearTimeout(startTimer);
      window.clearTimeout(hideTimer);
    };
  }, [currentAlbum?.id]);

  // Compute remaining seconds in the current clip for the "Up Next" teaser pill
  const remainingSec = useMemo(() => {
    if (playback.status !== "playing" || playback.fullTrackMode) return 999;
    if (!playback.clipDurationSec || playback.clipDurationSec <= 0) return 999;
    return Math.max(0, playback.clipDurationSec - playback.clipElapsedSec);
  }, [
    playback.status,
    playback.fullTrackMode,
    playback.clipDurationSec,
    playback.clipElapsedSec,
  ]);

  const progressPct = useMemo(() => {
    const total = playback.fullTrackMode
      ? Math.max(1, playback.trackDurationSec)
      : Math.max(1, playback.clipDurationSec);
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

  // Build concise Music-TV trivia tags from the album's existing metadata
  const triviaItems = useMemo(() => {
    if (!currentAlbum) return [];
    const items: { icon: "chart" | "crate" | "rating" | "loved" | "label"; text: string }[] = [];
    const chart = bestChartBadge(currentAlbum);
    if (chart) items.push({ icon: "chart", text: chart });
    if (isCrated) items.push({ icon: "crate", text: "In Your Discovery Crate" });
    const rating = formatRating(currentAlbum.rating);
    if (rating) items.push({ icon: "rating", text: rating });
    if (currentAlbum.lovedTracks > 0) {
      items.push({
        icon: "loved",
        text: `${currentAlbum.lovedTracks} Loved ${
          currentAlbum.lovedTracks === 1 ? "Track" : "Tracks"
        }`,
      });
    }
    if (currentAlbum.publisher) {
      items.push({
        icon: "label",
        text: currentAlbum.year
          ? `${currentAlbum.year} · ${currentAlbum.publisher}`
          : currentAlbum.publisher,
      });
    } else if (currentAlbum.year && currentAlbum.genre) {
      items.push({
        icon: "label",
        text: `${currentAlbum.year} · ${currentAlbum.genre}`,
      });
    }
    return items.slice(0, 3);
  }, [currentAlbum, isCrated]);

  const showUpNext =
    upNextAlbum != null &&
    currentAlbum != null &&
    upNextAlbum.id !== currentAlbum.id &&
    remainingSec <= 4.5 &&
    remainingSec > 0.15;

  return (
    <>
      {/* 1. Music-TV Pop-Up Trivia Tag (top-left on album arrival) */}
      {showTrivia && triviaItems.length > 0 && currentAlbum && (
        <div
          key={`trivia-${currentAlbum.id}`}
          className="party-trivia-enter pointer-events-none fixed left-5 z-30 flex flex-col gap-1.5 transition-all duration-500"
          style={{ top: isLoungeIdle ? 22 : 124 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl glass-panel border border-white/15 shadow-2xl">
            <Sparkles
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: `rgb(${r},${g},${b})` }}
            />
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-zinc-100">
              {triviaItems.map((item, idx) => (
                <span key={idx} className="inline-flex items-center gap-1">
                  {idx > 0 && <span className="text-zinc-600 mr-1">•</span>}
                  {item.icon === "chart" && (
                    <Award className="w-3 h-3 text-amber-300 shrink-0" />
                  )}
                  {item.icon === "crate" && (
                    <Bookmark className="w-3 h-3 text-amber-300 fill-amber-300 shrink-0" />
                  )}
                  {item.icon === "rating" && (
                    <Star className="w-3 h-3 text-amber-300 fill-amber-300 shrink-0" />
                  )}
                  {item.icon === "loved" && (
                    <Heart className="w-3 h-3 text-rose-400 fill-rose-400 shrink-0" />
                  )}
                  {item.icon === "label" && (
                    <Disc3 className="w-3 h-3 text-zinc-400 shrink-0" />
                  )}
                  <span>{item.text}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 2. Minimal Lounge Corner HUD (only shown when UI chrome auto-hides on idle) */}
      {isLoungeIdle && currentAlbum && (
        <div className="party-trivia-enter pointer-events-none fixed left-5 bottom-5 z-30 flex items-center gap-3 px-3.5 py-2.5 rounded-2xl glass-panel border border-white/12 shadow-2xl max-w-md">
          <div className="w-11 h-11 rounded-lg overflow-hidden border border-white/15 shrink-0 shadow-lg">
            <CoverImage album={currentAlbum} size={256} eager className="w-full h-full" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-zinc-400 truncate">
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
                style={{ backgroundColor: `rgb(${r},${g},${b})` }}
              />
              <span className="truncate">
                {currentAlbum.artist}
                {currentAlbum.year ? ` · ${currentAlbum.year}` : ""}
              </span>
            </div>
            <div className="text-xs font-semibold text-white truncate">
              {playback.albumId === currentAlbum.id && playback.track
                ? playback.track.title
                : currentAlbum.album}
            </div>
            <div className="h-[3px] w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: `rgb(${r},${g},${b})`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 3. "Up Next" Teaser Pill (slides in ~4.5s before album advance) */}
      {showUpNext && upNextAlbum && (
        <button
          key={`upnext-${upNextAlbum.id}`}
          onClick={onJumpUpNext}
          className="party-teaser-enter fixed right-5 z-30 flex items-center gap-3 px-3.5 py-2.5 rounded-2xl glass-panel border border-white/15 hover:border-amber-400/50 shadow-2xl max-w-xs text-left transition-all cursor-pointer group"
          style={{ bottom: isLoungeIdle ? 20 : 104 }}
          title="Click to jump to this album now"
        >
          <div className="w-11 h-11 rounded-lg overflow-hidden border border-white/15 shrink-0 shadow-md">
            <CoverImage album={upNextAlbum} size={256} eager className="w-full h-full" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.15em] text-emerald-300">
              <span>Up Next</span>
              <span className="text-zinc-500">· {Math.ceil(remainingSec)}s</span>
            </div>
            <div className="text-xs font-semibold text-white truncate">
              {upNextAlbum.album}
            </div>
            <div className="text-[11px] text-zinc-400 truncate">
              {upNextAlbum.artist}
              {upNextAlbum.year ? ` (${upNextAlbum.year})` : ""}
            </div>
          </div>
          <SkipForward className="w-3.5 h-3.5 text-zinc-400 group-hover:text-white shrink-0 transition-colors" />
        </button>
      )}

      {/* 4. Celebratory Floating Crate Reaction Burst */}
      {crateBurst && (
        <div
          key={`burst-${crateBurst.id}`}
          className="party-crate-burst pointer-events-none fixed left-1/2 top-1/2 z-50 flex items-center gap-2.5 px-5 py-3 rounded-2xl glass-panel border shadow-2xl"
          style={{
            borderColor: crateBurst.added
              ? "rgba(251, 191, 36, 0.55)"
              : "rgba(255, 255, 255, 0.2)",
            boxShadow: crateBurst.added
              ? `0 20px 60px rgba(0,0,0,0.8), 0 0 42px rgba(${r},${g},${b},0.45)`
              : "0 20px 60px rgba(0,0,0,0.8)",
          }}
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center ${
              crateBurst.added
                ? "bg-amber-400 text-zinc-950"
                : "bg-white/10 text-zinc-300"
            }`}
          >
            <Bookmark
              className={`w-4 h-4 ${crateBurst.added ? "fill-zinc-950" : ""}`}
            />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white">
              {crateBurst.added ? "Saved to Discovery Crate!" : "Removed from Crate"}
            </div>
            <div className="text-[11px] text-zinc-300 truncate max-w-[240px]">
              {crateBurst.albumTitle}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
