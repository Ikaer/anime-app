/**
 * GET /api/anime/stats — the six repartitions behind /stats.
 *
 * Aggregation happens here rather than client-side for the same reason
 * quick-rate's does: the page needs six top-50 lists, and shipping ~500
 * `AnimeRecord`s PLUS their cast entries (the bulkiest AniList payload there is)
 * to compute them in the browser would be tens of megabytes for a few kilobytes
 * of output.
 *
 * The cast slice is read separately — it is deliberately NOT part of
 * `getAnimeForDisplay()`'s join (see `AniListCastEntry`).
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getAllAnilistCast, getAnimeForDisplay } from '@/lib/store';
import { computeStats, type StatsResult } from '@/lib/domain/stats';

export interface StatsApiResponse extends StatsResult {
  /** Echoed back so the client can confirm what it asked for. */
  statuses: string[];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const statusParam = typeof req.query.status === 'string' ? req.query.status : '';
    const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean);

    const stats = computeStats(getAnimeForDisplay(), getAllAnilistCast(), { statuses });

    return res.status(200).json({ ...stats, statuses } satisfies StatsApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Stats computation error:', error);
    return res.status(500).json({ error: message });
  }
}
