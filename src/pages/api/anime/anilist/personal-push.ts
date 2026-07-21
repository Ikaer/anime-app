/**
 * One-shot backfill of the local personal list up to AniList. GET reports how
 * far the two have drifted, POST starts the push.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getAnilistPushStats, performAnilistPersonalPush } from '@/lib/providers/anilist/push';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(await getAnilistPushStats());
  }

  if (req.method === 'POST') {
    // Fire-and-forget, mirroring cast-sweep / meta-sync: the push runs one
    // throttled write per differing title and can take minutes. Progress
    // surfaces via appendLog('anilist-personal-push', …), polled client-side.
    void performAnilistPersonalPush();
    return res.status(200).json({ message: 'AniList personal push started' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
