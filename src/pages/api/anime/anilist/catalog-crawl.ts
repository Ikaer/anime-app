import { NextApiRequest, NextApiResponse } from 'next';
import { performAnilistCatalogCrawl, getAnilistCatalogCrawlStats } from '@/lib/anilistSync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(getAnilistCatalogCrawlStats());
  }

  if (req.method === 'POST') {
    // Fire-and-forget, mirroring meta-sync: pages take multiple seconds each
    // under AniList's throttle. Progress surfaces via appendLog(...), polled
    // client-side by the connection log panel.
    performAnilistCatalogCrawl();

    return res.status(200).json({ message: 'AniList catalog crawl started' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
