import { NextApiRequest, NextApiResponse } from 'next';
import { getValidMalToken } from '@/lib/mal';
import { getMalIdForCanonical, isCanonicalId } from '@/lib/store';
import { computeSimilarTo, fetchRecoEdges, SIMILAR_LIMIT, type AniListEdgeInput, type RecoEdge } from '@/lib/recommendations';
import { fetchAnilistRecommendations } from '@/lib/anilistSync';

/**
 * "Plus comme ça" — crowd recommendations anchored on ONE anime, ranked with the
 * same weighted-source model as the "Pour toi" feed. Backs the detail page block.
 *
 * Both crowd sources are fetched in parallel and each is non-fatal: MAL is the
 * anchor (needs auth), AniList roughly doubles the pool and needs none. A dead
 * source just contributes no edges — the response carries a per-source outcome
 * so the UI can say which pipe was silent.
 *
 * Stateless: nothing is persisted, and the stored `RecommendationsData` is not
 * read or written.
 */

export interface SimilarSourceOutcome {
  ok: boolean;
  error?: string;
}

async function loadMalEdges(animeId: number): Promise<{ edges: RecoEdge[]; outcome: SimilarSourceOutcome }> {
  const token = getValidMalToken();
  if (!token) {
    return { edges: [], outcome: { ok: false, error: 'Not authenticated with MAL' } };
  }
  try {
    return { edges: await fetchRecoEdges(animeId, token.access_token), outcome: { ok: true } };
  } catch (error) {
    return { edges: [], outcome: { ok: false, error: error instanceof Error ? error.message : 'Unknown error' } };
  }
}

async function loadAnilistEdges(animeId: number): Promise<{ edges: AniListEdgeInput[]; outcome: SimilarSourceOutcome }> {
  try {
    const recs = await fetchAnilistRecommendations([animeId]);
    return { edges: recs.get(animeId) || [], outcome: { ok: true } };
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

  // The crowd math (MAL + AniList) is anchored on the real MAL id.
  const malId = getMalIdForCanonical(canonicalId);
  if (malId === undefined) {
    return res.status(404).json({ error: 'No MAL id known for this title' });
  }

  try {
    const [mal, anilist] = await Promise.all([loadMalEdges(malId), loadAnilistEdges(malId)]);

    // Both pipes dry AND both failed — that's an error, not an empty result.
    if (!mal.outcome.ok && !anilist.outcome.ok) {
      return res.status(502).json({
        error: 'Both recommendation sources failed',
        sources: { mal: mal.outcome, anilist: anilist.outcome },
      });
    }

    const items = computeSimilarTo(malId, mal.edges, anilist.edges, limit, lang);
    res.json({ items, sources: { mal: mal.outcome, anilist: anilist.outcome } });
  } catch (error) {
    console.error(`Similar-to ${canonicalId} error:`, error);
    res.status(500).json({
      error: 'Failed to compute similar anime',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
