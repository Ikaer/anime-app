/**
 * TEMPORARY — the one-time refill after the cast cap moved from 25 to 100
 * characters (see `performAnilistCastRefill`). GET counts the entries still at
 * the old cap, POST starts the refill. Remove with the button once done.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getTruncatedCastCount, performAnilistCastRefill } from '@/lib/providers/anilist/cast';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json(getTruncatedCastCount());
  }

  if (req.method === 'POST') {
    // Fire-and-forget like cast-sweep: a few seconds per title at the throttle.
    void performAnilistCastRefill();
    return res.status(200).json({ message: 'AniList cast refill started' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
