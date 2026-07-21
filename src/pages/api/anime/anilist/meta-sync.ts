import { NextApiRequest, NextApiResponse } from 'next';
import { getAllAnime, getAnilistMetaCount } from '@/lib/store';
import { performAnilistMetaSync } from '@/lib/providers/anilist/sync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    const totalAnime = Object.keys(getAllAnime()).length;
    const taggedCount = getAnilistMetaCount();
    return res.status(200).json({ totalAnime, taggedCount });
  }

  if (req.method === 'POST') {
    // Fire-and-forget, mirroring big-sync: the call can take minutes for a
    // large catalog, well past a typical request timeout. Progress surfaces
    // via appendLog(...), polled client-side by the connection log panel.
    performAnilistMetaSync();

    return res.status(200).json({ message: 'AniList metadata sync started' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
