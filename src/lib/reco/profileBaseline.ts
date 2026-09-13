/**
 * The profile page's framing: a preview is ALWAYS read against the same pool
 * under `Défaut` (docs/recoProfiles/DESIGN.md §7, PLAN.md phase 6).
 *
 * ⚠️ **Why the page never shows a preview on its own.** An untouched weighting
 * on the `catalog` pool is a plain `BOX_WEIGHTS` rank of the unseen catalog — a
 * fourth recommendation surface, with a verdict of its own, which is exactly
 * what §7 refuses beside `affinity.ts`' « Recommandé » mark. What the page
 * shows is what a weighting CHANGES: each row against where it stood under
 * `Défaut`, and a weighting that changes nothing gets a sentence, not a list.
 *
 * Pure and client-safe; the page is its only caller.
 */

import { resolveProfile, type ProfileWeights } from '@/lib/reco/profileWeights';

/**
 * True when `weights` ranks exactly like `base` on this pool: every field the
 * pool reads resolves to its base value and no craft family is on.
 *
 * Resolved, not compared key by key, and that is the point: a profile holding
 * only `crowd: 1.4` tunes the recos tab and does NOTHING on the metadata pools,
 * whose base has no `crowd` key — so there it is "nothing", however many keys
 * it stores. A key set to exactly its base value is likewise nothing.
 */
export function tunesNothing(base: Record<string, number>, weights: ProfileWeights): boolean {
  const resolved = resolveProfile(base, weights);
  return Object.values(resolved.families).every(v => v === 0)
    && Object.keys(base).every(k => resolved.weights[k] === base[k]);
}

/** Where a row stands against the `Défaut` ranking of the same pool. */
export type RankShift =
  | { kind: 'new' }
  | { kind: 'same' }
  | { kind: 'up' | 'down'; by: number };

/**
 * Each row's shift against the baseline list, matched on ANY shared entry id.
 *
 * ⚠️ Not face to face. A franchise group is faced by its best-SCORING member
 * (`BoxCandidateGroup.id`), so re-weighting can re-face it — the same group,
 * found again under another of its entries. Comparing `row.id` with `row.id`
 * would call it `new` and over-count what the weighting changed. (Either side
 * carrying every id is enough — both lists group by the same direct-franchise
 * components — so the baseline indexes all of them.) Pinned.
 */
export function shiftsAgainst(rows: { ids: string[] }[], baseline: { ids: string[] }[]): RankShift[] {
  const rankOf = new Map<string, number>();
  baseline.forEach((row, rank) => {
    for (const id of row.ids) if (!rankOf.has(id)) rankOf.set(id, rank);
  });
  return rows.map((row, rank): RankShift => {
    const before = row.ids.map(id => rankOf.get(id)).find((r): r is number => r !== undefined);
    if (before === undefined) return { kind: 'new' };
    if (before === rank) return { kind: 'same' };
    return before > rank ? { kind: 'up', by: before - rank } : { kind: 'down', by: rank - before };
  });
}
