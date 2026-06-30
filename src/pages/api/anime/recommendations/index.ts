import { NextApiRequest, NextApiResponse } from 'next';
import { computeFeed, getDismissedAnime, getRecommendationsData } from '@/lib/recommendations';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { nicheMode, threshold, dismissed } = req.query;

    // "Écartés" view: list of dismissed anime (no ranking).
    if (typeof dismissed === 'string' && dismissed.toLowerCase() === 'true') {
      const animes = getDismissedAnime();
      return res.json({ animes, total: animes.length, dismissed: true });
    }

    const niche = typeof nicheMode === 'string' && nicheMode.toLowerCase() === 'true';
    const thr = typeof threshold === 'string' && threshold.trim() !== ''
      ? parseInt(threshold, 10)
      : null;

    const data = getRecommendationsData();
    const animes = computeFeed({ nicheMode: niche, threshold: Number.isFinite(thr as number) ? thr : null });

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
