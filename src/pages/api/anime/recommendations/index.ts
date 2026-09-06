import { NextApiRequest, NextApiResponse } from 'next';
import { computeFeed } from '@/lib/reco/feed';
import { getFeedbackAnime } from '@/lib/reco/feedback';
import { getRecommendationsData } from '@/lib/reco/data';
import { getMutedSeedAnime } from '@/lib/reco/seedMutes';
import { applyNarrowingFilters, getPrimaryTitle } from '@/lib/domain/animeUtils';
import { parseSourceWeights } from '@/lib/reco/weights';
import { getTitleLanguage } from '@/lib/config/settings';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { nicheMode, threshold, review, mediaType, search, minScore, maxScore, minYear, maxYear, genres } = req.query;

    // Narrowing filters shared with /api/anime/animes (media type / search / mean range / year range / genres).
    const narrowing = {
      mediaTypes: typeof mediaType === 'string' && mediaType.trim() !== ''
        ? mediaType.split(',').map(t => t.trim()).filter(Boolean)
        : undefined,
      search: typeof search === 'string' ? search : undefined,
      minScore: typeof minScore === 'string' ? parseFloat(minScore) : null,
      maxScore: typeof maxScore === 'string' ? parseFloat(maxScore) : null,
      minYear: typeof minYear === 'string' ? parseInt(minYear, 10) : null,
      maxYear: typeof maxYear === 'string' ? parseInt(maxYear, 10) : null,
      genres: typeof genres === 'string' && genres.trim() !== ''
        ? genres.split(',').map(g => g.trim()).filter(Boolean)
        : undefined,
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
    const titleLang = getTitleLanguage();
    const ranked = computeFeed({
      nicheMode: niche,
      threshold: Number.isFinite(thr as number) ? thr : null,
      weights,
      diversity,
      lang,
      titleLang,
    });
    const animes = applyNarrowingFilters(ranked, narrowing);

    res.json({
      animes,
      total: animes.length,
      lastRefresh: data.lastRefresh,
      seedThreshold: data.seedThreshold,
      nicheMode: niche,
      /**
       * The muted seeds' review-and-undo list, resolved to titles here rather
       * than behind its own endpoint: the page already makes this request on
       * every knob change, and a mute changes the feed, so the two can never be
       * fetched independently without going out of step. The ACTIVE seeds need
       * no such payload — the sidebar counts them off each card's `topSeeds`.
       */
      mutedSeeds: getMutedSeedAnime()
        .map(a => ({ id: a.id, title: getPrimaryTitle(a, titleLang) }))
        .sort((x, y) => x.title.localeCompare(y.title)),
    });
  } catch (error) {
    console.error('Get recommendations feed error:', error);
    res.status(500).json({
      error: 'Failed to get recommendations',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
