import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfile, updateProfile, deleteProfile, boxesUsingProfile } from '@/lib/reco/profiles';
import { profileBoxRef, type ProfileSummary } from '@/lib/reco/profileWeights';

/**
 * One reco profile (docs/recoProfiles/DESIGN.md §9).
 *   GET                                               — the profile, with the boxes using it
 *   PATCH  { name?, emoji?, description?, weights? }  — edit; the id never moves
 *   DELETE [?confirm=1]                               — drop it
 *
 * `weights` REPLACES the stored map — the page holds the complete sparse set,
 * and resetting a slider is a key deletion that a merge could not express.
 *
 * ⚠️ **DELETE refuses while a box points at the profile, unless confirmed.** It
 * answers 409 with `usedBy`, so the page can name the boxes whose recos will
 * stop being re-weighted — "a profile referenced by a box cannot be deleted
 * without a confirmation naming those boxes" (DESIGN §6). The dangling
 * `profileId` a confirmed delete leaves behind is inert, and never re-bound: see
 * `mintProfileId`.
 */

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const profileId = typeof id === 'string' ? id : '';
  if (!profileId) return res.status(400).json({ error: 'Invalid profile id' });

  try {
    const profile = getProfile(profileId);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    switch (req.method) {
      case 'GET': {
        const usedBy = boxesUsingProfile(profileId).map(profileBoxRef);
        return res.status(200).json({ profile: { ...profile, usedBy } satisfies ProfileSummary });
      }

      case 'PATCH': {
        const body = req.body ?? {};
        const patch: Parameters<typeof updateProfile>[1] = {};
        if (typeof body.name === 'string') patch.name = body.name;
        // `null` clears; `undefined` leaves alone — `boxes/[id]`' convention.
        if (body.emoji === null || typeof body.emoji === 'string') patch.emoji = body.emoji;
        if (body.description === null || typeof body.description === 'string') patch.description = body.description;
        if (body.weights !== undefined) {
          if (body.weights === null || typeof body.weights !== 'object' || Array.isArray(body.weights)) {
            return res.status(400).json({ error: 'weights must be an object of field → number' });
          }
          patch.weights = body.weights;
        }
        if (Object.keys(patch).length === 0) {
          return res.status(400).json({ error: 'nothing to do: pass name, emoji, description or weights' });
        }
        const updated = updateProfile(profileId, patch)!;
        const usedBy = boxesUsingProfile(profileId).map(profileBoxRef);
        return res.status(200).json({ profile: { ...updated, usedBy } satisfies ProfileSummary });
      }

      case 'DELETE': {
        const usedBy = boxesUsingProfile(profileId).map(profileBoxRef);
        if (usedBy.length > 0 && req.query.confirm !== '1') {
          return res.status(409).json({ error: 'Profile is attached to boxes', usedBy });
        }
        deleteProfile(profileId);
        return res.status(200).json({ message: 'Profile deleted', detached: usedBy });
      }

      default:
        res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error(`Error handling profile ${profileId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
