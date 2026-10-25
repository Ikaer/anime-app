/**
 * The favourite-character registry, joined for display — what `/characters`
 * renders and what every ★ control reads to know its own state.
 *
 * The origin title is resolved HERE, under `getTitleLanguage()`: this route is
 * the outermost boundary, and `domain/animeUtils.ts` is in the client-safety
 * block so it cannot read the setting itself.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { listCharacterFavorites } from '@/lib/user/characterFavorites';
import type { CharacterFavoriteView } from '@/lib/domain/characterFavorites';
import { getTitleLanguage } from '@/lib/config/settings';

export interface CharacterFavoritesResponse {
  favorites: CharacterFavoriteView[];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  try {
    res.status(200).json({ favorites: listCharacterFavorites(getTitleLanguage()) });
  } catch (error) {
    console.error('Error reading character favourites:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
