import type { NextApiRequest, NextApiResponse } from 'next';
import { getBox, rankBoxCandidates } from '@/lib/reco/boxes';
import { getAnimeForDisplay } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import { toLeanRow, byAirDate, type LeanAnimeRow } from '@/lib/domain/leanRow';
import type { MetaField } from '@/lib/reco/scoring';

/**
 * GET /api/anime/boxes/[id]/grow — "more of the same, from what you've watched".
 *
 * The grow loop's whole job is to make a decision cost a couple of seconds, so
 * this ships the matched VALUES alongside each group: the row reads "Lost
 * Civilization · Travel · Steampunk" beside the poster and is judged without
 * recalling the show. That is the difference between ~40 decisions per box and
 * scrolling 467 franchise groups.
 *
 * Pure local read — `rankBoxCandidates` calls no provider, so this is instant
 * and the page can refetch on every accept.
 */

export interface GrowGroup {
  /** The best-scoring member — the row's face. */
  id: string;
  score: number;
  /** Every member of the direct-relation component; accepting adds them all. */
  members: LeanAnimeRow[];
  matched: { field: MetaField; values: string[] }[];
}

export interface GrowResponse {
  boxId: string;
  /** Resolved member count — a box with none has nothing to rank from. */
  seeds: number;
  groups: GrowGroup[];
}

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 120;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { id, limit, skip } = req.query;
  const boxId = typeof id === 'string' ? id : '';

  try {
    const box = getBox(boxId);
    if (!box) return res.status(404).json({ error: 'Box not found' });

    const titleLang = getTitleLanguage();
    const all = getAnimeForDisplay();

    // Groups the user passed over in this session. They are NOT persisted: a
    // skip means "not now", and a box the user comes back to should offer them
    // again rather than silently narrowing forever. Persisting it would also be
    // a second membership file to keep in step with the first.
    const skipped = new Set(
      typeof skip === 'string' ? skip.split(',').map(s => s.trim()).filter(Boolean) : []
    );

    const n = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const ranked = rankBoxCandidates(box, all, { limit: n + skipped.size });

    // Only the members the box does NOT already hold. `rankBoxCandidates` never
    // SCORES a member, but it hands back the whole franchise component, and a
    // component often contains one — that is the "you filed S1, here is S2" case
    // this loop exists for. Showing the whole component made the top row's face
    // *Made in Abyss* on a box that already held it, which reads as the loop
    // proposing something you just filed. The row now shows exactly what
    // accepting adds.
    const held = new Set(box.members);
    const groups: GrowGroup[] = ranked
      .filter(g => !skipped.has(g.id))
      .slice(0, n)
      .map(g => ({
        id: g.id,
        score: g.score,
        members: g.members
          .filter(a => !held.has(a.id))
          .sort(byAirDate(titleLang))
          .map(a => toLeanRow(a, titleLang)),
        matched: g.matched,
      }))
      // A component entirely held already can't survive the filter above, and an
      // empty row would be a dead choice.
      .filter(g => g.members.length > 0);

    const byId = new Set(all.map(a => a.id));
    return res.status(200).json({
      boxId,
      seeds: box.members.filter(m => byId.has(m)).length,
      groups,
    } satisfies GrowResponse);
  } catch (error) {
    console.error(`Error growing box ${boxId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
