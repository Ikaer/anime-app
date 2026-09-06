/**
 * Mute / unmute a title as a recommendation SEED — « ne plus partir de ce titre ».
 *
 * `hide.ts`'s shape, for `rating-intent.ts`'s reason: this is a `user/`
 * annotation, not provider state. It never reaches a `PersonalWriter`, never
 * enters personal precedence, and has no remote to fan out to — so it is its own
 * route rather than a dimension on `PUT …/personal`.
 *
 * Note the `[id]` here is the SEED's canonical id, not a candidate's: the feed
 * card's control passes `recoMeta.topSeeds[n].id`.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isCanonicalId } from '@/lib/store';
import { addSeedMute, removeSeedMute } from '@/lib/reco/seedMutes';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const animeId = typeof id === 'string' ? id : '';

  if (!isCanonicalId(animeId)) {
    return res.status(400).json({ error: 'Invalid anime ID' });
  }

  try {
    switch (req.method) {
      case 'POST':
        addSeedMute(animeId);
        res.status(200).json({ ok: true, muted: true });
        break;
      case 'DELETE':
        removeSeedMute(animeId);
        res.status(200).json({ ok: true, muted: false });
        break;
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error updating seed mute for ${animeId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
