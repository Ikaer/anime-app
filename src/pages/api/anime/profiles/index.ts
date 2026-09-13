import type { NextApiRequest, NextApiResponse } from 'next';
import { getProfiles, createProfile } from '@/lib/reco/profiles';
import { getBoxes } from '@/lib/reco/boxes';
import { PROFILE_PRESETS, profileBoxRef, type ProfileSummary } from '@/lib/reco/profileWeights';

/**
 * Reco profiles (docs/recoProfiles/DESIGN.md §9).
 *   GET  — every profile, with the boxes pointing at it
 *   POST { name, emoji?, description?, weights? | preset? } — create one
 *
 * `preset` seeds the weights from a shipped starting point (`PROFILE_PRESETS`)
 * when no `weights` are sent, so « Nouveau profil depuis Réalisation » is one
 * request. `weights` wins when both arrive: it is the more specific statement.
 */

export interface ProfileListResponse {
  profiles: ProfileSummary[];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const boxes = getBoxes();
        const profiles = getProfiles().map(p => ({
          ...p,
          usedBy: boxes.filter(b => b.profileId === p.id).map(profileBoxRef),
        }));
        return res.status(200).json({ profiles } satisfies ProfileListResponse);
      }

      case 'POST': {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) return res.status(400).json({ error: 'name is required' });

        let weights: unknown = req.body?.weights;
        if (weights !== undefined && (weights === null || typeof weights !== 'object' || Array.isArray(weights))) {
          return res.status(400).json({ error: 'weights must be an object of field → number' });
        }
        if (weights === undefined && req.body?.preset !== undefined) {
          const preset = PROFILE_PRESETS.find(p => p.key === req.body.preset);
          if (!preset) return res.status(400).json({ error: `unknown preset: ${String(req.body.preset)}` });
          weights = preset.weights;
        }

        const profile = createProfile(name, {
          emoji: typeof req.body?.emoji === 'string' ? req.body.emoji : undefined,
          description: typeof req.body?.description === 'string' ? req.body.description : undefined,
          weights,
        });
        return res.status(201).json({ profile: { ...profile, usedBy: [] } satisfies ProfileSummary });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('Error handling profiles request:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
