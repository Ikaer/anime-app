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
 * An explicit `status: null` (or `''`) CLEARS the status — only meaningful for a
 * local-only user, since no remote writer can express it (see `PersonalPatch`).
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
