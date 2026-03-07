import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { AnimeWithExtensions } from '@/models/anime';

const ANIMES_FILE = path.join(process.cwd(), 'data', 'anime', 'animes.json');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const animeId = parseInt(id as string, 10);

  if (req.method === 'POST') {
    try {
      const { url, providerName } = req.body;

      if (!url || !providerName) {
        return res.status(400).json({ error: 'URL and provider name are required' });
      }

      // Read current animes
      let animes: AnimeWithExtensions[] = [];
      if (fs.existsSync(ANIMES_FILE)) {
        const data = fs.readFileSync(ANIMES_FILE, 'utf8');
        animes = JSON.parse(data);
      }

      // Find the anime to update
      const animeIndex = animes.findIndex(anime => anime.id === animeId);
      if (animeIndex === -1) {
        return res.status(404).json({ error: 'Anime not found' });
      }

      const anime = animes[animeIndex];

      // Initialize extensions if not present
      if (!anime.extensions) {
        anime.extensions = {
          providers: [],
          notes: ''
        };
      }
      if (!anime.extensions.providers) {
        anime.extensions.providers = [];
      }

      // Check if this URL already exists
      const existingProvider = anime.extensions.providers.find(p => p.url === url);
      if (existingProvider) {
        return res.status(400).json({ error: 'This URL is already added' });
      }

      // Add the new provider
      anime.extensions.providers.push({
        url,
        name: providerName
      });

      // Update the animes array
      animes[animeIndex] = anime;

      // Write back to file
      fs.writeFileSync(ANIMES_FILE, JSON.stringify(animes, null, 2));

      res.status(200).json({ 
        message: 'Provider added successfully',
        anime: anime
      });
    } catch (error) {
      console.error('Error adding provider:', error);
      res.status(500).json({ error: 'Failed to add provider' });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}
