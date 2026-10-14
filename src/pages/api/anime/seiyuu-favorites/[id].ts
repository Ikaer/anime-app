/**
 * Star / unstar one seiyuu (AniList staff id). `seed-mute.ts`' shape: a `user/`
 * annotation with no remote to fan out to.
 *
 * ⚠️ Starring also starts the filmography fetch, fire-and-forget. That is what
 * makes the favourite reach the rankers at all: without it the index has only
 * the cast slice, which covers the owner's own list and almost no unseen title
 * (see `reco/favSeiyuu.ts`). Not awaited — a prolific seiyuu is ~60s of
 * throttled AniList paging — and a failure is retried by the cron's
 * `seiyuuFavorites` step, which fetches any favourite still missing one.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { addSeiyuuFavorite, removeSeiyuuFavorite } from '@/lib/reco/seiyuuFavorites';
import { getOrFetchSeiyuuFilmography } from '@/lib/providers/anilist/seiyuu';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const staffId = Number(req.query.id);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return res.status(400).json({ error: 'Invalid staff ID' });
  }

  try {
    switch (req.method) {
      case 'POST': {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        addSeiyuuFavorite(staffId, name);
        void getOrFetchSeiyuuFilmography(staffId).then(r => {
          if (!r.ok) console.warn(`[seiyuu-favorite] filmography fetch failed for ${staffId}: ${r.error}`);
        });
        return res.status(200).json({ ok: true, favorite: true });
      }
      case 'DELETE':
        removeSeiyuuFavorite(staffId);
        return res.status(200).json({ ok: true, favorite: false });
      default:
        res.setHeader('Allow', ['POST', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error updating seiyuu favourite ${staffId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
