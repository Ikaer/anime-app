import type { NextApiRequest, NextApiResponse } from 'next';
import { getBoxes, createBox } from '@/lib/reco/boxes';
import { getAnimeForDisplay } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import { getPrimaryTitle } from '@/lib/domain/animeUtils';
import { DEFAULT_BOX_EMOJI, type AnimeRecord } from '@/models/anime';

/**
 * The box list.
 *   GET  — every box, with the member ids (the chip rows' state) and a few covers
 *   POST { name, emoji? } — create one
 *
 * `members` ships as bare ids rather than projected rows: a box is 20-40 ids,
 * which is small, and every surface that renders a box either needs only the
 * membership SET (the chip rows on `/boxes`) or fetches its own rows anyway.
 */

/** Posters shown on a box's card in the index. */
const COVER_COUNT = 4;

export interface BoxSummary {
  id: string;
  name: string;
  /** Always set — falls back to `DEFAULT_BOX_EMOJI`. */
  emoji: string;
  createdAt: string;
  members: string[];
  count: number;
  /** Up to four member posters, best-scored first — the card's face. */
  covers: string[];
  /** The best-scored member's title — what the box looks like, in one name. */
  sample?: string;
}

export interface BoxListResponse {
  boxes: BoxSummary[];
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const all = getAnimeForDisplay();
        const byId = new Map<string, AnimeRecord>(all.map(a => [a.id, a]));
        const titleLang = getTitleLanguage();

        const boxes: BoxSummary[] = getBoxes().map(box => {
          // Best-scored first so the card's face is the box's strongest example
          // rather than whatever happened to be filed first.
          const resolved = box.members
            .map(id => byId.get(id))
            .filter((a): a is AnimeRecord => !!a)
            .sort((a, b) => (b.personal.score || 0) - (a.personal.score || 0));

          return {
            id: box.id,
            name: box.name,
            // Always populated, so a box created before the default existed (or
            // with the field left blank) still renders a chip the same height as
            // its neighbours. The stored value is left alone — this is display
            // normalization, and the detail page's editor is what writes one.
            emoji: box.emoji || DEFAULT_BOX_EMOJI,
            createdAt: box.createdAt,
            members: box.members,
            count: box.members.length,
            covers: resolved
              .map(a => a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large)
              .filter((p): p is string => !!p)
              .slice(0, COVER_COUNT),
            ...(resolved[0] ? { sample: getPrimaryTitle(resolved[0], titleLang) } : {}),
          };
        });

        return res.status(200).json({ boxes } satisfies BoxListResponse);
      }

      case 'POST': {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        if (!name) return res.status(400).json({ error: 'name is required' });
        const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji : undefined;
        return res.status(201).json({ box: createBox(name, emoji) });
      }

      default:
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
  } catch (error) {
    console.error('Error handling boxes request:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
