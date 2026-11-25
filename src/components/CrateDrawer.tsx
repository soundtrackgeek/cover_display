import React, { useEffect, useState } from "react";
import {
  Bookmark,
  Download,
  Filter,
  FolderOpen,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import type { AlbumSummary } from "../types";
import { CoverImage } from "./CoverImage";

interface CrateDrawerProps {
  open: boolean;
  onClose: () => void;
  crateAlbumIds: string[];
  activeAlbumId: string | null;
  onRemoveAlbum: (albumId: string) => void;
  onClearCrate: () => void;
  onBrowseCrate: () => void;
  onOpenFolder: (albumId: string) => void;
  onExportM3u: () => Promise<void>;
}

export const CrateDrawer: React.FC<CrateDrawerProps> = ({
  open,
  onClose,
  crateAlbumIds,
  activeAlbumId,
  onRemoveAlbum,
  onClearCrate,
  onBrowseCrate,
  onOpenFolder,
  onExportM3u,
}) => {
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    api
      .getCrateAlbums()
      .then((list) => {
        if (active) setAlbums(list);
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, [open, crateAlbumIds]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExportM3u();
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md h-full bg-[#0d0e15]/95 border-l border-white/[0.09] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-400/15 border border-amber-400/35 flex items-center justify-center">
              <Bookmark className="w-3.5 h-3.5 text-amber-300 fill-amber-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Discovery Crate</h2>
              <p className="text-[11px] text-zinc-400">
                {albums.length} {albums.length === 1 ? "album" : "albums"} saved locally
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {albums.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3 text-zinc-500">
              <Bookmark className="w-10 h-10 opacity-25" />
              <div className="text-sm font-medium text-zinc-300">
                Your Discovery Crate is empty
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed max-w-xs">
                Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-zinc-200 font-mono text-[11px]">B</kbd> or
                click the bookmark button on any cover to collect gems as you browse.
                Saved locally without modifying your library databases.
              </p>
            </div>
          ) : (
            albums.map((album) => {
              const isPlaying = activeAlbumId === album.id;
              return (
                <div
                  key={album.id}
                  onClick={() =>
                    void api.previewAlbum(album.id, {
                      startTrackIndex: 0,
                      isPinned: true,
                      sourceView: "coverflow",
                    })
                  }
                  className={`group flex items-center gap-3 p-2 rounded-xl border transition-all cursor-pointer ${
                    isPlaying
                      ? "bg-amber-400/12 border-amber-400/35"
                      : "bg-white/[0.025] border-white/[0.06] hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 ring-1 ring-white/10">
                    <CoverImage album={album} size={256} className="w-full h-full" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-white truncate">
                      {album.album}
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                      {album.artist}
                      {album.year ? ` · ${album.year}` : ""}
                    </div>
                    {album.genre && (
                      <div className="text-[10px] text-zinc-500 truncate mt-0.5">
                        {album.genre} · {album.totalTracks} tracks
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenFolder(album.id);
                      }}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                      title="Open album folder in Explorer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAlbum(album.id);
                      }}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-rose-300 hover:bg-rose-500/15 transition-colors cursor-pointer"
                      title="Remove from Crate"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        {albums.length > 0 && (
          <div className="p-4 border-t border-white/[0.08] bg-[#0a0b10]/90 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={onBrowseCrate}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-semibold text-xs transition-colors cursor-pointer"
              >
                <Filter className="w-3.5 h-3.5" />
                Browse Crate
              </button>
              <button
                onClick={() => void handleExport()}
                disabled={exporting}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 text-zinc-100 font-medium text-xs transition-colors cursor-pointer disabled:opacity-50"
                title="Export all tracks in your Crate to an .m3u8 playlist"
              >
                <Download className="w-3.5 h-3.5 text-amber-300" />
                {exporting ? "Exporting…" : "Export .m3u8"}
              </button>
            </div>
            <button
              onClick={onClearCrate}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] text-zinc-500 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Clear Crate
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
