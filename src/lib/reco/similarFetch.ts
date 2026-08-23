/**
 * "Plus comme ça" — fetch one anime's crowd edges from MAL + AniList, convert
 * them onto canonical ids, and rank them with `computeSimilarTo`.
 *
 * Lifted out of `api/anime/recommendations/similar/[id].ts` when the MCP
 * `similar_to` tool needed the same orchestration. The route keeps its HTTP
 * status mapping; everything above it lives here, so the two callers cannot
 * drift on which sources are asked or how edges are resolved.
 *
 * **This module is the ingest boundary** (E9): each provider is asked with its
 * OWN id, and the edges it answers with are converted to canonical ids here, so
 * `computeSimilarTo` never sees a provider id space. Conversion is resolve-only
 * — an edge naming a title the store doesn't know is dropped, which costs
 * nothing because the ranker drops unhydrated candidates anyway.
 *
 * **It reaches the network**, unlike every other read in the reco stack, and it
 * is the one MCP tool that does. Stateless otherwise: nothing is persisted, and
 * the stored `RecommendationsData` is neither read nor written.
 */
import { getValidMalToken } from '@/lib/providers/mal/client';
import {
  buildCrosswalkIndexes,
  getAllAnilistMeta,
  getMalIdForCanonical,
  getRegistry,
  isCanonicalId,
  toNum,
} from '@/lib/store';
import { computeSimilarTo, SIMILAR_LIMIT, type AniListEdgeInput, type SimilarItem } from '@/lib/reco/similar';
import { fetchRecoEdges, type RawEdge } from '@/lib/reco/refresh';
import type { RecoEdge } from '@/lib/reco/data';
import { fetchAnilistRecommendations, type AniListRecEdge } from '@/lib/providers/anilist/sync';
import { DEFAULT_LANG, type Lang } from '@/lib/i18n';

export interface SimilarSourceOutcome {
  ok: boolean;
  error?: string;
}

export interface SimilarSources {
  mal: SimilarSourceOutcome;
  anilist: SimilarSourceOutcome;
}

/** Why a request produced nothing — mapped to an HTTP status by the route. */
export type SimilarFailure =
  | { kind: 'invalid_id' }
  | { kind: 'no_provider_id' }
  | { kind: 'all_sources_failed'; sources: SimilarSources };

export type SimilarResult =
  | { ok: true; items: SimilarItem[]; sources: SimilarSources }
  | { ok: false; failure: SimilarFailure };

async function loadMalEdges(malId: number): Promise<{ edges: RawEdge[]; outcome: SimilarSourceOutcome }> {
  const token = getValidMalToken();
  if (!token) {
    return { edges: [], outcome: { ok: false, error: 'Not authenticated with MAL' } };
  }
  try {
    return { edges: await fetchRecoEdges(malId, token.access_token), outcome: { ok: true } };
  } catch (error) {
    return { edges: [], outcome: { ok: false, error: error instanceof Error ? error.message : 'Unknown error' } };
  }
}

async function loadAnilistEdges(
  anilistId: number | undefined
): Promise<{ edges: AniListRecEdge[]; outcome: SimilarSourceOutcome }> {
  if (anilistId === undefined) {
    return { edges: [], outcome: { ok: false, error: 'No AniList id known for this title' } };
  }
  try {
    const recs = await fetchAnilistRecommendations([anilistId]);
    return { edges: recs.get(anilistId) || [], outcome: { ok: true } };
  } catch (error) {
    return { edges: [], outcome: { ok: false, error: error instanceof Error ? error.message : 'Unknown error' } };
  }
}

/**
 * Both crowd sources are fetched in parallel and each is non-fatal: MAL is the
 * anchor (needs auth), AniList roughly doubles the pool and needs none. A dead
 * source just contributes no edges, and the caller is told which pipe was
 * silent. Both dry AND both failed is an error, not an empty result.
 */
export async function loadSimilarTo(
  canonicalId: string,
  limit: number = SIMILAR_LIMIT,
  lang: Lang = DEFAULT_LANG
): Promise<SimilarResult> {
  if (!isCanonicalId(canonicalId)) return { ok: false, failure: { kind: 'invalid_id' } };

  // Each provider is asked with ITS OWN id, both taken from the crosswalk.
  // Either may be absent; only having neither leaves nothing to ask.
  const malId = getMalIdForCanonical(canonicalId);
  const anilistId = getAllAnilistMeta()[canonicalId]?.anilist_id ?? toNum(getRegistry()[canonicalId]?.anilist);
  if (malId === undefined && anilistId === undefined) {
    return { ok: false, failure: { kind: 'no_provider_id' } };
  }

  const [mal, anilist] = await Promise.all([
    malId !== undefined
      ? loadMalEdges(malId)
      : Promise.resolve({ edges: [] as RawEdge[], outcome: { ok: false, error: 'No MAL id known for this title' } }),
    loadAnilistEdges(anilistId),
  ]);

  const sources: SimilarSources = { mal: mal.outcome, anilist: anilist.outcome };
  if (!mal.outcome.ok && !anilist.outcome.ok) {
    return { ok: false, failure: { kind: 'all_sources_failed', sources } };
  }

  // Convert both edge sets onto canonical ids before ranking — one registry
  // read shared by both. An AniList edge resolves through its AniList id first
  // and its MAL id second, so an AniList-only title still lands (E11).
  const { byMal, byAnilist } = buildCrosswalkIndexes();
  const malEdges: RecoEdge[] = mal.edges
    .map(e => ({ id: e.malId !== undefined ? byMal.get(e.malId) : undefined, num: e.num, hop: e.hop }))
    .filter((e): e is RecoEdge => e.id !== undefined);
  const anilistEdges: AniListEdgeInput[] = anilist.edges
    .map(e => ({
      id: byAnilist.get(e.anilistId) ?? (e.malId !== undefined ? byMal.get(e.malId) : undefined),
      rating: e.rating,
    }))
    .filter((e): e is AniListEdgeInput => e.id !== undefined);

  return { ok: true, items: computeSimilarTo(canonicalId, malEdges, anilistEdges, limit, lang), sources };
}
