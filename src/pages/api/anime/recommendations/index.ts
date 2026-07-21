import { NextApiRequest, NextApiResponse } from 'next';
import { computeFeed, getFeedbackAnime, getRecommendationsData } from '@/lib/reco/engine';
import { applyNarrowingFilters } from '@/lib/animeUtils';
import { parseSourceWeights } from '@/lib/reco/weights';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { nicheMode, threshold, review, mediaType, search, minScore, maxScore, minYear, maxYear } = req.query;

    // Narrowing filters shared with /api/anime/animes (media type / search / mean range / year range).
    const narrowing = {
      mediaTypes: typeof mediaType === 'string' && mediaType.trim() !== ''
        ? mediaType.split(',').map(t => t.trim()).filter(Boolean)
        : undefined,
      search: typeof search === 'string' ? search : undefined,
      minScore: typeof minScore === 'string' ? parseFloat(minScore) : null,
      maxScore: typeof maxScore === 'string' ? parseFloat(maxScore) : null,
      minYear: typeof minYear === 'string' ? parseInt(minYear, 10) : null,
      maxYear: typeof maxYear === 'string' ? parseInt(maxYear, 10) : null,
    };

    // Review lists: "Bonnes pioches" (👍) / "Pas pour moi" (👎) — no ranking, same narrowing.
    if (review === 'up' || review === 'down') {
      const animes = applyNarrowingFilters(getFeedbackAnime(review), narrowing);
      return res.json({ animes, total: animes.length, review });
    }

    const niche = typeof nicheMode === 'string' && nicheMode.toLowerCase() === 'true';
    const thr = typeof threshold === 'string' && threshold.trim() !== ''
      ? parseInt(threshold, 10)
      : null;
    const weights = parseSourceWeights(typeof req.query.w === 'string' ? req.query.w : undefined);
    const divRaw = typeof req.query.diversity === 'string' ? parseFloat(req.query.diversity) : NaN;
    const diversity = Number.isFinite(divRaw) ? divRaw : null;
    const lang = req.query.lang === 'en' ? 'en' : 'fr';

    const data = getRecommendationsData();
    const ranked = computeFeed({
      nicheMode: niche,
      threshold: Number.isFinite(thr as number) ? thr : null,
      weights,
      diversity,
      lang,
    });
    const animes = applyNarrowingFilters(ranked, narrowing);

    res.json({
      animes,
      total: animes.length,
      lastRefresh: data.lastRefresh,
      seedThreshold: data.seedThreshold,
      nicheMode: niche,
    });
  } catch (error) {
    console.error('Get recommendations feed error:', error);
    res.status(500).json({
      error: 'Failed to get recommendations',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
