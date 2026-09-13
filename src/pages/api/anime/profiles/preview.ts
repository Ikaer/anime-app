import type { NextApiRequest, NextApiResponse } from 'next';
import { isCanonicalId } from '@/lib/store';
import { getBox } from '@/lib/reco/boxes';
import { getProfile } from '@/lib/reco/profiles';
import { previewProfile, PREVIEW_POOLS, type PreviewPool, type PreviewResult } from '@/lib/reco/profilePreview';
import { sanitizeProfileWeights } from '@/lib/reco/profileWeights';
import { getTitleLanguage } from '@/lib/config/settings';

/**
 * POST — preview what a reco-profile weighting retrieves for an anchor set
 * (docs/recoProfiles/DESIGN.md §7, §9). Nothing is saved or attached.
 *
 *   { weights?: ProfileWeights, profileId?: string,
 *     box?: string, anchors?: string[],
 *     pool?: 'catalog' | 'statused' | 'anchored', limit?: number,
 *     includeSeen?: boolean, lang?: 'fr' | 'en' }
 *
 * `weights` is the live slider state; `profileId` previews a saved profile as
 * stored (`weights` wins when both arrive — it is the more specific statement,
 * the create route's rule for `weights` over `preset`). Exactly one anchor
 * source: a `box` (its members, declared groups and écartés) or ad-hoc
 * `anchors`. `pool` defaults to `catalog` — a pure local read; `anchored` is the
 * one that reaches MAL / AniList. See `reco/profilePreview.ts`.
 *
 * POST rather than GET because the weights blob is larger than a query string
 * wants and a preview is not a cacheable resource.
 *
 * ⚠️ This path shadows `profiles/[id]` for an id of `preview` (a static route
 * beats a dynamic one), which is why `mintProfileId` never mints it.
 */

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
/** Ad-hoc anchors, bounded like `MAX_BOX_ANCHORS` — a box is curated, a body is arbitrary input. */
const MAX_ANCHORS = 40;

export type PreviewResponse = PreviewResult & { ms: number };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const body = req.body ?? {};
  const t0 = Date.now();

  const rawWeights: unknown = body.weights;
  if (rawWeights !== undefined && (rawWeights === null || typeof rawWeights !== 'object' || Array.isArray(rawWeights))) {
    return res.status(400).json({ error: 'weights must be an object of field → number' });
  }
  let weights = sanitizeProfileWeights(rawWeights);
  if (rawWeights === undefined && body.profileId !== undefined) {
    const profile = typeof body.profileId === 'string' ? getProfile(body.profileId) : undefined;
    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    weights = profile.weights;
  }

  const pool: PreviewPool = body.pool === undefined ? 'catalog' : body.pool;
  if (!PREVIEW_POOLS.includes(pool)) {
    return res.status(400).json({ error: `pool must be one of: ${PREVIEW_POOLS.join(', ')}` });
  }

  const hasBox = body.box !== undefined;
  const hasAnchors = body.anchors !== undefined;
  if (hasBox === hasAnchors) return res.status(400).json({ error: 'pass exactly one of box or anchors' });

  const box = hasBox && typeof body.box === 'string' ? getBox(body.box) : undefined;
  if (hasBox && !box) return res.status(404).json({ error: 'Box not found' });

  let anchorIds: string[] | undefined;
  if (hasAnchors) {
    if (!Array.isArray(body.anchors) || !body.anchors.every((id: unknown) => typeof id === 'string' && isCanonicalId(id))) {
      return res.status(400).json({ error: 'anchors must be an array of canonical ids' });
    }
    if (body.anchors.length > MAX_ANCHORS) {
      return res.status(400).json({ error: `at most ${MAX_ANCHORS} anchors` });
    }
    anchorIds = body.anchors;
  }

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isInteger(body.limit) ? body.limit : DEFAULT_LIMIT));
  if (body.includeSeen !== undefined && typeof body.includeSeen !== 'boolean') {
    return res.status(400).json({ error: 'includeSeen must be a boolean' });
  }

  try {
    const result = await previewProfile({
      weights,
      box,
      anchorIds,
      pool,
      limit,
      includeSeen: body.includeSeen,
      lang: body.lang === 'en' ? 'en' : 'fr',
      titleLang: getTitleLanguage(),
    });
    // Both crowd pipes down is an outage, not a thin answer — `mix`'s 502.
    if (result.sources && !result.sources.mal.ok && !result.sources.anilist.ok) {
      return res.status(502).json({ error: 'Both recommendation sources failed', sources: result.sources });
    }
    return res.status(200).json({ ...result, ms: Date.now() - t0 } satisfies PreviewResponse);
  } catch (error) {
    console.error('Profile preview error:', error);
    return res.status(500).json({
      error: 'Failed to preview the profile',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
