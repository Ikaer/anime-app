/**
 * The tier board's axes, and the score-vs-community "gap" the `gap` axis is built on.
 *
 * Lifted out of `pages/tier.tsx` when the MCP `tier_list` tool needed the same
 * arithmetic. The page keeps its optimistic-override plumbing and its colours;
 * what lives here is the part that must not drift between the two — which
 * provider mean is read, and how a gap is derived from it.
 *
 * Pure and client-safe (no `fs`): records are passed in, same convention as
 * `globalSearch.ts` / `stats.ts` / `genreVocabulary.ts`.
 */
import { extractCatalogBySource } from '@/lib/domain/animeUtils';
import type { AnimeRecord } from '@/models/anime';

/** Scores 10→1. Titles with no value on the active axis fall to the tray. */
export const TIER_SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/**
 * Gap rows are clamped to ±5 because beyond that they are empty on any real
 * list; the two end rows read "or more" / "or less" rather than pretending the
 * clamp is the value. The RAW gap is not clamped — only the row it lands in.
 */
export const GAP_MAX = 5;
export const GAP_ROWS = [5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5];

/**
 * The four statuses the board scopes to. `plan_to_watch` is excluded: you cannot
 * rate what you have not seen, so it would be a row of blanks.
 */
export const TIER_STATUSES = ['watching', 'completed', 'on_hold', 'dropped'] as const;


/**
 * What the tier board's rows mean. `me` is the owner's own score (the only
 * writable axis); `mal` / `anilist` re-bucket the same cards on that provider's
 * community mean; `gap` makes the rows the difference itself.
 */
export type TierAxis = 'me' | 'mal' | 'anilist' | 'gap';

/** The two providers that publish a community mean this app can compare against. */
export type GapProvider = 'mal' | 'anilist';

export interface ProviderMeans {
  mal: number | null;
  anilist: number | null;
}

/**
 * Each provider's OWN community mean, raw rather than merged.
 *
 * ⚠️ **Not `catalog.mean`.** That is the precedence winner — one number,
 * whichever provider won the field — so comparing a score against it would
 * compare a title to itself whenever that provider won. `extractCatalogBySource`
 * rebuilds the per-provider values. Both are already on MAL's 1-10 scale
 * (AniList's `averageScore` is divided by 10 at hydration).
 */
export function providerMeans(anime: AnimeRecord): ProviderMeans {
  const bySource = extractCatalogBySource(anime.sources);
  return { mal: bySource.mal?.mean ?? null, anilist: bySource.anilist?.mean ?? null };
}

/**
 * My score minus the provider's ROUNDED mean; `null` when either side is missing.
 *
 * Rounding the mean is what makes the difference an integer on the same 1-10
 * scale as the score, which is what lets a gap be a row. A score of 0 means
 * unrated, not zero, so it yields no gap.
 */
export function gapOf(myScore: number | undefined, mean: number | null): number | null {
  if (myScore == null || myScore <= 0) return null;
  if (mean == null) return null;
  return myScore - Math.round(mean);
}

/** Which gap row a difference lands in — the clamp, applied to the row only. */
export function clampGapRow(gap: number): number {
  return Math.max(-GAP_MAX, Math.min(GAP_MAX, gap));
}

/** Which score row a community mean lands in, 1-10. */
export function meanRow(mean: number): number {
  return Math.max(1, Math.min(10, Math.round(mean)));
}
