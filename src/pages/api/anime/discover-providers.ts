import { NextApiRequest, NextApiResponse } from 'next';
import { generateGoogleORQuery, categorizeSearchResults, SearchResult } from '@/lib/providers';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const { animeTitle } = req.body;

    if (!animeTitle) {
      return res.status(400).json({ error: 'Anime title is required' });
    }

    // For now, simulate the provider discovery since we need Puppeteer setup
    // In a production environment, this would use the actual scraping logic
    const mockResults = [
      {
        title: `${animeTitle} - Crunchyroll`,
        url: `https://www.crunchyroll.com/series/${animeTitle.toLowerCase().replace(/\s+/g, '-')}`,
        snippet: `Watch ${animeTitle} on Crunchyroll`
      },
      {
        title: `${animeTitle} - Netflix`,
        url: `https://www.netflix.com/title/${Math.random().toString(36).substr(2, 9)}`,
        snippet: `Stream ${animeTitle} on Netflix`
      },
      {
        title: `${animeTitle} - ADN`,
        url: `https://animationdigitalnetwork.fr/video/${animeTitle.toLowerCase().replace(/\s+/g, '-')}`,
        snippet: `Regarder ${animeTitle} sur ADN`
      }
    ];

    const categorizedResults = categorizeSearchResults(mockResults);

    res.status(200).json({
      success: true,
      results: categorizedResults
    });
  } catch (error) {
    console.error('Error in provider discovery:', error);
    res.status(500).json({ error: 'Failed to discover providers' });
  }
}
