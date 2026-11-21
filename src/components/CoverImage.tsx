import React, { useState } from "react";
import { coverUrl } from "../api";
import type { AlbumSummary } from "../types";

interface CoverImageProps {
  album: AlbumSummary;
  size?: 256 | 640;
  className?: string;
  draggable?: boolean;
  eager?: boolean;
}

const FALLBACK_PALETTES = [
  ["#1d2438", "#3b2342", "#e8a848"],
  ["#172a2a", "#1f3a4b", "#5eead4"],
  ["#2c1b29", "#4a2232", "#f472b6"],
  ["#1e2330", "#2f3e52", "#93c5fd"],
  ["#2a2217", "#48341c", "#fbbf24"],
  ["#1c2620", "#2d4034", "#86efac"],
];

function hashIndex(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % FALLBACK_PALETTES.length;
}

export const CoverImage = React.memo(function CoverImage({
  album,
  size = 256,
  className = "",
  draggable = false,
  eager = false,
}: CoverImageProps) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!album.hasCover || failed) {
    const [c1, c2, accent] = FALLBACK_PALETTES[hashIndex(album.id)];
    return (
      <div
        className={`relative flex flex-col justify-between overflow-hidden select-none p-3 ${className}`}
        style={{
          background: `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`,
        }}
      >
        <div
          className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full opacity-20 border-2"
          style={{ borderColor: accent }}
        />
        <div className="relative z-10 text-[10px] uppercase tracking-wider font-medium opacity-70 truncate">
          {album.artist || "Unknown Artist"}
        </div>
        <div className="relative z-10">
          <div className="text-xs font-semibold leading-tight line-clamp-2 text-white/90">
            {album.album || "Untitled"}
          </div>
          {album.year && (
            <div className="text-[10px] mt-1 font-mono opacity-60">
              {album.year}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden bg-zinc-900/90 ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-br from-zinc-800/60 to-zinc-900/90 animate-pulse" />
      )}
      <img
        src={coverUrl(album.id, size)}
        alt={`${album.artist} - ${album.album}`}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={draggable}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
});
