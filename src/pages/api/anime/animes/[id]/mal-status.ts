import { NextApiRequest, NextApiResponse } from 'next';
import { getAllMALAnime, saveMALAnime, getMALAuthData } from '@/lib/anime';
import { AnimeWithExtensions, MALAuthData } from '@/models/anime';

interface MALStatusUpdate {
  status?: string;
  score?: number;
  num_episodes_watched?: number;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const animeId = parseInt(id as string, 10);

  if (req.method === 'PUT') {
    try {
      const updates: MALStatusUpdate = req.body;

      // Validate the updates
      if (updates.status && !['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'].includes(updates.status)) {
        return res.status(400).json({ error: 'Invalid status value' });
      }

      if (updates.score !== undefined && (updates.score < 0 || updates.score > 10)) {
        return res.status(400).json({ error: 'Score must be between 0 and 10' });
      }

      if (updates.num_episodes_watched !== undefined && updates.num_episodes_watched < 0) {
        return res.status(400).json({ error: 'Episodes watched cannot be negative' });
      }

      // Read current animes to update local state
      const animesData = getAllMALAnime();
      console.log(`Looking for anime ID ${animeId} in file with ${Object.keys(animesData).length} animes`);
      console.log('Available anime IDs:', Object.keys(animesData).slice(0, 10)); // Log first 10 IDs

      // Find the anime to update
      const animeKey = animeId.toString();
      if (!(animeKey in animesData)) {
        console.log(`Anime ${animeId} not found in JSON file`);
        return res.status(404).json({ error: 'Anime not found' });
      }

      const anime = animesData[animeKey];

      // Update local state immediately
      if (!anime.my_list_status) {
        anime.my_list_status = {
          status: '',
          score: 0,
          num_episodes_watched: 0,
          is_rewatching: false,
          updated_at: new Date().toISOString()
        };
      }

      // Apply updates
      if (updates.status !== undefined) anime.my_list_status.status = updates.status;
      if (updates.score !== undefined) anime.my_list_status.score = updates.score;
      if (updates.num_episodes_watched !== undefined) anime.my_list_status.num_episodes_watched = updates.num_episodes_watched;
      anime.my_list_status.updated_at = new Date().toISOString();

      // Save updated animes
      saveMALAnime(animesData);

      // Try to update MAL API
      try {
        await updateMALAPI(animeId, updates);
      } catch (malError) {
        console.error('MAL API update failed, but local state updated:', malError);
        // Don't fail the request if MAL API fails - local state is already updated
      }

      res.status(200).json({ 
        message: 'Status updated successfully',
        anime: anime
      });
    } catch (error) {
      console.error('Error updating MAL status:', error);
      res.status(500).json({ error: 'Failed to update MAL status' });
    }
  } else {
    res.setHeader('Allow', ['PUT']);
    res.status(405).json({ error: `Method ${req.method} not allowed` });
  }
}

async function updateMALAPI(animeId: number, updates: MALStatusUpdate) {
  // Read auth data
  const { token } = getMALAuthData();
  
  if (!token) {
    throw new Error('Not authenticated with MAL');
  }

  // Check if token is expired (with 5 minute buffer)
  const now = Date.now();
  const tokenExpiresAt = token.created_at + (token.expires_in * 1000);
  
  if (now >= tokenExpiresAt - 300000) { // 5 minutes buffer
    throw new Error('Token expired');
  }

  // Prepare the request body for MAL API
  const malUpdates: any = {};
  if (updates.status) malUpdates.status = updates.status;
  if (updates.score !== undefined) malUpdates.score = updates.score;
  if (updates.num_episodes_watched !== undefined) malUpdates.num_watched_episodes = updates.num_episodes_watched;

  // Try PUT first, fallback to PATCH if needed
  let response = await fetch(`https://api.myanimelist.net/v2/anime/${animeId}/my_list_status`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(malUpdates).toString(),
  });

  if (!response.ok && response.status !== 404) {
    // Try PATCH if PUT fails
    response = await fetch(`https://api.myanimelist.net/v2/anime/${animeId}/my_list_status`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(malUpdates).toString(),
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MAL API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}
