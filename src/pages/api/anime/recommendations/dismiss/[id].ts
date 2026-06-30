import type { NextApiRequest, NextApiResponse } from 'next';
import { addDismissedId, removeDismissedId } from '@/lib/recommendations';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const animeId = parseInt(id as string, 10);

  if (isNaN(animeId)) {
    return res.status(400).json({ error: 'Invalid anime ID' });
  }

  try {
    switch (req.method) {
      case 'POST':
        addDismissedId(animeId);
        res.status(200).json({ message: 'Recommendation dismissed' });
        break;
      case 'DELETE':
        removeDismissedId(animeId);
        res.status(200).json({ message: 'Recommendation restored' });
        break;
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error updating dismiss status for anime ${animeId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
