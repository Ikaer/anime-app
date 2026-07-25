/**
 * Persistence for the recommendations cache — `cache/recommendations.json`.
 *
 * The one rebuildable file in the store (hence `cache/`): it holds the expensive
 * FETCH half of the engine (crowd edges + suggestions), so the cheap RANKING can
 * be recomputed live on every feed visit without touching MAL or AniList.
 *
 * **Canonical-id-keyed, like every other file in the store** (E10). It was the
 * one MAL-keyed exception until `refresh.ts` started converting provider ids to
 * canonical at ingest; the ids in here are `a_<n>`, and `RecoEdge.id` is a
 * canonical id rather than a MAL one.
 *
 * Server-only (uses `fs` via `jsonStore`).
 */

import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { TUNING } from '@/lib/reco/scoring';

const RECOMMENDATIONS_FILE = dataFile('cache/recommendations.json');

/**
 * Key-space version. Bumped to 1 when the file went canonical (E10): a v0 file
 * holds MAL ids under the same field names, which would not fail to parse — it
 * would rank every edge against a canonical-keyed map, miss every lookup and
 * render an empty feed with no error anywhere. A stale file is therefore
 * DISCARDED on read rather than migrated: this is `cache/`, and the next refresh
 * rebuilds it in full.
 */
export const RECO_CACHE_VERSION = 1;

export interface RecoEdge {
  /** Recommended anime's CANONICAL id (`a_<n>`), converted at ingest. */
  id: string;
  /** num_recommendations (crowd backers) for this edge. */
  num: number;
  /** 1 = direct reco of a seed, 2 = reco of a 1-hop candidate. */
  hop: 1 | 2;
}

export interface RecommendationsData {
  /** Key-space version — see `RECO_CACHE_VERSION`. Absent means the MAL-keyed v0. */
  v?: number;
  lastRefresh: string | null;
  seedThreshold: number;
  nicheMode: boolean;
  /** Keyed by seed canonical id -> edges produced within that seed's subtree. */
  seeds: Record<string, RecoEdge[]>;
  /**
   * AniList crowd recommendations, keyed by seed canonical id -> edges.
   * Parallel to `seeds` but sourced from AniList's `Media.recommendations`
   * connection. `num` holds AniList's net recommendation rating. Optional for
   * backward compat: files written before this feature lack it.
   */
  anilistSeeds?: Record<string, RecoEdge[]>;
  suggestions: { id: string; rank: number }[];
}

const EMPTY_DATA: RecommendationsData = {
  v: RECO_CACHE_VERSION,
  lastRefresh: null,
  seedThreshold: TUNING.DEFAULT_SEED_THRESHOLD,
  nicheMode: false,
  seeds: {},
  anilistSeeds: {},
  suggestions: [],
};

export function getRecommendationsData(): RecommendationsData {
  const data = readJsonFile<RecommendationsData>(RECOMMENDATIONS_FILE, { ...EMPTY_DATA });
  // A version mismatch means the ids inside are in a key space this build no
  // longer speaks. Returning empty makes the feed say "refresh me", which is
  // honest; ranking the old ids would silently produce nothing.
  if (data.v !== RECO_CACHE_VERSION) {
    return { ...EMPTY_DATA, seedThreshold: data.seedThreshold ?? EMPTY_DATA.seedThreshold, nicheMode: !!data.nicheMode };
  }
  return data;
}

export function saveRecommendationsData(data: RecommendationsData): void {
  writeJsonFile(RECOMMENDATIONS_FILE, { ...data, v: RECO_CACHE_VERSION });
}
