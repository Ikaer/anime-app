/**
 * Star / unstar one character (AniList character id). `seiyuu-favorites/[id].ts`'
 * shape: a `user/` annotation with no remote to fan out to.
 *
 * ⚠️ **No fetch is started here, unlike the seiyuu route, and that is the whole
 * difference between the two features.** Starring a seiyuu kicks off
 * `getOrFetchSeiyuuFilmography` because the favourite is worthless to the
 * rankers until the person is inverted over the catalog. A character has
 * nothing to invert: measured on the live store, 80.6% appear in exactly one
 * title and 1.8% of the recurring ones leave their franchise (see
 * `CharacterFavorite` in `@/models/anime`). So this writes a line and returns.
 *
 * The POST body carries the character's identity because the caller — the
 * detail page's cast section — already has it on screen; see
 * `addCharacterFavorite`.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { addCharacterFavorite, removeCharacterFavorite } from '@/lib/user/characterFavorites';

/** AniList serves a grey placeholder rather than omitting a portrait, so an
 *  empty string must not be stored as if it were one. */
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const characterId = Number(req.query.id);
  if (!Number.isInteger(characterId) || characterId <= 0) {
    return res.status(400).json({ error: 'Invalid character ID' });
  }

  try {
    switch (req.method) {
      case 'POST': {
        const animeId = str(req.body?.animeId);
        // The origin title is what the gallery links to and re-reads the cast
        // entry from — a favourite without one would render as a dead card.
        if (!animeId) return res.status(400).json({ error: 'animeId is required' });
        addCharacterFavorite({
          id: characterId,
          name: str(req.body?.name) ?? '',
          nameNative: str(req.body?.nameNative),
          image: str(req.body?.image),
          role: str(req.body?.role),
          animeId,
        });
        return res.status(200).json({ ok: true, favorite: true });
      }
      case 'DELETE':
        removeCharacterFavorite(characterId);
        return res.status(200).json({ ok: true, favorite: false });
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error updating character favourite ${characterId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
