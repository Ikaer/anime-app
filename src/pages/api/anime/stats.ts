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
  /** Echoed back likewise — the owner's own score bounds, absent when unbounded. */
  minMyScore?: number;
  maxMyScore?: number;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const statusParam = typeof req.query.status === 'string' ? req.query.status : '';
    const statuses = statusParam.split(',').map(s => s.trim()).filter(Boolean);

    // `minScore`/`maxScore` in the REST API mean the COMMUNITY mean everywhere
    // else, so this page's params are named for whose score they actually are.
    // An unparseable bound is dropped rather than 400'd: it can only come from a
    // hand-edited URL, and the honest answer there is the unfiltered ranking.
    const bound = (value: unknown): number | undefined => {
      if (typeof value !== 'string' || value.trim() === '') return undefined;
      const n = Number(value);
      return Number.isFinite(n) && n >= 1 && n <= 10 ? n : undefined;
    };
    const minMyScore = bound(req.query.minMyScore);
    const maxMyScore = bound(req.query.maxMyScore);

    const stats = computeStats(getAnimeForDisplay(), getAllAnilistCast(), {
      statuses, minMyScore, maxMyScore,
    });

    return res.status(200).json({
      ...stats,
      statuses,
      ...(minMyScore != null ? { minMyScore } : {}),
      ...(maxMyScore != null ? { maxMyScore } : {}),
    } satisfies StatsApiResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Stats computation error:', error);
    return res.status(500).json({ error: message });
  }
}
