import { NextApiRequest, NextApiResponse } from 'next';
import { getOrFetchSeiyuuFilmography } from '@/lib/providers/anilist/seiyuu';

/**
 * One seiyuu's filmography, lazily filled from AniList into
 * `catalog/anilist_seiyuu.json`.
 *
 * The read path for `/credits/seiyuu/[id]`, which calls this once on mount when
 * its `getServerSideProps` found no stored entry. Same shape and reasoning as
 * `animes/[id]/cast.ts`: a GET whose common case is a plain slice read that
 * happens to populate itself on a miss. `?force=1` re-fetches a stored entry.
 *
 * ⚠️ **This request can legitimately take a minute.** The fetch walks AniList 25
 * credits at a time against the shared ~2.1s throttle, so a prolific seiyuu is
 * ~28 requests (measured: Takahiro Sakurai). It is paid once per person, ever —
 * the entry is persisted and every later view is a local read. The page shows a
 * progress state rather than blocking its own server render on it, which is the
 * whole reason this is a separate endpoint instead of an await in
 * `getServerSideProps`.
 *
 * The response deliberately carries no records: resolving credits to local rows
 * is `getServerSideProps`' job, so the client just re-renders the route once
 * this lands and gets the filtered, sorted list from the normal path.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const staffId = parseInt(typeof req.query.id === 'string' ? req.query.id : '', 10);
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return res.status(400).json({ error: 'Invalid seiyuu id' });
  }

  const result = await getOrFetchSeiyuuFilmography(staffId, req.query.force === '1');

  if (!result.ok) {
    return res.status(502).json({ ok: false, error: result.error });
  }

  return res.status(200).json({
    ok: true,
    cached: result.cached,
    credits: result.entry?.credits.length ?? 0,
    complete: result.entry?.complete ?? true,
  });
}
