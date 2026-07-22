/**
 * Persistence for the recommendations cache — `cache/recommendations.json`.
 *
 * The one rebuildable file in the store (hence `cache/`): it holds the expensive
 * FETCH half of the engine (crowd edges + suggestions), so the cheap RANKING can
 * be recomputed live on every feed visit without touching MAL or AniList.
 *
 * **Stays MAL-id-keyed internally by design** — the crowd-edge math is MAL-keyed
 * unlike every other file in the store.
 *
 * Server-only (uses `fs` via `jsonStore`).
 */

import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { TUNING } from '@/lib/reco/scoring';

const RECOMMENDATIONS_FILE = dataFile('cache/recommendations.json');

export interface RecoEdge {
  /** Recommended anime id (MAL). */
  id: number;
  /** num_recommendations (crowd backers) for this edge. */
  num: number;
  /** 1 = direct reco of a seed, 2 = reco of a 1-hop candidate. */
  hop: 1 | 2;
}

export interface RecommendationsData {
  lastRefresh: string | null;
  seedThreshold: number;
  nicheMode: boolean;
  /** Keyed by seed id (string) -> edges produced within that seed's subtree. */
  seeds: Record<string, RecoEdge[]>;
  /**
   * AniList crowd recommendations, keyed by seed MAL id (string) -> edges.
   * Parallel to `seeds` but sourced from AniList's `Media.recommendations`
   * connection. `num` holds AniList's net recommendation rating. Optional for
   * backward compat: files written before this feature lack it.
   */
  anilistSeeds?: Record<string, RecoEdge[]>;
  suggestions: { id: number; rank: number }[];
}

const EMPTY_DATA: RecommendationsData = {
  lastRefresh: null,
  seedThreshold: TUNING.DEFAULT_SEED_THRESHOLD,
  nicheMode: false,
  seeds: {},
  anilistSeeds: {},
  suggestions: [],
};

export function getRecommendationsData(): RecommendationsData {
  return readJsonFile<RecommendationsData>(RECOMMENDATIONS_FILE, { ...EMPTY_DATA });
}

export function saveRecommendationsData(data: RecommendationsData): void {
  writeJsonFile(RECOMMENDATIONS_FILE, data);
}
