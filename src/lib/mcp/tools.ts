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
import { loadSimilarTo, type SimilarSources } from '@/lib/reco/similarFetch';
import type { Lang } from '@/lib/i18n';
import { buildRelationIndex, resolveRelations, type RelationIndex } from '@/lib/domain/relations';
import {
  applyNarrowingFilters,
  getEffectiveScore,
  getEffectiveStatus,
  getPrimaryTitle,
  sortAnimeRecords,
} from '@/lib/domain/animeUtils';
import { getGenreVocabulary, type GenreVocabulary } from '@/lib/domain/genreVocabulary';
import {
  GAP_ROWS, TIER_SCORES, TIER_STATUSES,
  clampGapRow, gapOf, meanRow, providerMeans, type GapProvider, type TierAxis,
} from '@/lib/domain/tierGap';
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

export interface MyStatsParams {
  dimensions?: StatsDimension[];
  statuses?: string[];
  /**
   * Bounds on the OWNER'S OWN score (1-10), inclusive. Either one present drops
   * unrated titles — see `ComputeStatsOptions`. Named for whose score it is,
   * because `minMean`/`maxMean` elsewhere are the community's.
   */
  minMyScore?: number;
  maxMyScore?: number;
  limit?: number;
}

export interface MyStatsResult {
  /** Titles in scope after the status AND score filters — the percentage denominator. */
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
 *
 * The score bounds are what separate "what do I watch a lot of" from "what do I
 * actually rate highly" — over a whole list, volume tracks what a genre PRODUCES
 * as much as what the owner loves, so the unbounded ranking answers only the
 * first question.
 */
export function myStats(params: MyStatsParams = {}): MyStatsResult {
  const { dimensions, statuses, minMyScore, maxMyScore, limit } = params;
  const rows = limit ?? DEFAULT_STATS_LIMIT;
  const wanted = dimensions && dimensions.length > 0 ? dimensions : STATS_DIMENSIONS;

  // The cast slice is read separately — it is deliberately NOT in
  // `getAnimeForDisplay()`'s join, and `seiyuu`/`producers` are the two
  // dimensions that depend on it.
  const stats = computeStats(getAnimeForDisplay(), getAllAnilistCast(), {
    statuses: statuses ?? [], minMyScore, maxMyScore,
  });

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

// ---------------------------------------------------------------------------
// similar_to
// ---------------------------------------------------------------------------

export interface McpSimilarItem {
  id: string;
  title: string;
  year?: number;
  mediaType?: string;
  mean?: number;
  /** The owner's effective status, when they already listed it. */
  status?: string;
  /** True when the owner has already watched it — NOT excluded, just marked. */
  seen: boolean;
  score: number;
  why: Array<{ source: string; contribution: number; detail?: string }>;
}

export type SimilarToResult =
  | {
      ok: true;
      items: McpSimilarItem[];
      /** Per-source outcome — a dead pipe is declared, not hidden behind a thin list. */
      sources: SimilarSources;
      note?: string;
    }
  | { ok: false; error: string };

const DEFAULT_SIMILAR_LIMIT = 15;

/**
 * Titles resembling ONE anime, from its crowd recommendations.
 *
 * The one tool here that REACHES THE NETWORK: it asks MAL and AniList for that
 * title's recommendation edges on every call (in parallel, each non-fatal), then
 * re-ranks them against the owner's taste. It is still a read — nothing is
 * persisted — but it spends AniList's ~30 req/min budget, so it is not free the
 * way the store-backed tools are.
 *
 * Seen titles are NOT excluded, unlike the feed: the pool is ~25 edges before
 * filtering, so dropping them would gut the answer for a heavy watcher. They
 * come back flagged `seen` instead.
 */
export async function similarTo(
  id: string,
  limit: number | undefined,
  lang: Lang | undefined
): Promise<SimilarToResult> {
  if (!isCanonicalId(id)) {
    return { ok: false, error: `"${id}" is not a canonical id. Ids look like "a_1234" and come from search_anime.` };
  }

  const result = await loadSimilarTo(id, limit ?? DEFAULT_SIMILAR_LIMIT, lang ?? 'fr');

  if (!result.ok) {
    switch (result.failure.kind) {
      case 'invalid_id':
        return { ok: false, error: `"${id}" is not a canonical id.` };
      case 'no_provider_id':
        return { ok: false, error: `No MAL or AniList id is known for "${id}", so neither crowd source can be asked.` };
      case 'all_sources_failed':
        return {
          ok: false,
          error: `Both crowd sources failed — MAL: ${result.failure.sources.mal.error ?? 'unknown'}; ` +
            `AniList: ${result.failure.sources.anilist.error ?? 'unknown'}.`,
        };
    }
  }

  const items = result.items.map(item => ({
    id: item.id,
    title: item.title,
    year: item.year,
    mediaType: item.mediaType,
    mean: item.mean,
    status: item.status,
    seen: item.seen,
    score: Math.round(item.score * 1000) / 1000,
    why: projectWhy(item.breakdown),
  }));

  // One pipe down halves the pool, which reads as a thin answer rather than a
  // degraded one unless it is said out loud.
  const dead = [
    !result.sources.mal.ok ? `MAL (${result.sources.mal.error})` : null,
    !result.sources.anilist.ok ? `AniList (${result.sources.anilist.error})` : null,
  ].filter(Boolean);
  const note = dead.length
    ? `Only part of the pool was available — ${dead.join(', ')}. Results are thinner than usual.`
    : items.length === 0
      ? 'Both sources answered, but neither knows any recommendation for this title.'
      : undefined;

  return { ok: true, items, sources: result.sources, ...(note ? { note } : {}) };
}

// ---------------------------------------------------------------------------
// tier_list
// ---------------------------------------------------------------------------

export interface McpTierEntry {
  id: string;
  title: string;
  year?: number;
  mediaType?: string;
  status?: string;
  /** The owner's own score, 1-10. Absent means unrated. */
  myScore?: number;
  /** MAL's own community mean — NOT the precedence-merged `mean`. */
  malMean?: number;
  /** AniList's own community mean, already on MAL's 1-10 scale. */
  anilistMean?: number;
  /** myScore − round(comparison provider's mean). Positive = rates it above the crowd. */
  gap?: number;
  /** Which board row it lands in on the requested axis. */
  row: number;
}

export interface McpTierRow {
  /** Row value: 10..1 on a score axis, +5..−5 on the gap axis. */
  row: number;
  count: number;
}

export interface TierGapSummary {
  comparable: number;
  /** Mean of (my score − provider's rounded mean). Positive = generous vs the crowd. */
  averageGap: number;
  above: number;
  equal: number;
  below: number;
}

export interface TierListResult {
  axis: TierAxis;
  /** Which provider the gaps compare against. */
  vs: GapProvider;
  /** Titles matching the filters, after gap narrowing — what `items` pages through. */
  total: number;
  /** Every row with its count, board order. The tier list's SHAPE, always complete. */
  distribution: McpTierRow[];
  /** Titles with no value on this axis: unrated, or the provider has no mean. */
  unplaced: number;
  /** How the owner compares to the provider overall. Null when nothing is comparable. */
  gapSummary: TierGapSummary | null;
  /** The titles themselves, paged. `distribution` already covers the whole board. */
  items: McpTierEntry[];
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface TierListParams {
  axis?: TierAxis;
  vs?: GapProvider;
  statuses?: string[];
  /** Keep only titles at least this far above the provider (negatives for below). */
  minGap?: number;
  maxGap?: number;
  genres?: string[];
  mediaTypes?: string[];
  minYear?: number;
  maxYear?: number;
  search?: string;
  /** `gap` (default) is signed: desc surfaces where the owner is most generous. */
  sortBy?: 'gap' | 'abs_gap' | 'my_score' | 'mean' | 'title';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const DEFAULT_TIER_LIMIT = 25;

/**
 * The tier board as data — the owner's scores bucketed into rows, and how each
 * title's score compares to the community mean.
 *
 * Scope matches the board exactly: the four statuses that mean "seen, or being
 * seen". `plan_to_watch` is excluded because you cannot rate what you have not
 * watched, so it would be a row of blanks.
 *
 * ⚠️ **The comparison reads each provider's OWN mean, never `catalog.mean`** —
 * see `providerMeans`. Comparing against the merged value would compare a title
 * to itself whenever that provider won the precedence for the field.
 *
 * `distribution` is always the WHOLE board, even when `items` is one page: the
 * shape is the cheap part and the thing a tier list actually IS, so it must not
 * become a function of paging.
 */
export function tierList(params: TierListParams): TierListResult {
  const axis: TierAxis = params.axis ?? 'gap';
  const vs: GapProvider = params.vs ?? 'mal';
  const limit = params.limit ?? DEFAULT_TIER_LIMIT;
  const offset = params.offset ?? 0;
  const statuses = params.statuses && params.statuses.length > 0
    ? new Set<string>(params.statuses)
    : new Set<string>(TIER_STATUSES);

  let rows = getAnimeForDisplay().filter(a => {
    const s = getEffectiveStatus(a);
    return s != null && statuses.has(s);
  });

  rows = applyNarrowingFilters(rows, {
    mediaTypes: params.mediaTypes,
    search: params.search,
    minYear: params.minYear ?? null,
    maxYear: params.maxYear ?? null,
    genres: params.genres,
    minScore: null,
    maxScore: null,
  });

  // Build every entry once; the axis decides which value places it in a row.
  const built = rows.map(a => {
    const means = providerMeans(a);
    const myScore = getEffectiveScore(a);
    const gap = gapOf(myScore, means[vs]);

    let row: number | null;
    if (axis === 'me') {
      row = myScore != null && myScore > 0 ? myScore : null;
    } else if (axis === 'gap') {
      row = gap === null ? null : clampGapRow(gap);
    } else {
      const mean = means[axis];
      row = mean == null ? null : meanRow(mean);
    }

    const entry: McpTierEntry = {
      id: a.id,
      title: getPrimaryTitle(a),
      year: a.catalog.startSeason?.year,
      mediaType: a.catalog.mediaType,
      status: getEffectiveStatus(a),
      myScore: myScore && myScore > 0 ? myScore : undefined,
      malMean: means.mal ?? undefined,
      anilistMean: means.anilist ?? undefined,
      gap: gap ?? undefined,
      row: row ?? 0,
    };
    for (const k of ['year', 'mediaType', 'status', 'myScore', 'malMean', 'anilistMean', 'gap'] as const) {
      if (entry[k] === undefined) delete entry[k];
    }
    return { entry, placed: row !== null };
  });

  const placed = built.filter(b => b.placed);
  const unplaced = built.length - placed.length;

  // The board's shape, over everything placed — never a function of paging.
  const boardRows = axis === 'gap' ? GAP_ROWS : TIER_SCORES;
  const counts = new Map<number, number>(boardRows.map(r => [r, 0]));
  for (const b of placed) counts.set(b.entry.row, (counts.get(b.entry.row) ?? 0) + 1);
  const distribution = boardRows.map(row => ({ row, count: counts.get(row) ?? 0 }));

  // Gap stats span every comparable title in scope, independent of the axis —
  // "how do I compare to MAL" is worth answering even while reading a score axis.
  const gaps = built.map(b => b.entry.gap).filter((g): g is number => g !== undefined);
  const gapSummary: TierGapSummary | null = gaps.length
    ? {
        comparable: gaps.length,
        averageGap: Math.round((gaps.reduce((s, g) => s + g, 0) / gaps.length) * 100) / 100,
        above: gaps.filter(g => g > 0).length,
        equal: gaps.filter(g => g === 0).length,
        below: gaps.filter(g => g < 0).length,
      }
    : null;

  // Gap filters narrow the ITEMS, not the distribution: the shape answers "what
  // does my board look like", these answer "show me the disagreements".
  let items = placed.map(b => b.entry);
  const { minGap, maxGap } = params;
  if (minGap != null) items = items.filter(e => e.gap != null && e.gap >= minGap);
  if (maxGap != null) items = items.filter(e => e.gap != null && e.gap <= maxGap);

  const dir = (params.sortDir ?? 'desc') === 'asc' ? 1 : -1;
  const sortBy = params.sortBy ?? 'gap';
  const keyOf = (e: McpTierEntry): number | string | null => {
    switch (sortBy) {
      case 'gap': return e.gap ?? null;
      case 'abs_gap': return e.gap == null ? null : Math.abs(e.gap);
      case 'my_score': return e.myScore ?? null;
      case 'mean': return (vs === 'anilist' ? e.anilistMean : e.malMean) ?? null;
      case 'title': return e.title.toLowerCase();
    }
  };
  items = [...items].sort((a, b) => {
    const av = keyOf(a);
    const bv = keyOf(b);
    // No value sorts last whatever the direction — same rule as sortAnimeRecords.
    if (av === null || bv === null) {
      if (av === bv) return 0;
      return av === null ? 1 : -1;
    }
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });

  const total = items.length;
  const page = items.slice(offset, offset + limit);

  return {
    axis,
    vs,
    total,
    distribution,
    unplaced,
    gapSummary,
    items: page,
    offset,
    limit,
    hasMore: total > offset + page.length,
  };
}
