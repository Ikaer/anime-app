import { NextApiRequest, NextApiResponse } from 'next';
import { isCanonicalId } from '@/lib/store';
import { writePersonal, PersonalPatch } from '@/lib/personalWriters';
import { UserAnimeStatus } from '@/models/anime';

/**
 * Update the user's status / score / progress for one anime. Thin wrapper over
 * the personal writer registry ([personalWriters.ts](../../../../../lib/personalWriters.ts)):
 * the local-cache authority slices are bumped first, then the enabled remote
 * writers fire. Historically MAL-only; now it also lands in the local slice when
 * the local provider is enabled, and is a no-op for the score-only SIMKL writer.
 *
 * Wire body stays `{ status?, score?, num_episodes_watched? }` (MAL's field
 * name); it's translated to the neutral `progress` patch field at this boundary.
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
    const body = (req.body ?? {}) as { status?: string | null; score?: number; num_episodes_watched?: number };

    // `status` absent = leave it alone; `null`/`''` = CLEAR it (see PersonalPatch).
    const clearStatus = 'status' in body && (body.status === null || body.status === '');
    if (body.status && !['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'].includes(body.status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }
    if (body.score !== undefined && (body.score < 0 || body.score > 10)) {
      return res.status(400).json({ error: 'Score must be between 0 and 10' });
    }
    if (body.num_episodes_watched !== undefined && body.num_episodes_watched < 0) {
      return res.status(400).json({ error: 'Episodes watched cannot be negative' });
    }

    const patch: PersonalPatch = {
      status: clearStatus ? null : (body.status as UserAnimeStatus | undefined),
      score: body.score,
      progress: body.num_episodes_watched,
    };

    const { found, outcomes } = await writePersonal(canonicalId, patch);
    if (!found) return res.status(404).json({ error: 'Anime not found' });

    return res.status(200).json({ message: 'Status updated successfully', outcomes });
  } catch (error) {
    console.error('Error updating MAL status:', error);
    return res.status(500).json({ error: 'Failed to update MAL status' });
  }
}
