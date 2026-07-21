import { NextApiRequest, NextApiResponse } from 'next';
import { getMalIdForCanonical, getRegistry, isCanonicalId, getAllAnilistMeta } from '@/lib/store';
import { getOrFetchAnilistCast } from '@/lib/providers/anilist/cast';

/**
 * One title's cast (characters + Japanese seiyuu), lazily filled from AniList.
 *
 * GET is the read path used by the detail page's Cast section when the record
 * has no cached cast yet; `?force=1` re-fetches an already-cached entry (the
 * per-anime refresh). Kept a GET rather than folded into the POST refresh
 * endpoint because the common case is a plain cache read that happens to
 * populate itself on a miss.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const canonicalId = typeof req.query.id === 'string' ? req.query.id : '';
  if (!isCanonicalId(canonicalId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  // Either id works: AniList's own id covers AniList-only titles that have no
  // MAL id at all, and is preferred when both are known (no idMal round-trip).
  const malId = getMalIdForCanonical(canonicalId);
  const anilistId =
    getAllAnilistMeta()[canonicalId]?.anilist_id ??
    (typeof getRegistry()[canonicalId]?.anilist === 'number'
      ? (getRegistry()[canonicalId].anilist as number)
      : undefined);

  const result = await getOrFetchAnilistCast(
    canonicalId,
    { malId, anilistId },
    req.query.force === '1'
  );

  if (!result.ok) {
    return res.status(502).json({ ok: false, error: result.error });
  }

  return res.status(200).json({
    ok: true,
    cached: result.cached,
    characters: result.entry?.characters ?? [],
  });
}
