import { NextApiRequest, NextApiResponse } from 'next';
import { isCanonicalId } from '@/lib/store';
import { writePersonal } from '@/lib/providers/writers';

/**
 * Set the user's personal score for one anime. Thin wrapper over the personal
 * writer registry ([personalWriters.ts](../../../../../lib/personalWriters.ts)):
 * the local-cache authority slices (MAL / SIMKL / local) are bumped first — so
 * the SIMKL-first `getEffectiveScore` reflects the new value immediately — then
 * the enabled remote writers fire. A per-provider `outcomes` map is returned so
 * the client can surface a remote write that didn't take (a failed SIMKL push
 * would otherwise be invisible: local slices already show the new score).
 *
 * `score` 0 clears the rating (drag back to the "à noter" tray).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const canonicalId = typeof req.query.id === 'string' ? req.query.id : '';
  if (!isCanonicalId(canonicalId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  const score = Number((req.body as { score?: unknown })?.score);
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    return res.status(400).json({ error: 'Score must be an integer between 0 and 10' });
  }

  try {
    const { found, outcomes } = await writePersonal(canonicalId, { score });
    if (!found) return res.status(404).json({ error: 'Anime not found' });
    return res.status(200).json({ ok: true, score, outcomes });
  } catch (error) {
    console.error('Error updating rating:', error);
    return res.status(500).json({ error: 'Failed to update rating' });
  }
}
