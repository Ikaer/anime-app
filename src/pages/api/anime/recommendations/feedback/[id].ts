import type { NextApiRequest, NextApiResponse } from 'next';
import { setFeedbackVerdict, removeFeedback } from '@/lib/recommendations';
import { isCanonicalId } from '@/lib/store';
import type { RecoVerdict } from '@/models/anime';

/**
 * Persist a user's thumb on a recommendation.
 *  POST   { verdict: 'up' | 'down' } — 👍 "bonne pioche" / 👎 "pas pour moi"
 *  DELETE                            — clear the verdict (↩ Remettre)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const animeId = typeof id === 'string' ? id : '';
  if (!isCanonicalId(animeId)) {
    return res.status(400).json({ error: 'Invalid anime ID' });
  }

  try {
    switch (req.method) {
      case 'POST': {
        const verdict = req.body?.verdict as RecoVerdict;
        if (verdict !== 'up' && verdict !== 'down') {
          return res.status(400).json({ error: "verdict must be 'up' or 'down'" });
        }
        setFeedbackVerdict(animeId, verdict);
        res.status(200).json({ message: 'Feedback saved', verdict });
        break;
      }
      case 'DELETE':
        removeFeedback(animeId);
        res.status(200).json({ message: 'Feedback cleared' });
        break;
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error updating feedback for anime ${animeId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
