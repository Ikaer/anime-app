import { NextApiRequest, NextApiResponse } from 'next';
import { computeFeed, getDismissedAnime, getRecommendationsData } from '@/lib/recommendations';
import { applyNarrowingFilters } from '@/lib/animeUtils';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { nicheMode, threshold, dismissed, mediaType, search, minScore, maxScore } = req.query;

    // Narrowing filters shared with /api/anime/animes (media type / search / mean range).
    const narrowing = {
      mediaTypes: typeof mediaType === 'string' && mediaType.trim() !== ''
        ? mediaType.split(',').map(t => t.trim()).filter(Boolean)
        : undefined,
      search: typeof search === 'string' ? search : undefined,
      minScore: typeof minScore === 'string' ? parseFloat(minScore) : null,
      maxScore: typeof maxScore === 'string' ? parseFloat(maxScore) : null,
    };

    // "Écartés" view: list of dismissed anime (no ranking, same narrowing).
    if (typeof dismissed === 'string' && dismissed.toLowerCase() === 'true') {
      const animes = applyNarrowingFilters(getDismissedAnime(), narrowing);
      return res.json({ animes, total: animes.length, dismissed: true });
    }

    const niche = typeof nicheMode === 'string' && nicheMode.toLowerCase() === 'true';
    const thr = typeof threshold === 'string' && threshold.trim() !== ''
      ? parseInt(threshold, 10)
      : null;

    const data = getRecommendationsData();
    const ranked = computeFeed({ nicheMode: niche, threshold: Number.isFinite(thr as number) ? thr : null });
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
