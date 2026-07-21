/**
 * Franchise grouping — connected components over the MAL relation graph
 * (docs/quickRate/).
 *
 * Pure and client-safe (no `fs`), though today only the `/api/anime/quick-rate`
 * handler uses it: grouping runs server-side because the input is the whole
 * catalog (~25k records) and only the grouped, lean projection crosses the wire.
 *
 * NOTE: the spec said to reuse the connections page's traversal — there isn't
 * one. `connections.tsx` is the MAL/SIMKL *account* page and touches no relation
 * graph, so this is written from scratch.
 */
import type { AnimeRecord } from '@/models/anime';

/**
 * Relation types that mean "same franchise", as an undirected edge. MAL emits
 * both directions (a sequel edge on one title, prequel on the other), but not
 * always on both sides, so traversal unions in whichever direction it finds.
 *
 * Deliberately NOT included: `other`, `character`, `spin_off`, `summary`,
 * `alternative_setting`, `alternative_version` — those link titles that share a
 * universe or a cast without being the same watch-order franchise, and pulling
 * them in over-merges (one `other` edge can chain two unrelated series together,
 * and a bad merge here means a bulk score lands on the wrong show).
 */
export const FRANCHISE_RELATIONS = new Set([
  'sequel',
  'prequel',
  'side_story',
  'parent_story',
  'full_story',
]);

/**
 * The same rule in AniList's vocabulary. AniList is the **primary** source here:
 * MAL only returns `related_anime` from its single-title detail endpoint, so the
 * crawled catalog has relations for a handful of titles, while AniList returns
 * them 50 at a time (see `AniListRelationEntry`). MAL edges are still unioned in
 * — they're free and cover anything AniList missed.
 *
 * `ALTERNATIVE` is excluded alongside the MAL equivalents: it links different
 * adaptations of one work (the 2003 and 2009 Fullmetal Alchemist series), which
 * are separate watch orders you may well rate differently.
 */
export const ANILIST_FRANCHISE_RELATIONS = new Set([
  'SEQUEL',
  'PREQUEL',
  'SIDE_STORY',
  'PARENT',
]);

/** Numeric provider id from a crosswalk value (SIMKL sometimes stores them as strings). */
function toProviderId(v: number | string | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Group records into franchises: each returned array is one connected component
 * of the relation graph, in the input's order. A record with no in-catalog
 * relations comes back as its own single-member group.
 *
 * Relation edges carry **provider** ids while records are canonical-keyed, so the
 * traversal resolves through provider→canonical indices built from `crosswalk`.
 * An edge pointing at a title the catalog doesn't have is simply dropped.
 *
 * Two indices, not one: MAL edges only ever carry a MAL id, but an AniList edge
 * may point at an AniList-only title, which has no MAL id on either end
 * (PROVIDER-PARITY.md B1). Resolving those was impossible while the edge itself
 * stored a MAL id alone.
 */
export function groupIntoFranchises(records: AnimeRecord[]): AnimeRecord[][] {
  const byCanonical = new Map<string, AnimeRecord>();
  const canonicalByMal = new Map<number, string>();
  const canonicalByAnilist = new Map<number, string>();
  for (const r of records) {
    byCanonical.set(r.id, r);
    const malId = toProviderId(r.crosswalk?.mal);
    if (malId !== undefined && !canonicalByMal.has(malId)) canonicalByMal.set(malId, r.id);
    const anilistId = toProviderId(r.crosswalk?.anilist);
    if (anilistId !== undefined && !canonicalByAnilist.has(anilistId)) canonicalByAnilist.set(anilistId, r.id);
  }

  // Adjacency, canonical id → canonical ids. Built undirected.
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  const linkTo = (from: string, target: string | undefined) => {
    if (target && byCanonical.has(target)) link(from, target);
  };
  for (const r of records) {
    for (const rel of r.catalog.relatedAnime || []) {
      if (!FRANCHISE_RELATIONS.has(rel.relation_type)) continue;
      linkTo(r.id, canonicalByMal.get(rel.node.id));
    }
    for (const rel of r.sources.anilist?.relations || []) {
      if (!ANILIST_FRANCHISE_RELATIONS.has(rel.relationType)) continue;
      // MAL id first — it's the key the catalog is overwhelmingly anchored on —
      // then AniList's, which is the only handle on an AniList-only target.
      const target = (rel.idMal !== undefined ? canonicalByMal.get(rel.idMal) : undefined)
        ?? (rel.id !== undefined ? canonicalByAnilist.get(rel.id) : undefined);
      linkTo(r.id, target);
    }
  }

  const seen = new Set<string>();
  const groups: AnimeRecord[][] = [];
  for (const r of records) {
    if (seen.has(r.id)) continue;
    // Iterative flood fill — a long franchise chain would blow a recursive one.
    const component: AnimeRecord[] = [];
    const stack = [r.id];
    seen.add(r.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      const rec = byCanonical.get(id);
      if (rec) component.push(rec);
      for (const next of adjacency.get(id) || []) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    groups.push(component);
  }
  return groups;
}

/**
 * The consumer (`/api/anime/quick-rate`) indexes these components by member id
 * and caches that index on the row-cache array's identity, so the narrowing
 * filters pick *seeds* and the index expands each seed to its whole franchise —
 * which is what pulls in the unstatused seasons a filter would have dropped.
 */
