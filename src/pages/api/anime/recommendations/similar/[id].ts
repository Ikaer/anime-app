import { NextApiRequest, NextApiResponse } from 'next';
import { SIMILAR_LIMIT } from '@/lib/reco/similar';
import { loadSimilarTo } from '@/lib/reco/similarFetch';

/**
 * "Plus comme ça" — crowd recommendations anchored on ONE anime, ranked with the
 * same weighted-source model as the "Pour toi" feed. Backs the detail page block.
 *
 * A thin seam: the fetch, the canonical-id conversion and the ranking all live
 * in `reco/similarFetch.ts`, shared with the MCP `similar_to` tool. What is left
 * here is the HTTP status mapping, which is the only web-specific part.
 */
export type { SimilarSourceOutcome } from '@/lib/reco/similarFetch';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const canonicalId = typeof req.query.id === 'string' ? req.query.id : '';
  const limitRaw = parseInt(String(req.query.limit), 10);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? limitRaw : SIMILAR_LIMIT;
  const lang = req.query.lang === 'en' ? 'en' : 'fr';

  try {
    const result = await loadSimilarTo(canonicalId, limit, lang);
    if (result.ok) {
      return res.json({ items: result.items, sources: result.sources });
    }
    switch (result.failure.kind) {
      case 'invalid_id':
        return res.status(400).json({ error: 'Invalid anime id' });
      case 'no_provider_id':
        return res.status(404).json({ error: 'No MAL or AniList id known for this title' });
      case 'all_sources_failed':
        return res.status(502).json({
          error: 'Both recommendation sources failed',
          sources: result.failure.sources,
        });
    }
  } catch (error) {
    console.error(`Similar-to ${canonicalId} error:`, error);
    res.status(500).json({
      error: 'Failed to compute similar anime',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
