/**
 * The MCP tool handlers — thin adapters over the existing domain functions.
 *
 * **Read-only by construction.** Nothing under `src/lib/mcp/` may import a write
 * path; that is enforced in `eslint.config.mjs` rather than left to discipline,
 * the same way the client-side store guard is. A tool that mutates the store or
 * pushes to a provider does not belong here — the surface exists so a model can
 * ASK about the local record, not edit it.
 *
 * Server-only (reads the store). Phase 1: `search_anime` + `get_anime`.
 */
import { getAnimeByCanonicalId, getAnimeForDisplay, isCanonicalId } from '@/lib/store';
import { searchCatalog, MIN_QUERY_LENGTH } from '@/lib/domain/globalSearch';
import { buildRelationIndex, resolveRelations, type RelationIndex } from '@/lib/domain/relations';
import { projectCard, projectDetail, type McpAnimeCard, type McpAnimeDetail } from '@/lib/mcp/project';
import type { AnimeRecord } from '@/models/anime';

/**
 * Relation index + id lookup, memoized on the row array's IDENTITY — the same
 * trick `getFranchiseIndex` / `api/anime/genres` use. The row cache rebuilds
 * exactly when a slice file changes on disk, so a new array means stale indexes.
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
