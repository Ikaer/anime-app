/**
 * The MCP tool handlers — thin adapters over the existing domain functions.
 *
 * **Read-only by construction.** Nothing under `src/lib/mcp/` may import a write
 * path; that is enforced in `eslint.config.mjs` rather than left to discipline,
 * the same way the client-side store guard is. A tool that mutates the store or
 * pushes to a provider does not belong here — the surface exists so a model can
 * ASK about the local record, not edit it.
 *
 * Server-only (reads the store).
 */
import { getAllAnilistCast, getAnimeByCanonicalId, getAnimeForDisplay, isCanonicalId } from '@/lib/store';
import { searchCatalog, MIN_QUERY_LENGTH } from '@/lib/domain/globalSearch';
import { computeStats, STATS_DIMENSIONS, type StatsDimension } from '@/lib/domain/stats';
import { computeFeed } from '@/lib/reco/feed';
import { getRecommendationsData } from '@/lib/reco/data';
import type { Lang } from '@/lib/i18n';
import { buildRelationIndex, resolveRelations, type RelationIndex } from '@/lib/domain/relations';
import {
  applyNarrowingFilters,
  getEffectiveScore,
  getEffectiveStatus,
  sortAnimeRecords,
} from '@/lib/domain/animeUtils';
import { getGenreVocabulary, type GenreVocabulary } from '@/lib/domain/genreVocabulary';
import { projectCard, projectDetail, type McpAnimeCard, type McpAnimeDetail } from '@/lib/mcp/project';
import type { AnimeRecord, RecoContribution, SortColumn } from '@/models/anime';

/** Default page size for list_anime; the tool schema caps the ceiling. */
const DEFAULT_LIST_LIMIT = 20;

/**
 * Relation index + id lookup, memoized on the row array's IDENTITY — the same
 * trick `getFranchiseIndex` / `domain/genreVocabulary` use. The row cache
 * rebuilds exactly when a slice file changes on disk, so a new array means
 * stale indexes.
 */
const relationIndexes = new WeakMap<AnimeRecord[], RelationIndex>();
const recordsById = new WeakMap<AnimeRecord[], Map<string, AnimeRecord>>();

function relationIndexFor(rows: AnimeRecord[]): RelationIndex {
  let idx = relationIndexes.get(rows);
  if (!idx) { idx = buildRelationIndex(rows); relationIndexes.set(rows, idx); }
  return idx;
}

function byIdFor(rows: AnimeRecord[]): Map<string, AnimeRecord> {
  let map = recordsById.get(rows);
  if (!map) { map = new Map(rows.map(a => [a.id, a])); recordsById.set(rows, map); }
  return map;
}

// ---------------------------------------------------------------------------
// search_anime
// ---------------------------------------------------------------------------

export interface SearchResult {
  animes: McpAnimeCard[];
  /** Catalog credits matching the query — feed the id to a credits lookup. */
  studios: Array<{ id: number; name: string; count: number }>;
  staff: Array<{ id: number; name: string; role?: string; count: number }>;
}

/**
 * Catalog-wide search by title, studio or staff name.
 *
 * Anime hits are re-projected to the full card shape rather than passed through
 * as `AnimeSearchHit`s: the hit carries no personal state, and "have I already
 * seen this" is the first thing worth knowing about a result.
 */
export function searchAnime(query: string, limit: number): SearchResult {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { animes: [], studios: [], staff: [] };
  }

  const rows = getAnimeForDisplay();
  const results = searchCatalog(trimmed, rows);
  const byId = byIdFor(rows);

  const animes: McpAnimeCard[] = [];
  for (const hit of results.animes.slice(0, limit)) {
    const record = byId.get(hit.id);
    if (record) animes.push(projectCard(record));
  }

  return {
    animes,
    studios: results.studios.map(s => ({ id: s.id, name: s.name, count: s.count })),
    staff: results.staff.map(s => ({ id: s.id, name: s.name, role: s.role, count: s.count })),
  };
}

// ---------------------------------------------------------------------------
// get_anime
// ---------------------------------------------------------------------------

export type GetAnimeResult =
  | { found: true; anime: McpAnimeDetail }
  | { found: false; error: string };

/**
 * One title in full, by canonical id.
 *
 * Canonical-only on purpose: `a_<n>` is the app's only outward id, and every
 * other tool hands one back. A MAL id arriving here is a caller confusion worth
 * naming rather than silently resolving.
 */
export function getAnime(id: string): GetAnimeResult {
  if (!isCanonicalId(id)) {
    return {
      found: false,
      error: `"${id}" is not a canonical id. Ids look like "a_1234" and come from search_anime.`,
    };
  }

  const record = getAnimeByCanonicalId(id);
  if (!record) return { found: false, error: `No anime with id "${id}".` };

  // The relation index needs the whole catalog; the record itself is cheap.
  const relations = resolveRelations(record, relationIndexFor(getAnimeForDisplay()));
  return { found: true, anime: projectDetail(record, relations) };
}

// ---------------------------------------------------------------------------
// list_anime
// ---------------------------------------------------------------------------

/**
 * Sort keys this tool accepts.
 *
 * `my_score` / `my_progress` are why this union exists rather than `SortColumn`
 * alone: `SortColumn` is the MAIN LIST's URL-facing vocabulary (`SORT_TO_CODE`
 * in `url/animeParams.ts` is an exhaustive `Record` over it, and
 * `SortOrderSection` renders one option per entry), so adding a personal key
 * there would mean inventing a URL code and a sidebar option for a sort no page
 * offers. The two personal keys are ordered here; every catalog key delegates to
 * the shared `sortAnimeRecords`, so there is still ONE catalog sort implementation.
 */
export const MCP_SORT_KEYS = [
  'my_score',
  'my_progress',
  'mean',
  'title',
  'start_date',
  'num_episodes',
  'rank',
  'popularity',
  'num_list_users',
] as const;
export type McpSortKey = (typeof MCP_SORT_KEYS)[number];

export interface ListAnimeParams {
  /** Effective status (SIMKL > MAL > AniList > local). `not_defined` = untouched. */
  statuses?: string[];
  /** The OWNER's own score, 1-10. Deliberately distinct from `minMean`. */
  minMyScore?: number;
  maxMyScore?: number;
  /** The COMMUNITY mean, 1-10 — what `minScore`/`maxScore` mean in the REST API. */
  minMean?: number;
  maxMean?: number;
  minYear?: number;
  maxYear?: number;
  genres?: string[];
  mediaTypes?: string[];
  search?: string;
  ratedOnly?: boolean;
  unratedOnly?: boolean;
  includeHidden?: boolean;
  sortBy?: McpSortKey;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface ListAnimeResult {
  items: McpAnimeCard[];
  /** Matches BEFORE paging — so a truncated answer is visible, never silent. */
  total: number;
  offset: number;
  limit: number;
  /** True when more matches remain; page on with `offset`. */
  hasMore: boolean;
}

/** `my_score` / `my_progress` here; every other key delegates to the shared sorter. */
function sortRecords(rows: AnimeRecord[], key: McpSortKey, dir: 'asc' | 'desc'): AnimeRecord[] {
  if (key !== 'my_score' && key !== 'my_progress') {
    return sortAnimeRecords(rows, key as SortColumn, dir);
  }
  const sign = dir === 'asc' ? 1 : -1;
  const valueOf = (a: AnimeRecord) =>
    key === 'my_score' ? getEffectiveScore(a) : a.personal.progress;
  // Copy before sorting: an unfiltered `rows` is still the shared long-lived
  // cache array, and sorting it in place would mutate every other reader's view.
  return [...rows].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    // No value sorts last whatever the direction — same rule as sortAnimeRecords.
    if (av == null || bv == null) {
      if (av == bv) return 0;
      return av == null ? 1 : -1;
    }
    return (av - bv) * sign;
  });
}

/**
 * The owner's list (and the wider catalog), filtered, sorted and paged.
 *
 * This is the tool that answers "what are my favourites" — `statuses:
 * ['completed'], sortBy: 'my_score', sortDir: 'desc'` — which `search_anime`
 * structurally cannot, being a name lookup.
 *
 * ⚠️ **Personal score and community mean are separate parameters and must stay
 * that way.** `minScore`/`maxScore` on the REST list endpoint filter MAL's
 * `mean`, not the owner's score; collapsing the two here would quietly answer a
 * different question than the one asked.
 */
export function listAnime(params: ListAnimeParams): ListAnimeResult {
  const limit = params.limit ?? DEFAULT_LIST_LIMIT;
  const offset = params.offset ?? 0;

  let rows = getAnimeForDisplay();

  // Hidden titles are excluded by default: the owner hid them deliberately.
  if (!params.includeHidden) rows = rows.filter(a => a.hidden !== true);

  // Catalog narrowing — the SAME function `/api/anime/animes` and the reco feed
  // use, so there is one filter implementation rather than three. Note its genre
  // semantics are AND (every listed genre must be present).
  rows = applyNarrowingFilters(rows, {
    mediaTypes: params.mediaTypes,
    search: params.search,
    minScore: params.minMean ?? null,
    maxScore: params.maxMean ?? null,
    minYear: params.minYear ?? null,
    maxYear: params.maxYear ?? null,
    genres: params.genres,
  });

  if (params.statuses && params.statuses.length > 0) {
    const wanted = new Set(params.statuses);
    rows = rows.filter(a => wanted.has(getEffectiveStatus(a) ?? 'not_defined'));
  }

  if (params.ratedOnly) rows = rows.filter(a => getEffectiveScore(a) != null);
  if (params.unratedOnly) rows = rows.filter(a => getEffectiveScore(a) == null);

  if (params.minMyScore != null) {
    const min = params.minMyScore;
    rows = rows.filter(a => { const s = getEffectiveScore(a); return s != null && s >= min; });
  }
  if (params.maxMyScore != null) {
    const max = params.maxMyScore;
    rows = rows.filter(a => { const s = getEffectiveScore(a); return s != null && s <= max; });
  }

  const total = rows.length;
  const sorted = sortRecords(rows, params.sortBy ?? 'my_score', params.sortDir ?? 'desc');
  const page = sorted.slice(offset, offset + limit);

  return {
    items: page.map(projectCard),
    total,
    offset,
    limit,
    hasMore: total > offset + page.length,
  };
}

// ---------------------------------------------------------------------------
// list_genres
// ---------------------------------------------------------------------------

/**
 * The genre vocabulary actually present in the store, split on the three axes
 * `genres` conflates. A model filtering by genre has to be told which names
 * exist — `theme` is open-ended, so guessing produces empty result sets.
 */
export function listGenres(): GenreVocabulary {
  return getGenreVocabulary(getAnimeForDisplay());
}

// ---------------------------------------------------------------------------
// my_stats
// ---------------------------------------------------------------------------

/** A stats row, minus the fields only a web page can use. */
export interface McpStatEntry {
  name: string;
  /** DISTINCT anime carrying this entity — never a credit count. */
  count: number;
  /** Share of the filtered title total, 0-100. */
  pct: number;
  /** AniList staff id, for `staff` and `seiyuu` rows. */
  id?: number;
  /** Most frequent role (staff) or sample characters (seiyuu). */
  detail?: string;
}

export interface McpDimensionStats {
  dimension: StatsDimension;
  entries: McpStatEntry[];
  /** Distinct entities before the top-N cut — "top 15 of 412". */
  distinct: number;
  /** Titles in scope carrying ANY data here. Below `total` means partial coverage. */
  covered: number;
}

export interface MyStatsResult {
  /** Titles in scope after the status filter — the percentage denominator. */
  total: number;
  /** Titles carrying a status at all, before the status filter. */
  totalStatused: number;
  dimensions: McpDimensionStats[];
  /**
   * Set when a requested dimension is thin: `seiyuu` and `producers` come from
   * the lazily-filled cast slice, so a low `covered` means the sweep has not
   * reached those titles — not that the taste isn't there.
   */
  note?: string;
}

/** Default rows per dimension. The page shows 50; a model rarely needs that many. */
const DEFAULT_STATS_LIMIT = 15;

/**
 * What the owner's list is MADE OF — top studios, seiyuu, staff, producers, tags
 * and genres by share of titles.
 *
 * Scope is the STATUSED list, never the ~25k catalog: a repartition over
 * never-watched titles would describe MAL's catalog rather than the owner's
 * taste. Counts are DISTINCT anime, so multi-valued dimensions sum past 100% on
 * purpose (a title has many genres).
 */
export function myStats(
  dimensions: StatsDimension[] | undefined,
  statuses: string[] | undefined,
  limit: number | undefined
): MyStatsResult {
  const rows = limit ?? DEFAULT_STATS_LIMIT;
  const wanted = dimensions && dimensions.length > 0 ? dimensions : STATS_DIMENSIONS;

  // The cast slice is read separately — it is deliberately NOT in
  // `getAnimeForDisplay()`'s join, and `seiyuu`/`producers` are the two
  // dimensions that depend on it.
  const stats = computeStats(getAnimeForDisplay(), getAllAnilistCast(), { statuses: statuses ?? [] });

  const projected = wanted.map(dimension => {
    const d = stats.dimensions[dimension];
    return {
      dimension,
      entries: d.entries.slice(0, rows).map(e => compactEntry({
        name: e.name,
        count: e.count,
        pct: e.pct,
        id: e.id,
        detail: e.detail,
      })),
      distinct: d.distinct,
      covered: d.covered,
    };
  });

  // Declare thin coverage rather than letting a half-swept slice read as taste.
  const thin = projected.filter(d => stats.total > 0 && d.covered < stats.total * 0.5);
  const note = thin.length
    ? `Partial coverage on ${thin.map(d => `${d.dimension} (${d.covered}/${stats.total})`).join(', ')}` +
      ' — these come from the lazily-filled AniList cast slice, so the ranking covers only swept titles.'
    : undefined;

  return { total: stats.total, totalStatused: stats.totalStatused, dimensions: projected, ...(note ? { note } : {}) };
}

/** Drop `undefined` keys so the JSON a model reads carries no empty fields. */
function compactEntry(e: McpStatEntry): McpStatEntry {
  if (e.id === undefined) delete e.id;
  if (e.detail === undefined) delete e.detail;
  return e;
}

// ---------------------------------------------------------------------------
// recommend
// ---------------------------------------------------------------------------

/** One recommended title: the card, plus why the engine put it there. */
export interface McpRecommendation extends McpAnimeCard {
  /** The additive weighted-sum affinity score the ranking is by. */
  affinityScore: number;
  /** Seeds (titles the owner liked) whose crowd recos point here. */
  becauseOf: Array<{ id: string; title: string }>;
  /** Top contributing sources, strongest first — the "why", already localized. */
  why: Array<{ source: string; contribution: number; detail?: string }>;
}

export interface RecommendParams {
  limit?: number;
  nicheMode?: boolean;
  threshold?: number;
  diversity?: number;
  mediaTypes?: string[];
  genres?: string[];
  minMean?: number;
  maxMean?: number;
  minYear?: number;
  maxYear?: number;
  search?: string;
  lang?: Lang;
}

export interface RecommendResult {
  items: McpRecommendation[];
  total: number;
  /** ISO timestamp of the last cache refresh, or null if it has never run. */
  lastRefresh: string | null;
  /** Set when the answer is empty or degraded, so a thin feed is never silent. */
  note?: string;
}

const DEFAULT_RECO_LIMIT = 15;
/** Contributions per card. The full breakdown is one line per source and mostly zeros. */
const WHY_LIMIT = 4;

function projectWhy(breakdown: RecoContribution[]): McpRecommendation['why'] {
  return breakdown
    .filter(c => c.contribution !== 0)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, WHY_LIMIT)
    .map(c => ({
      source: c.source,
      contribution: Math.round(c.contribution * 1000) / 1000,
      ...(c.detail ? { detail: c.detail } : {}),
    }));
}

/**
 * The "Pour toi" feed — unseen titles ranked by affinity to the owner's taste.
 *
 * Reads the cached candidate set and re-ranks it live; it **never refreshes**.
 * The refresh is the expensive half (it calls MAL and AniList and writes
 * `cache/recommendations.json`), which is a write and therefore not something
 * this surface may do — so an empty cache is REPORTED rather than repaired.
 *
 * The narrowing filters go through the same `applyNarrowingFilters` the feed
 * route uses. Status and sort deliberately do not apply: the feed is unseen
 * titles by construction, and its order IS the affinity ranking.
 */
export function recommend(params: RecommendParams): RecommendResult {
  const limit = params.limit ?? DEFAULT_RECO_LIMIT;
  const data = getRecommendationsData();

  const ranked = computeFeed({
    nicheMode: params.nicheMode ?? false,
    threshold: params.threshold ?? null,
    diversity: params.diversity ?? null,
    lang: params.lang ?? 'fr',
  });

  const filtered = applyNarrowingFilters(ranked, {
    mediaTypes: params.mediaTypes,
    search: params.search,
    minScore: params.minMean ?? null,
    maxScore: params.maxMean ?? null,
    minYear: params.minYear ?? null,
    maxYear: params.maxYear ?? null,
    genres: params.genres,
  });

  const items = filtered.slice(0, limit).map(item => ({
    ...projectCard(item),
    affinityScore: Math.round(item.recoMeta.affinityScore * 1000) / 1000,
    becauseOf: item.recoMeta.topSeeds.slice(0, 3).map(s => ({ id: s.id, title: s.title })),
    why: projectWhy(item.recoMeta.breakdown),
  }));

  let note: string | undefined;
  if (!data.lastRefresh) {
    note = 'The recommendations cache has never been refreshed, so the feed is empty. ' +
      'This tool cannot refresh it (that would write); the owner refreshes from the app\'s ' +
      'Connections page or the nightly cron sync.';
  } else if (ranked.length === 0) {
    note = `The cache was last refreshed ${data.lastRefresh} but ranks no candidates — ` +
      'likely too few completed+scored titles to seed from.';
  } else if (filtered.length === 0) {
    note = `${ranked.length} candidates ranked, but none matched the filters.`;
  }

  return { items, total: filtered.length, lastRefresh: data.lastRefresh, ...(note ? { note } : {}) };
}
