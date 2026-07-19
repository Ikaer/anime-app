/**
 * Bulk fill of the cast slice for the statused list — the seiyuu/producers data
 * behind /stats. GET reports coverage, POST starts the sweep.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getAnilistCastSweepStats, performAnilistCastSweep } from '@/lib/anilistCast';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(await getAnilistCastSweepStats());
  }

  if (req.method === 'POST') {
    // Fire-and-forget, mirroring meta-sync / catalog-crawl: the sweep runs one
    // throttled request per title and can take minutes. Progress surfaces via
    // appendLog('anilist-cast-sweep', …), polled client-side.
    void performAnilistCastSweep();
    return res.status(200).json({ message: 'AniList cast sweep started' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
