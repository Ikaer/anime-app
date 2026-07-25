import { NextApiRequest, NextApiResponse } from 'next';
import {
  performAnilistCatalogCrawl,
  performAnilistBulkCatalogCrawl,
  performAnilistHistoricalCrawl,
  getAnilistCatalogCrawlStats,
  getAnilistHistoricalCrawlStats,
} from '@/lib/providers/anilist/sync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ...getAnilistCatalogCrawlStats(), historical: getAnilistHistoricalCrawlStats() });
  }

  if (req.method === 'POST') {
    // Fire-and-forget, mirroring meta-sync: pages take multiple seconds each
    // under AniList's throttle. Progress surfaces via appendLog(...), polled
    // client-side by the connection log panel (and, for `scope: 'bulk'`, by
    // the first-run onboarding panel's progress bar).
    if (req.body?.scope === 'bulk') {
      performAnilistBulkCatalogCrawl();
      return res.status(200).json({ message: 'AniList bulk catalog crawl started' });
    }
    // No year cap from here: the button means "close the back-catalog gap", and
    // the full window is ~12 min of throttled requests that nobody waits on. The
    // batching exists for cron ticks, not for this.
    if (req.body?.scope === 'historical') {
      performAnilistHistoricalCrawl();
      return res.status(200).json({ message: 'AniList historical catalog crawl started' });
    }
    performAnilistCatalogCrawl();

    return res.status(200).json({ message: 'AniList catalog crawl started' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
