import { NextApiRequest, NextApiResponse } from 'next';
import { getAllMALAnime, getAnimeExtension } from '@/lib/anime';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Anime ID is required' });
    }

    // Get MAL anime data
    const malAnime = getAllMALAnime();
    const anime = malAnime[id];

    if (!anime) {
      return res.status(404).json({ error: 'Anime not found' });
    }

    // Get extension data
    const extensions = getAnimeExtension(id);

    // Return combined data
    res.json({
      anime: {
        ...anime,
        extensions
      }
    });

  } catch (error) {
    console.error('Get anime details error:', error);
    res.status(500).json({ 
      error: 'Failed to get anime details',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
