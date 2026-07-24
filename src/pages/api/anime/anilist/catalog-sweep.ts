import { NextApiRequest, NextApiResponse } from 'next';
import { performAnilistCatalogSweep, getAnilistCatalogSweepStats } from '@/lib/providers/anilist/sync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(getAnilistCatalogSweepStats());
  }

  if (req.method === 'POST') {
    // Fire-and-forget, mirroring meta-sync / catalog-crawl: the sweep is ~19k
    // titles under AniList's throttle (~15-20 min), well past a request timeout.
    // Progress surfaces via appendLog('anilist-catalog-sweep', …), polled
    // client-side by the connection log panel.
    performAnilistCatalogSweep();
    return res.status(200).json({ message: 'AniList catalog sweep started' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
