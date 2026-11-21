import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AlbumSummary } from "../types";

const PAGE_SIZE = 120;
const MAX_CACHED_PAGES = 28; // ~3,360 albums in JS memory at once

interface PageEntry {
  items: AlbumSummary[];
  scores: number[];
  touchedAt: number;
}

export function useAlbumWindow(
  queryId: number,
  totalCount: number,
  initialItems: AlbumSummary[],
  initialScores: number[]
) {
  const pagesRef = useRef<Map<number, PageEntry>>(new Map());
  const inflightRef = useRef<Set<number>>(new Set());
  const activeQueryRef = useRef<number>(queryId);
  const [version, setVersion] = useState(0);

  // Reset cache synchronously whenever queryId changes
  if (activeQueryRef.current !== queryId) {
    activeQueryRef.current = queryId;
    pagesRef.current = new Map();
    inflightRef.current = new Set();
    if (initialItems.length > 0) {
      pagesRef.current.set(0, {
        items: initialItems,
        scores: initialScores,
        touchedAt: Date.now(),
      });
    }
  }

  useEffect(() => {
    if (initialItems.length > 0 && !pagesRef.current.has(0)) {
      pagesRef.current.set(0, {
        items: initialItems,
        scores: initialScores,
        touchedAt: Date.now(),
      });
      setVersion((v) => v + 1);
    }
  }, [queryId, initialItems, initialScores]);

  const evictOldPages = useCallback(() => {
    const map = pagesRef.current;
    if (map.size <= MAX_CACHED_PAGES) return;
    const entries = Array.from(map.entries()).sort(
      (a, b) => a[1].touchedAt - b[1].touchedAt
    );
    const toRemove = map.size - MAX_CACHED_PAGES;
    for (let i = 0; i < toRemove; i++) {
      map.delete(entries[i][0]);
    }
  }, []);

  const ensureRange = useCallback(
    (startIndex: number, endIndex: number) => {
      if (totalCount <= 0) return;
      const clampedStart = Math.max(0, startIndex);
      const clampedEnd = Math.min(totalCount - 1, endIndex);
      if (clampedEnd < clampedStart) return;

      const firstPage = Math.floor(clampedStart / PAGE_SIZE);
      const lastPage = Math.floor(clampedEnd / PAGE_SIZE);
      const currentQid = activeQueryRef.current;

      for (let p = firstPage; p <= lastPage; p++) {
        const cached = pagesRef.current.get(p);
        if (cached) {
          cached.touchedAt = Date.now();
          continue;
        }
        if (inflightRef.current.has(p)) continue;
        inflightRef.current.add(p);

        const pageStart = p * PAGE_SIZE;
        api
          .getAlbumWindow(pageStart, PAGE_SIZE)
          .then((res) => {
            inflightRef.current.delete(p);
            if (activeQueryRef.current !== currentQid) return;
            pagesRef.current.set(p, {
              items: res.items,
              scores: res.similarityScores,
              touchedAt: Date.now(),
            });
            evictOldPages();
            setVersion((v) => v + 1);
          })
          .catch(() => {
            inflightRef.current.delete(p);
          });
      }
    },
    [totalCount, evictOldPages]
  );

  const getAlbum = useCallback(
    (index: number): { album: AlbumSummary | null; score: number } => {
      if (index < 0 || index >= totalCount) return { album: null, score: 0 };
      const pageIdx = Math.floor(index / PAGE_SIZE);
      const offset = index % PAGE_SIZE;
      const entry = pagesRef.current.get(pageIdx);
      if (!entry) return { album: null, score: 0 };
      entry.touchedAt = Date.now();
      return {
        album: entry.items[offset] ?? null,
        score: entry.scores[offset] ?? 0,
      };
    },
    // version ensures consumers re-read fresh cached pages
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totalCount, version]
  );

  return { getAlbum, ensureRange, cacheVersion: version };
}
