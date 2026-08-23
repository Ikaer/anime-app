import type { NextApiRequest, NextApiResponse } from 'next';
import { getBox } from '@/lib/reco/boxes';
import { getAnimeForDisplay } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import { toLeanRow, byAirDate, type LeanAnimeRow } from '@/lib/domain/leanRow';
import type { AnimeRecord } from '@/models/anime';

/**
 * GET /api/anime/boxes/[id]/members — the box's members as lean rows.
 *
 * `GET /api/anime/boxes` deliberately ships bare ids (a list of every box would
 * otherwise carry every box's rows), so resolving them to titles and posters is
 * this endpoint's job. Both the audit grid and the sidebar's seed chips read it,
 * which is why it exists rather than each of them filtering some larger payload.
 *
 * Ids the store no longer knows are reported in `missing` rather than dropped
 * silently — a member that vanished is a registry question, not an empty slot.
 */

export interface BoxMembersResponse {
  boxId: string;
  members: LeanAnimeRow[];
  /** Member ids with no record in the store. */
  missing: string[];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { id } = req.query;
  const boxId = typeof id === 'string' ? id : '';

  try {
    const box = getBox(boxId);
    if (!box) return res.status(404).json({ error: 'Box not found' });

    const titleLang = getTitleLanguage();
    const byId = new Map<string, AnimeRecord>(getAnimeForDisplay().map(a => [a.id, a]));

    const resolved: AnimeRecord[] = [];
    const missing: string[] = [];
    for (const memberId of box.members) {
      const record = byId.get(memberId);
      if (record) resolved.push(record);
      else missing.push(memberId);
    }

    return res.status(200).json({
      boxId,
      members: resolved.sort(byAirDate(titleLang)).map(a => toLeanRow(a, titleLang)),
      missing,
    } satisfies BoxMembersResponse);
  } catch (error) {
    console.error(`Error loading members of box ${boxId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
