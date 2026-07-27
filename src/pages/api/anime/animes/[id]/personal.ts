import { NextApiRequest, NextApiResponse } from 'next';
import { isCanonicalId } from '@/lib/store';
import { writePersonal, PersonalPatch } from '@/lib/providers/writers';
import { UserAnimeStatus } from '@/models/anime';

/**
 * Update the user's status / score / progress for one anime. Thin wrapper over
 * the personal writer registry ([writers.ts](../../../../../lib/providers/writers.ts)):
 * the local-cache authority slices are bumped first, then the enabled remote
 * writers fire.
 *
 * **Was `mal-status`, with a `num_episodes_watched` wire field**, from when MAL
 * was the only writer. Both were left behind by the writer registry: the route
 * fans out to *every* enabled provider and cannot name one of them, so the path
 * and the body now speak `PersonalPatch`'s neutral vocabulary
 * (`{ status?, score?, progress? }`) instead of MAL's.
 *
 * An explicit `status: null` (or `''`) CLEARS the status, which every provider
 * models as **removing the whole list entry** — so it takes the score and
 * progress with it, and combining it with either is rejected rather than
 * silently discarding them (see `PersonalPatch` / `deletePersonal`).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const canonicalId = typeof id === 'string' ? id : '';

  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  if (!isCanonicalId(canonicalId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  try {
    const body = (req.body ?? {}) as { status?: string | null; score?: number; progress?: number };

    // `status` absent = leave it alone; `null`/`''` = CLEAR it (see PersonalPatch).
    const clearStatus = 'status' in body && (body.status === null || body.status === '');
    if (body.status && !['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'].includes(body.status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    if (body.score !== undefined && (body.score < 0 || body.score > 10)) {
      return res.status(400).json({ error: 'Score must be between 0 and 10' });
    }
    if (body.progress !== undefined && body.progress < 0) {
      return res.status(400).json({ error: 'Progress cannot be negative' });
    }
    // Clearing removes the entry, so a score/progress in the same patch has
    // nowhere to land. Reject rather than apply half of a contradictory request.
    if (clearStatus && (body.score !== undefined || body.progress !== undefined)) {
      return res.status(400).json({
        error: 'Clearing a status removes the whole list entry — it cannot be combined with score or progress',
      });
    }

    const patch: PersonalPatch = {
      status: clearStatus ? null : (body.status as UserAnimeStatus | undefined),
      score: body.score,
      progress: body.progress,
    };

    const { found, outcomes } = await writePersonal(canonicalId, patch);
    if (!found) return res.status(404).json({ error: 'Anime not found' });

    return res.status(200).json({ message: 'Personal state updated successfully', outcomes });
  } catch (error) {
    console.error('Error updating personal state:', error);
    return res.status(500).json({ error: 'Failed to update personal state' });
  }
}
