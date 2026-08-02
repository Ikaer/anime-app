/**
 * Franchise grouping — connected components over the MAL relation graph
 *
 * Pure and client-safe (no `fs`), though today only server-side handlers use it
 * (`/api/anime/quick-rate`, `/api/anime/catch-up`): grouping runs there because
 * the input is the whole catalog (~25k records) and only the grouped, lean
 * projection crosses the wire.
 */
import type { AnimeRecord } from '@/models/anime';
import { buildRelationIndex, resolveRelations } from '@/lib/domain/relations';

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
 *
 * **One vocabulary, both providers.** `resolveRelations` normalizes AniList's
 * names into MAL's before this set is consulted, so `PARENT` arrives as
 * `parent_story` (a franchise edge) and `ALTERNATIVE` as `alternative_version`
 * (deliberately not one — it links the 2003 and 2009 Fullmetal Alchemist, which
 * are separate watch orders you may well rate differently).
 */
export const FRANCHISE_RELATIONS = new Set([
  'sequel',
  'prequel',
  'side_story',
  'parent_story',
  'full_story',
]);

/**
 * Group records into franchises: each returned array is one connected component
 * of the relation graph, in the input's order. A record with no in-catalog
 * relations comes back as its own single-member group.
 *
 * Edge resolution — both providers' payloads, one vocabulary, targets returned
 * as records — is `domain/relations.ts`'s job; this walks what it returns. An
 * edge pointing at a title the catalog doesn't have is dropped there.
 */
export function groupIntoFranchises(records: AnimeRecord[]): AnimeRecord[][] {
  const index = buildRelationIndex(records);
  const byCanonical = index.byCanonical;

  // Adjacency, canonical id → canonical ids. Built undirected.
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const r of records) {
    for (const rel of resolveRelations(r, index)) {
      if (!FRANCHISE_RELATIONS.has(rel.relationType)) continue;
      link(r.id, rel.record.id);
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
 * Grouping is O(catalog) and the catalog is ~25k rows, so both consumers index
 * the components by member id and cache that index on the identity of the row
 * array `getAnimeForDisplay()` returned — that array is stable until a slice
 * file's mtime actually changes, so this rebuilds exactly when the data does
 * (the same trick the row cache itself uses).
 *
 * It lives here rather than in either handler because `/api/anime/quick-rate`
 * and `/api/anime/catch-up` want the identical index; note that in a production
 * build each route bundle still holds its own copy of this module state, which
 * is fine — the identity check is per-bundle and self-correcting.
 *
 * What each consumer does with it differs: quick-rate lets the narrowing filters
 * pick *seeds* and expands each to its whole franchise (pulling in the unstatused
 * seasons a filter would have dropped); catch-up asks each component whether it
 * holds both a completed entry and an untouched one.
 */
let indexedCatalog: AnimeRecord[] | null = null;
let franchiseOf: Map<string, AnimeRecord[]> = new Map();

export function getFranchiseIndex(catalog: AnimeRecord[]): Map<string, AnimeRecord[]> {
  if (indexedCatalog === catalog) return franchiseOf;
  const next = new Map<string, AnimeRecord[]>();
  for (const group of groupIntoFranchises(catalog)) {
    for (const member of group) next.set(member.id, group);
  }
  indexedCatalog = catalog;
  franchiseOf = next;
  return next;
}
