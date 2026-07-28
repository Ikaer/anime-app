import { NextApiRequest, NextApiResponse } from 'next';
import { isCanonicalId, getAnimeByCanonicalId } from '@/lib/store';
import { writePersonal } from '@/lib/providers/writers';
import type { ProvenanceSource } from '@/models/anime';

/** The only providers "Apply SIMKL" can target — never SIMKL itself. */
const APPLY_TARGETS: ProvenanceSource[] = ['mal', 'anilist'];

/**
 * Copy SIMKL's raw status/score/progress onto ONE other provider — the
 * discrepancies page's per-row "Apply SIMKL" button. A single-target sibling
 * of `personal.ts`'s fan-out write: `writePersonal`'s `only` option restricts
 * the local + remote write to `target`, so this never touches the other
 * enabled providers.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  const canonicalId = typeof id === 'string' ? id : '';

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  if (!isCanonicalId(canonicalId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  const target = (req.body as { target?: string } | undefined)?.target as ProvenanceSource | undefined;
  if (!target || !APPLY_TARGETS.includes(target)) {
    return res.status(400).json({ error: 'target must be "mal" or "anilist"' });
  }

  try {
    const record = getAnimeByCanonicalId(canonicalId);
    const simkl = record?.sources.simkl;
    if (!simkl) {
      return res.status(400).json({ error: 'No SIMKL data for this title' });
    }

    const { found, outcomes } = await writePersonal(
      canonicalId,
      {
        status: simkl.status,
        ...(simkl.score != null ? { score: simkl.score } : {}),
        ...(simkl.num_episodes_watched != null ? { progress: simkl.num_episodes_watched } : {}),
      },
      { only: target }
    );
    if (!found) return res.status(404).json({ error: 'Anime not found' });

    const outcome = outcomes[target];
    if (!outcome?.ok) {
      return res.status(422).json({
        error: outcome?.error || `${target} is not enabled, or the write failed`,
        outcomes,
      });
    }

    return res.status(200).json({ message: 'Applied SIMKL state', outcomes });
  } catch (error) {
    console.error('Error applying SIMKL state:', error);
    return res.status(500).json({ error: 'Failed to apply SIMKL state' });
  }
}
