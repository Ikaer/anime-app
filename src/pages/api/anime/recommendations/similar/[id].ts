import { NextApiRequest, NextApiResponse } from 'next';
import { getValidMalToken } from '@/lib/providers/mal/client';
import { getMalIdForCanonical, isCanonicalId, buildCrosswalkIndexes, getAllAnilistMeta, getRegistry, toNum } from '@/lib/store';
import { computeSimilarTo, SIMILAR_LIMIT, type AniListEdgeInput } from '@/lib/reco/similar';
import { fetchRecoEdges, type RawEdge } from '@/lib/reco/refresh';
import type { RecoEdge } from '@/lib/reco/data';
import { fetchAnilistRecommendations, type AniListRecEdge } from '@/lib/providers/anilist/sync';

/**
 * "Plus comme ça" — crowd recommendations anchored on ONE anime, ranked with the
 * same weighted-source model as the "Pour toi" feed. Backs the detail page block.
 *
 * Both crowd sources are fetched in parallel and each is non-fatal: MAL is the
 * anchor (needs auth), AniList roughly doubles the pool and needs none. A dead
 * source just contributes no edges — the response carries a per-source outcome
 * so the UI can say which pipe was silent.
 *
 * **This route is the ingest boundary** (E9): each provider is asked with its
 * own id, and the edges it answers with are converted to canonical ids here, so
 * `computeSimilarTo` never sees a provider id space. Conversion is resolve-only
 * — an edge naming a title the store doesn't know is dropped, which costs
 * nothing because the ranker drops unhydrated candidates anyway (this block
 * deliberately fetches nothing to hydrate).
 *
 * Stateless: nothing is persisted, and the stored `RecommendationsData` is not
 * read or written.
 */

export interface SimilarSourceOutcome {
  ok: boolean;
  error?: string;
}

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

async function loadAnilistEdges(anilistId: number | undefined): Promise<{ edges: AniListRecEdge[]; outcome: SimilarSourceOutcome }> {
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const canonicalId = typeof req.query.id === 'string' ? req.query.id : '';
  if (!isCanonicalId(canonicalId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }
  const limitRaw = parseInt(String(req.query.limit), 10);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : SIMILAR_LIMIT;
  const lang = req.query.lang === 'en' ? 'en' : 'fr';

  // Each provider is asked with ITS OWN id, both taken from the crosswalk.
  // Either may be absent; only having neither leaves nothing to ask.
  const malId = getMalIdForCanonical(canonicalId);
  const anilistId = getAllAnilistMeta()[canonicalId]?.anilist_id ?? toNum(getRegistry()[canonicalId]?.anilist);
  if (malId === undefined && anilistId === undefined) {
    return res.status(404).json({ error: 'No MAL or AniList id known for this title' });
  }

  try {
    const [mal, anilist] = await Promise.all([
      malId !== undefined
        ? loadMalEdges(malId)
        : Promise.resolve({ edges: [] as RawEdge[], outcome: { ok: false, error: 'No MAL id known for this title' } }),
      loadAnilistEdges(anilistId),
    ]);

    // Both pipes dry AND both failed — that's an error, not an empty result.
    if (!mal.outcome.ok && !anilist.outcome.ok) {
      return res.status(502).json({
        error: 'Both recommendation sources failed',
        sources: { mal: mal.outcome, anilist: anilist.outcome },
      });
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

    const items = computeSimilarTo(canonicalId, malEdges, anilistEdges, limit, lang);
    res.json({ items, sources: { mal: mal.outcome, anilist: anilist.outcome } });
  } catch (error) {
    console.error(`Similar-to ${canonicalId} error:`, error);
    res.status(500).json({
      error: 'Failed to compute similar anime',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
