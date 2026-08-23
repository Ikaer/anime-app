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
import { getAnimeByCanonicalId, getAnimeForDisplay, isCanonicalId } from '@/lib/store';
import { searchCatalog, MIN_QUERY_LENGTH } from '@/lib/domain/globalSearch';
import { buildRelationIndex, resolveRelations, type RelationIndex } from '@/lib/domain/relations';
import {
  applyNarrowingFilters,
  getEffectiveScore,
  getEffectiveStatus,
  sortAnimeRecords,
} from '@/lib/domain/animeUtils';
import { getGenreVocabulary, type GenreVocabulary } from '@/lib/domain/genreVocabulary';
import { projectCard, projectDetail, type McpAnimeCard, type McpAnimeDetail } from '@/lib/mcp/project';
import type { AnimeRecord, SortColumn } from '@/models/anime';

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
