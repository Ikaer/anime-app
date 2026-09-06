/**
 * Set or clear a title's rating intent — « À revoir » / « Sans avis ».
 *
 * Its own route rather than a dimension on `PUT …/personal`, because this is
 * NOT provider state: `RatingIntent` never reaches a `PersonalWriter`, never
 * enters personal precedence, and has no remote to fan out to. It is a `user/`
 * annotation, so it gets the shape of the other one — `hide.ts`.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeByCanonicalId, isCanonicalId, setRatingIntent } from '@/lib/store';
import { getEffectiveStatus } from '@/lib/domain/animeUtils';
import { writePersonal } from '@/lib/providers/writers';
import { RATING_INTENTS, type RatingIntent } from '@/models/anime';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const animeId = typeof id === 'string' ? id : '';

  if (!isCanonicalId(animeId)) {
    return res.status(400).json({ error: 'Invalid anime ID' });
  }

  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // `null` is the clear — an explicit value, not an omission, so a malformed
  // body can never be read as "unmark it".
  const raw = (req.body ?? {}).intent;
  if (raw !== null && !RATING_INTENTS.includes(raw as RatingIntent)) {
    return res.status(400).json({
      error: `intent must be null or one of: ${RATING_INTENTS.join(', ')}`,
    });
  }

  try {
    const intent = raw as RatingIntent | null;

    // Both intents assert « I have seen this ». On a title with no status at
    // all that assertion has nowhere to live — and `getStatusFilterKey` would
    // then answer `rewatch` for a row no provider believes was ever watched. So
    // marking an unstatused title completes it, through the normal writer
    // fan-out. A title that already carries a status keeps it: overwriting a
    // deliberate `dropped` would be the annotation deciding something it was
    // never asked about.
    const record = getAnimeByCanonicalId(animeId);
    let outcomes;
    if (intent !== null && record && !getEffectiveStatus(record)) {
      ({ outcomes } = await writePersonal(animeId, { status: 'completed' }));
    }

    setRatingIntent(animeId, intent);
    res.status(200).json({ ok: true, intent: intent ?? null, outcomes });
  } catch (error) {
    console.error(`Error setting rating intent for ${animeId}:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
