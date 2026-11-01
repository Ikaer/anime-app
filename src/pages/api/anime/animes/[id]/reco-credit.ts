/**
 * Credit / un-credit the recommendation engine for a title — « Vu grâce à la
 * reco ».
 *
 * `hide.ts`'s shape, for `rating-intent.ts`'s reason: a `user/` annotation, not
 * provider state. It never reaches a `PersonalWriter`, never enters personal
 * precedence and has no remote to fan out to.
 *
 * ⚠️ It sits under `animes/[id]/` rather than beside `recommendations/ignore/`
 * on purpose. « Ignorer » is an act performed ON a feed card and is meaningless
 * anywhere else; this one is a statement ABOUT a title, fired as readily from
 * the detail page two weeks later as from the card — one route for one meaning,
 * whatever surface the click came from.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isCanonicalId } from '@/lib/store';
import { addRecoCredit, removeRecoCredit } from '@/lib/reco/recoCreditStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const animeId = typeof id === 'string' ? id : '';

  if (!isCanonicalId(animeId)) {
    return res.status(400).json({ error: 'Invalid anime ID' });
  }

  try {
    switch (req.method) {
      case 'POST':
        addRecoCredit(animeId);
        res.status(200).json({ ok: true, credited: true });
        break;
      case 'DELETE':
        removeRecoCredit(animeId);
        res.status(200).json({ ok: true, credited: false });
        break;
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error updating reco credit for ${animeId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
