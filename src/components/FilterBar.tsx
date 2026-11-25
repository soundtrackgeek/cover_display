import React, { useEffect, useRef, useState } from "react";
import {
  Award,
  Bookmark,
  BookmarkPlus,
  Calendar,
  ChevronDown,
  Disc3,
  Heart,
  RotateCcw,
  Shuffle,
  Sparkles,
  Tag,
  User,
  X,
} from "lucide-react";
import { api } from "../api";
import type {
  AlbumFilter,
  AlbumSummary,
  ArtistSuggestion,
  GenreFacet,
  SavedFilterPreset,
} from "../types";
import { DEFAULT_FILTER } from "../types";

interface FilterBarProps {
  filter: AlbumFilter;
  onChange: (next: AlbumFilter) => void;
  genres: GenreFacet[];
  savedPresets: SavedFilterPreset[];
  onSavePreset: (name: string) => void;
  onDeletePreset: (id: string) => void;
  similarSource: AlbumSummary | null;
  loadingSimilar: boolean;
  crateCount: number;
}

const DECADES = [
  { label: "50s", min: 1950, max: 1959 },
  { label: "60s", min: 1960, max: 1969 },
  { label: "70s", min: 1970, max: 1979 },
  { label: "80s", min: 1980, max: 1989 },
  { label: "90s", min: 1990, max: 1999 },
  { label: "00s", min: 2000, max: 2009 },
  { label: "10s", min: 2010, max: 2019 },
  { label: "20s", min: 2020, max: 2029 },
];

const STARTER_CHIPS: { label: string; patch: Partial<AlbumFilter> }[] = [
  {
    label: "80s Synthpop",
    patch: {
      genres: ["Synthpop"],
      yearMin: 1980,
      yearMax: 1989,
      sortBy: "year_asc",
    },
  },
  {
    label: "70s Metal & Hard Rock",
    patch: {
      genres: ["Hard Rock", "Heavy Metal"],
      yearMin: 1970,
      yearMax: 1979,
      sortBy: "year_asc",
    },
  },
  {
    label: "Synthwave",
    patch: { genres: ["Synthwave"], sortBy: "year_desc" },
  },
  {
    label: "Charted Hits",
    patch: { chart: "any", sortBy: "chart_rank" },
  },
  {
    label: "Top Rated",
    patch: { minRating: 80, sortBy: "rating_desc" },
  },
  {
    label: "Loved",
    patch: { lovedOnly: true, sortBy: "rating_desc" },
  },
  {
    label: "Soundtracks",
    patch: { genres: ["Soundtrack", "TV", "Video Game"], sortBy: "year_desc" },
  },
];

const SORT_OPTIONS = [
  { value: "artist_asc", label: "Artist A–Z" },
  { value: "artist_desc", label: "Artist Z–A" },
  { value: "album_asc", label: "Album A–Z" },
  { value: "year_asc", label: "Year Oldest" },
  { value: "year_desc", label: "Year Newest" },
  { value: "rating_desc", label: "Highest Rated" },
  { value: "chart_rank", label: "Chart Peak" },
  { value: "tracks_desc", label: "Most Tracks" },
  { value: "random", label: "Random Shuffle" },
];

type OpenPopover = "genre" | "year" | "artist" | "quality" | "save" | null;

export const FilterBar: React.FC<FilterBarProps> = ({
  filter,
  onChange,
  genres,
  savedPresets,
  onSavePreset,
  onDeletePreset,
  similarSource,
  loadingSimilar,
  crateCount,
}) => {
  const [openMenu, setOpenMenu] = useState<OpenPopover>(null);
  const [genreSearch, setGenreSearch] = useState("");
  const [artistQuery, setArtistQuery] = useState("");
  const [artistSuggestions, setArtistSuggestions] = useState<ArtistSuggestion[]>([]);
  const [presetName, setPresetName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (openMenu !== "artist") return;
    let active = true;
    api.suggestArtists(artistQuery, 24).then((res) => {
      if (active) setArtistSuggestions(res);
    });
    return () => {
      active = false;
    };
  }, [openMenu, artistQuery]);

  const hasActiveFilters =
    filter.search.trim() !== "" ||
    filter.genres.length > 0 ||
    !!filter.artist ||
    filter.yearMin != null ||
    filter.yearMax != null ||
    !!filter.chart ||
    filter.minRating != null ||
    filter.lovedOnly ||
    filter.hasCoverOnly ||
    filter.crateOnly ||
    !!filter.similarToAlbumId;

  const filteredGenres = genreSearch.trim()
    ? genres.filter((g) =>
        g.name.toLowerCase().includes(genreSearch.trim().toLowerCase())
      )
    : genres.slice(0, 80);

  const toggleGenre = (name: string) => {
    const exists = filter.genres.includes(name);
    const next = exists
      ? filter.genres.filter((g) => g !== name)
      : [...filter.genres, name];
    onChange({ ...filter, genres: next, similarToAlbumId: null });
  };

  const applyStarter = (patch: Partial<AlbumFilter>) => {
    onChange({
      ...DEFAULT_FILTER,
      ...patch,
    });
    setOpenMenu(null);
  };

  const yearLabel =
    filter.yearMin != null || filter.yearMax != null
      ? `${filter.yearMin ?? "…"}–${filter.yearMax ?? "…"}`
      : "Year / Decade";

  const qualityCount =
    (filter.chart ? 1 : 0) +
    (filter.minRating != null ? 1 : 0) +
    (filter.lovedOnly ? 1 : 0) +
    (filter.hasCoverOnly ? 1 : 0);

  return (
    <div
      ref={containerRef}
      className="relative z-30 flex flex-col gap-2 px-5 py-2.5 border-b border-white/[0.06] bg-[#0c0d13]/85 backdrop-blur-xl"
    >
      {/* Primary faceted controls row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Similar Vibe Active Banner */}
        {(similarSource || loadingSimilar) && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/15 border border-amber-400/40 text-amber-200 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-amber-300 animate-pulse" />
            {loadingSimilar ? (
              <span>Computing Sonic Vibe matches…</span>
            ) : (
              <span className="max-w-[260px] truncate">
                Similar to{" "}
                <strong className="text-amber-100">
                  {similarSource?.artist} — {similarSource?.album}
                </strong>
              </span>
            )}
            <button
              onClick={() => onChange({ ...filter, similarToAlbumId: null })}
              className="hover:text-white transition-colors ml-0.5 cursor-pointer"
              title="Exit Similar Vibe"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Genre Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === "genre" ? null : "genre")}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
              filter.genres.length > 0
                ? "bg-amber-400/15 border-amber-400/35 text-amber-100"
                : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08]"
            }`}
          >
            <Tag className="w-3.5 h-3.5 opacity-80" />
            <span>
              {filter.genres.length === 0
                ? "Genre"
                : filter.genres.length === 1
                ? filter.genres[0]
                : `${filter.genres.length} Genres`}
            </span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {openMenu === "genre" && (
            <div className="absolute left-0 mt-2 w-72 rounded-xl glass-panel shadow-2xl p-2.5 z-50">
              <input
                type="text"
                autoFocus
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
                placeholder="Filter 675 genres…"
                className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400/50 mb-2"
              />
              {filter.genres.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2 pb-2 border-b border-white/[0.06]">
                  {filter.genres.map((g) => (
                    <button
                      key={g}
                      onClick={() => toggleGenre(g)}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-200 text-[11px] hover:bg-amber-400/30 cursor-pointer"
                    >
                      {g}
                      <X className="w-2.5 h-2.5" />
                    </button>
                  ))}
                </div>
              )}
              <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
                {filteredGenres.map((g) => {
                  const selected = filter.genres.includes(g.name);
                  return (
                    <button
                      key={g.name}
                      onClick={() => toggleGenre(g.name)}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer ${
                        selected
                          ? "bg-amber-400/20 text-amber-100 font-medium"
                          : "text-zinc-300 hover:bg-white/[0.06]"
                      }`}
                    >
                      <span className="truncate">{g.name}</span>
                      <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                        {g.count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Year / Decade Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === "year" ? null : "year")}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
              filter.yearMin != null || filter.yearMax != null
                ? "bg-amber-400/15 border-amber-400/35 text-amber-100"
                : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08]"
            }`}
          >
            <Calendar className="w-3.5 h-3.5 opacity-80" />
            <span className="tabular-nums">{yearLabel}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {openMenu === "year" && (
            <div className="absolute left-0 mt-2 w-72 rounded-xl glass-panel shadow-2xl p-3 z-50 space-y-3">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                Quick Decades
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {DECADES.map((d) => {
                  const active = filter.yearMin === d.min && filter.yearMax === d.max;
                  return (
                    <button
                      key={d.label}
                      onClick={() =>
                        onChange({
                          ...filter,
                          yearMin: active ? null : d.min,
                          yearMax: active ? null : d.max,
                        })
                      }
                      className={`py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        active
                          ? "bg-amber-400/20 border-amber-400/45 text-amber-100"
                          : "bg-white/[0.04] border-white/[0.06] text-zinc-300 hover:bg-white/[0.09]"
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/[0.06]">
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">From Year</label>
                  <input
                    type="number"
                    placeholder="e.g. 1980"
                    value={filter.yearMin ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...filter,
                        yearMin: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="w-full px-2 py-1 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-white tabular-nums focus:outline-none focus:border-amber-400/50"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">To Year</label>
                  <input
                    type="number"
                    placeholder="e.g. 1989"
                    value={filter.yearMax ?? ""}
                    onChange={(e) =>
                      onChange({
                        ...filter,
                        yearMax: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="w-full px-2 py-1 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-white tabular-nums focus:outline-none focus:border-amber-400/50"
                  />
                </div>
              </div>
              {(filter.yearMin != null || filter.yearMax != null) && (
                <button
                  onClick={() => onChange({ ...filter, yearMin: null, yearMax: null })}
                  className="w-full py-1 rounded-lg text-[11px] text-zinc-400 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] cursor-pointer"
                >
                  Clear Year Range
                </button>
              )}
            </div>
          )}
        </div>

        {/* Artist Discography Dropdown */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === "artist" ? null : "artist")}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
              filter.artist
                ? "bg-amber-400/15 border-amber-400/35 text-amber-100"
                : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08]"
            }`}
          >
            <User className="w-3.5 h-3.5 opacity-80" />
            <span className="max-w-[140px] truncate">{filter.artist ?? "Artist"}</span>
            {filter.artist ? (
              <X
                className="w-3 h-3 hover:text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ ...filter, artist: null });
                }}
              />
            ) : (
              <ChevronDown className="w-3 h-3 opacity-60" />
            )}
          </button>

          {openMenu === "artist" && (
            <div className="absolute left-0 mt-2 w-72 rounded-xl glass-panel shadow-2xl p-2.5 z-50">
              <input
                type="text"
                autoFocus
                value={artistQuery}
                onChange={(e) => setArtistQuery(e.target.value)}
                placeholder="Search artist (e.g. Black Sabbath)…"
                className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400/50 mb-2"
              />
              <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
                {artistSuggestions.map((a) => (
                  <button
                    key={a.name}
                    onClick={() => {
                      onChange({
                        ...filter,
                        artist: a.name,
                        sortBy: "year_asc",
                        similarToAlbumId: null,
                      });
                      setOpenMenu(null);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-zinc-300 hover:bg-white/[0.07] hover:text-white transition-colors cursor-pointer"
                  >
                    <span className="truncate">{a.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
                      {a.count} {a.count === 1 ? "album" : "albums"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Charts & Quality Popover */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(openMenu === "quality" ? null : "quality")}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
              qualityCount > 0
                ? "bg-amber-400/15 border-amber-400/35 text-amber-100"
                : "bg-white/[0.04] border-white/[0.08] text-zinc-300 hover:bg-white/[0.08]"
            }`}
          >
            <Award className="w-3.5 h-3.5 opacity-80" />
            <span>{qualityCount > 0 ? `Charts & Rating (${qualityCount})` : "Charts & Rating"}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {openMenu === "quality" && (
            <div className="absolute left-0 mt-2 w-64 rounded-xl glass-panel shadow-2xl p-3 z-50 space-y-3">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                  Chart Appearances
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { k: "any", l: "Any Chart" },
                    { k: "billboard", l: "Billboard" },
                    { k: "uk", l: "UK Official" },
                    { k: "vg_lista", l: "VG-lista" },
                  ].map((c) => {
                    const active = filter.chart === c.k;
                    return (
                      <button
                        key={c.k}
                        onClick={() =>
                          onChange({ ...filter, chart: active ? null : c.k })
                        }
                        className={`py-1.5 px-2 rounded-lg text-xs border transition-colors cursor-pointer ${
                          active
                            ? "bg-amber-400/20 border-amber-400/45 text-amber-100"
                            : "bg-white/[0.04] border-white/[0.06] text-zinc-300 hover:bg-white/[0.08]"
                        }`}
                      >
                        {c.l}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 border-t border-white/[0.06]">
                <div className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1.5">
                  Minimum Rating
                </div>
                <div className="flex gap-1">
                  {[
                    { val: null, label: "Any" },
                    { val: 60, label: "3★+" },
                    { val: 80, label: "4★+" },
                    { val: 90, label: "4.5★+" },
                  ].map((r) => (
                    <button
                      key={r.label}
                      onClick={() => onChange({ ...filter, minRating: r.val })}
                      className={`flex-1 py-1 rounded-lg text-xs border cursor-pointer ${
                        filter.minRating === r.val
                          ? "bg-amber-400/20 border-amber-400/45 text-amber-100"
                          : "bg-white/[0.04] border-white/[0.06] text-zinc-300 hover:bg-white/[0.08]"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-white/[0.06] space-y-1.5">
                <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Heart className="w-3.5 h-3.5 text-rose-400" /> Has Loved Tracks
                  </span>
                  <input
                    type="checkbox"
                    checked={filter.lovedOnly}
                    onChange={(e) =>
                      onChange({ ...filter, lovedOnly: e.target.checked })
                    }
                    className="accent-amber-400"
                  />
                </label>
                <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
                  <span className="flex items-center gap-1.5">
                    <Disc3 className="w-3.5 h-3.5 text-zinc-400" /> With Cover Art Only
                  </span>
                  <input
                    type="checkbox"
                    checked={filter.hasCoverOnly}
                    onChange={(e) =>
                      onChange({ ...filter, hasCoverOnly: e.target.checked })
                    }
                    className="accent-amber-400"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Sort selector */}
        <div className="flex items-center gap-1.5 ml-auto">
          <select
            value={filter.sortBy}
            onChange={(e) => {
              const val = e.target.value;
              onChange({
                ...filter,
                sortBy: val,
                randomSeed:
                  val === "random" ? Math.floor(Math.random() * 1_000_000) + 1 : filter.randomSeed,
              });
            }}
            className="px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-zinc-200 focus:outline-none focus:border-amber-400/50 cursor-pointer"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#12131a] text-zinc-100">
                Sort: {o.label}
              </option>
            ))}
          </select>

          <button
            onClick={() =>
              onChange({
                ...filter,
                sortBy: "random",
                similarToAlbumId: null,
                randomSeed: Math.floor(Math.random() * 1_000_000) + 1,
              })
            }
            className="p-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.1] hover:text-white transition-colors cursor-pointer"
            title="Shuffle album order"
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>

          {hasActiveFilters && (
            <>
              <div className="relative">
                <button
                  onClick={() => setOpenMenu(openMenu === "save" ? null : "save")}
                  className="p-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-zinc-300 hover:bg-white/[0.1] hover:text-amber-300 transition-colors cursor-pointer"
                  title="Save filter preset"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                </button>
                {openMenu === "save" && (
                  <div className="absolute right-0 mt-2 w-60 rounded-xl glass-panel shadow-2xl p-3 z-50 space-y-2">
                    <div className="text-xs font-medium text-zinc-200">Save Filter Preset</div>
                    <input
                      type="text"
                      autoFocus
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && presetName.trim()) {
                          onSavePreset(presetName.trim());
                          setPresetName("");
                          setOpenMenu(null);
                        }
                      }}
                      placeholder="e.g. Late 80s New Wave"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-white/[0.06] border border-white/10 text-xs text-white focus:outline-none focus:border-amber-400/50"
                    />
                    <button
                      onClick={() => {
                        if (!presetName.trim()) return;
                        onSavePreset(presetName.trim());
                        setPresetName("");
                        setOpenMenu(null);
                      }}
                      className="w-full py-1.5 rounded-lg bg-amber-400 text-zinc-950 font-semibold text-xs hover:bg-amber-300 transition-colors cursor-pointer"
                    >
                      Save Preset
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => onChange({ ...DEFAULT_FILTER })}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-xs text-zinc-300 hover:bg-rose-500/20 hover:border-rose-400/30 hover:text-rose-200 transition-colors cursor-pointer"
                title="Reset all filters"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      {/* Quick discovery & saved presets chips row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
        <button
          onClick={() => onChange({ ...DEFAULT_FILTER })}
          className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
            !hasActiveFilters
              ? "bg-white/15 border-white/25 text-white"
              : "bg-white/[0.03] border-white/[0.06] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.07]"
          }`}
        >
          All Library
        </button>

        {(crateCount > 0 || filter.crateOnly) && (
          <button
            onClick={() =>
              onChange({
                ...DEFAULT_FILTER,
                crateOnly: !filter.crateOnly,
              })
            }
            className={`shrink-0 flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer ${
              filter.crateOnly
                ? "bg-amber-400/20 border-amber-400/50 text-amber-100"
                : "bg-amber-400/[0.08] border-amber-400/25 text-amber-200/90 hover:bg-amber-400/15"
            }`}
          >
            <Bookmark className="w-2.5 h-2.5 fill-amber-300 text-amber-300" />
            Crate ({crateCount})
          </button>
        )}

        {STARTER_CHIPS.map((chip) => (
          <button
            key={chip.label}
            onClick={() => applyStarter(chip.patch)}
            className="shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/[0.03] border border-white/[0.06] text-zinc-400 hover:text-amber-100 hover:border-amber-400/30 hover:bg-amber-400/10 transition-colors cursor-pointer"
          >
            {chip.label}
          </button>
        ))}

        {savedPresets.map((p) => (
          <div
            key={p.id}
            className="shrink-0 flex items-center gap-1 pl-2.5 pr-1.5 py-0.5 rounded-full text-[11px] font-medium bg-indigo-500/15 border border-indigo-400/30 text-indigo-200"
          >
            <button
              onClick={() => onChange({ ...p.filter })}
              className="hover:text-white cursor-pointer"
            >
              {p.name}
            </button>
            <button
              onClick={() => onDeletePreset(p.id)}
              className="opacity-60 hover:opacity-100 cursor-pointer"
              title="Delete saved preset"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
