/**
 * Relation resolution — ONE relation graph out of two provider payloads.
 *
 * Pure and client-safe (no `fs`): the indices are derived from the records the
 * caller already holds, never from the registry, which is what lets
 * `reco/scoring.ts` and `reco/byCredits.ts` use this under the eslint import
 * guard.
 *
 * **Why this exists.** Relations arrive from two places with two shapes:
 *
 * - `catalog.relatedAnime` — MAL's, hydrated by `catalogFromMal` only. MAL
 *   returns `related_anime` from its single-title *detail* endpoint alone, so a
 *   crawled catalog has it for almost nothing: **48 of 25,391** titles on the
 *   live store.
 * - `sources.anilist.relations` — AniList's, fetched in the same batch query as
 *   tags/staff/banner, so it covers **11,419** titles.
 *
 * Every consumer used to read the first and ignore the second, which made the
 * relation-dependent behaviour dead on 99.8% of the catalog: the detail page's
 * "Anime liés" section rendered for 48 titles, and `isPrematureSequel` fell
 * through to its title regex for everything else.
 *
 * The fix is NOT to merge AniList into `catalog.relatedAnime` — that field's
 * `node` carries a MAL id, a title and a picture, while an `AniListRelationEntry`
 * carries only ids, so filling it would mean inventing the display fields. It is
 * to resolve an edge to **the target's local record**, which already has them.
 * That also drops the MAL-id space from the consumers: they get an `AnimeRecord`,
 * not a number to look up.
 */
import type { AnimeRecord } from '@/models/anime';

/**
 * AniList's relation vocabulary → MAL's, so consumers match on one set of
 * strings. Unmapped values fall through lowercased (`COMPILATION` →
 * `compilation`), which keeps them visible without pretending they are a MAL
 * relation type.
 *
 * `PARENT` → `parent_story` and `ALTERNATIVE` → `alternative_version` are the
 * two that are not a plain case change, and both matter: the first is a
 * franchise edge, the second deliberately is not.
 */
const ANILIST_RELATION_TO_MAL: Record<string, string> = {
  SEQUEL: 'sequel',
  PREQUEL: 'prequel',
  SIDE_STORY: 'side_story',
  PARENT: 'parent_story',
  ALTERNATIVE: 'alternative_version',
  SPIN_OFF: 'spin_off',
  SUMMARY: 'summary',
  CHARACTER: 'character',
  OTHER: 'other',
};

/** Numeric provider id from a crosswalk value (SIMKL sometimes stores them as strings). */
export function toProviderId(v: number | string | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** `side_story` → `Side Story`, matching the shape of MAL's own formatted strings. */
function prettifyRelation(relationType: string): string {
  return relationType
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Provider id → canonical id, plus the record lookup. Build it ONCE per pass:
 * every consumer here runs over the whole catalog, so rebuilding per record
 * would be quadratic.
 *
 * Two id indices, not one: a MAL edge only ever carries a MAL id, but an AniList
 * edge may point at an AniList-only title, which has no MAL id at either end.
 * Keying on MAL alone silently drops every such edge.
 */
export interface RelationIndex {
  byCanonical: Map<string, AnimeRecord>;
  byMal: Map<number, string>;
  byAnilist: Map<number, string>;
}

/**
 * Memoized on the **array's identity**, the same contract `byCredits`' IDF cache
 * and `/quick-rate`'s component index use: `getAnimeForDisplay()` returns a
 * stable array until a slice file's mtime changes, so this is rebuilt exactly
 * when the catalog actually did.
 *
 * Without it the detail page would build the ~25k index twice per view — once
 * for its relations section and once inside `computeSimilarByCredits`.
 */
const indexCache = new WeakMap<AnimeRecord[], RelationIndex>();

export function buildRelationIndex(records: AnimeRecord[]): RelationIndex {
  const cached = indexCache.get(records);
  if (cached) return cached;

  const byCanonical = new Map<string, AnimeRecord>();
  const byMal = new Map<number, string>();
  const byAnilist = new Map<number, string>();
  for (const r of records) {
    byCanonical.set(r.id, r);
    const malId = toProviderId(r.crosswalk?.mal);
    if (malId !== undefined && !byMal.has(malId)) byMal.set(malId, r.id);
    const anilistId = toProviderId(r.crosswalk?.anilist);
    if (anilistId !== undefined && !byAnilist.has(anilistId)) byAnilist.set(anilistId, r.id);
  }

  const index = { byCanonical, byMal, byAnilist };
  indexCache.set(records, index);
  return index;
}

/** One resolved edge: the target as a record, never a provider id. */
export interface ResolvedRelation {
  record: AnimeRecord;
  /** MAL vocabulary — AniList's is normalized into it (see the map above). */
  relationType: string;
  /** MAL's own display string where the edge came from MAL, derived otherwise. */
  formatted: string;
}

/**
 * Every relation of `anime` whose target is in the catalog, from both providers.
 *
 * MAL edges come first and win a tie, because they carry MAL's own
 * `relation_type_formatted`. An edge whose target is absent from the catalog is
 * dropped — there is no record to point at, and a bare id is what this module
 * exists to stop handing out.
 */
export function resolveRelations(anime: AnimeRecord, index: RelationIndex): ResolvedRelation[] {
  const out = new Map<string, ResolvedRelation>();

  for (const rel of anime.catalog.relatedAnime || []) {
    const targetId = index.byMal.get(rel.node.id);
    const record = targetId !== undefined ? index.byCanonical.get(targetId) : undefined;
    if (!record || record.id === anime.id || out.has(record.id)) continue;
    out.set(record.id, {
      record,
      relationType: rel.relation_type,
      formatted: rel.relation_type_formatted || prettifyRelation(rel.relation_type),
    });
  }

  for (const rel of anime.sources.anilist?.relations || []) {
    // MAL id first — it is the key the catalog is overwhelmingly anchored on —
    // then AniList's, the only handle on an AniList-only target.
    const targetId = (rel.idMal !== undefined ? index.byMal.get(rel.idMal) : undefined)
      ?? (rel.id !== undefined ? index.byAnilist.get(rel.id) : undefined);
    const record = targetId !== undefined ? index.byCanonical.get(targetId) : undefined;
    if (!record || record.id === anime.id || out.has(record.id)) continue;
    const relationType = ANILIST_RELATION_TO_MAL[rel.relationType] ?? rel.relationType.toLowerCase();
    out.set(record.id, { record, relationType, formatted: prettifyRelation(relationType) });
  }

  return [...out.values()];
}
