/**
 * The favourite seiyuu, for every ★ control and the /stats marker — one small
 * read the client store (`useSeiyuuFavorites`) fetches once per page.
 *
 * `pending` lists favourites whose filmography is not stored yet: until it is,
 * they reach the rankers only through the cast slice (≈ the owner's own list),
 * so the UI can say "still loading" rather than look like it did nothing.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getSeiyuuFavorites } from '@/lib/reco/seiyuuFavorites';
import { getAllAnilistSeiyuu } from '@/lib/store';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
  const favorites = getSeiyuuFavorites();
  const filmographies = favorites.length ? getAllAnilistSeiyuu() : {};
  res.status(200).json({
    favorites,
    pending: favorites.filter(f => !filmographies[String(f.id)]).map(f => f.id),
  });
}
