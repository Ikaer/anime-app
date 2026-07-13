import { NextApiRequest, NextApiResponse } from 'next';
import { getAllAnime, saveAnime, resolveByMalId } from '@/lib/store';
import { updateMalListStatus, MalListStatusUpdate } from '@/lib/malWrite';

type MALStatusUpdate = MalListStatusUpdate;

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

      // Read current animes to update local state. `animeId` is the outward MAL
      // id; the slice is canonical-keyed, so resolve it to the canonical key.
      const animesData = getAllAnime();
      const animeKey = resolveByMalId(animeId);
      if (!animeKey || !(animeKey in animesData)) {
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
      saveAnime(animesData);

      // Try to update MAL API
      try {
        await updateMalListStatus(animeId, updates);
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
