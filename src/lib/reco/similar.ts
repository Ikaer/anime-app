/**
 * "Plus comme ça" — the single-target drill-down behind the detail page block.
 *
 * A thin PROJECTION over `anchored.ts` with exactly one anchor: the ranking
 * model, the exclusions and the explain strings all live there now (the "/mix"
 * page is the same engine with N anchors). What stays here is the lean card
 * shape this block actually renders, and the one behavioural choice that is
 * specific to it — seen titles are NOT excluded, because the pool is at most
 * ~25 edges and a heavy watcher would see the block gutted. They come back with
 * their effective `status` so the UI can mark them "déjà vu".
 *
 * Server-only (via `anchored.ts`), and stateless: it never touches the stored
 * `RecommendationsData`.
 */

import { computeAnchored, type AnchoredEdge } from '@/lib/reco/anchored';
import type { RecoContribution } from '@/models/anime';
import type { RecoEdge } from '@/lib/reco/data';
import { getPrimaryTitle } from '@/lib/domain/animeUtils';
import { DEFAULT_LANG, type Lang } from '@/lib/i18n';

/** Default number of similar titles returned. */
export const SIMILAR_LIMIT = 12;

/**
 * One AniList crowd edge, already converted onto a canonical id by the caller
 * (E9) — the route is the ingest boundary, so nothing in here speaks a provider
 * id space.
 */
export interface AniListEdgeInput {
  /** Canonical id of the recommended title. */
  id: string;
  rating: number;
}

/**
 * Lean card shape for the drill-down — deliberately NOT `AnimeRecord` +
 * `RecoMeta`: `topSeeds` / `fromSuggestions` are meaningless with a single
 * anchor, and the detail page only needs enough to render a poster card. (The
 * "/mix" page, whose anchors ARE plural, projects the same ranking into full
 * records instead.)
 */
export interface SimilarItem {
  /** Canonical id — the detail-page route key. */
  id: string;
  title: string;
  poster?: string;
  mean?: number;
  mediaType?: string;
  year?: number;
  /** Effective (SIMKL-first) personal status, when the user already listed it. */
  status?: string;
  /** True when that status means the title has already been watched. */
  seen: boolean;
  /** Σ weight · normalizedSourceValue, same additive model as the feed. */
  score: number;
  breakdown: RecoContribution[];
}

/**
 * Rank the crowd recommendations of ONE anime. Pure read + math over edges the
 * caller fetched — no MAL/AniList calls, no writes.
 */
export function computeSimilarTo(
  targetId: string,
  malEdges: RecoEdge[],
  anilistEdges: AniListEdgeInput[],
  limit: number = SIMILAR_LIMIT,
  lang: Lang = DEFAULT_LANG
): SimilarItem[] {
  // One anchor, so every edge is attributed to the target. `hop` is irrelevant
  // here: a single-title fetch only ever returns 1-hop edges.
  const mal: AnchoredEdge[] = malEdges.map(e => ({ anchorId: targetId, id: e.id, num: e.num }));
  const anilist: AnchoredEdge[] = anilistEdges.map(e => ({ anchorId: targetId, id: e.id, num: e.rating }));

  return computeAnchored([targetId], mal, anilist, { lang })
    .slice(0, limit)
    .map(({ anime, score, breakdown, status, seen }) => ({
      id: anime.id,
      title: getPrimaryTitle(anime),
      poster: anime.catalog.mainPicture?.medium || anime.catalog.mainPicture?.large,
      mean: anime.catalog.mean,
      mediaType: anime.catalog.mediaType,
      year: anime.catalog.startSeason?.year,
      status,
      seen,
      score,
      breakdown,
    }));
}
