import type { NextApiRequest, NextApiResponse } from 'next';
import { addHiddenAnimeId, removeHiddenAnimeId } from '@/lib/anime';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;
  const animeId = parseInt(id as string, 10);

  if (isNaN(animeId)) {
    return res.status(400).json({ error: 'Invalid anime ID' });
  }

  try {
    switch (req.method) {
      case 'POST':
        addHiddenAnimeId(animeId);
        res.status(200).json({ message: 'Anime hidden successfully' });
        break;
      case 'DELETE':
        removeHiddenAnimeId(animeId);
        res.status(200).json({ message: 'Anime unhidden successfully' });
        break;
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error updating hidden status for anime ${animeId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
