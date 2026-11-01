import type { NextApiRequest, NextApiResponse } from 'next';
import { addIgnored, removeIgnored } from '@/lib/reco/ignored';
import { isCanonicalId } from '@/lib/store';

/**
 * « Ignorer » — stop proposing this title as a recommendation.
 *  POST   — ignore it (drops it from every reco surface)
 *  DELETE — un-ignore it (↩ Remettre, from the « Ignorés » list)
 *
 * No body: there is exactly one verdict to record, which is the whole point of
 * the control that replaced the 👍/👎 pair (see `reco/ignored.ts`). It takes
 * `hide.ts`'s shape for `rating-intent.ts`'s reason — a `user/` annotation with
 * no remote to fan out to.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const animeId = typeof id === 'string' ? id : '';
  if (!isCanonicalId(animeId)) {
    return res.status(400).json({ error: 'Invalid anime ID' });
  }

  try {
    switch (req.method) {
      case 'POST':
        addIgnored(animeId);
        res.status(200).json({ message: 'Recommendation ignored' });
        break;
      case 'DELETE':
        removeIgnored(animeId);
        res.status(200).json({ message: 'Recommendation restored' });
        break;
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error updating ignored state for anime ${animeId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
