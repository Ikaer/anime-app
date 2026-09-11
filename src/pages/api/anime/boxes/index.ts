import type { NextApiRequest, NextApiResponse } from 'next';
import { getBoxes, createBox } from '@/lib/reco/boxes';
import { getGroups } from '@/lib/reco/groups';
import { getAnimeForDisplay } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import { getPrimaryTitle } from '@/lib/domain/animeUtils';
import { resolveBoxUnits, liveDeclared } from '@/lib/domain/boxUnits';
import { toLeanRow, type LeanAnimeRow } from '@/lib/domain/leanRow';
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

/**
 * How many UNITS the landing card shows before « Tout afficher ».
 *
 * ⚠️ Ten UNITS, not ten entries. `Shonen I dig`'s top 10 by entry is seven Demon
 * Slayer cours and three other things — §1's inflation rendered as a summary,
 * on the one surface whose job is to say what the box IS.
 */
const TOP_COUNT = 10;

/** One unit on a box card: its best-scored member, and how many it stands for. */
export interface BoxTopEntry {
  row: LeanAnimeRow;
  /** `members.length - 1` — rendered as « +3 ». Zero for a lone title. */
  extra: number;
  /**
   * Every member id this slot stands for, the faced one included.
   *
   * Shipped because a slot IS a unit, so the card's × has to remove the unit:
   * dropping only the faced title of a 7-entry slot would leave six behind and
   * re-face the slot, which reads as a control that did nothing. A handful of
   * ids per slot, so this costs nothing.
   */
  members: string[];
}

export interface BoxSummary {
  id: string;
  name: string;
  /** Always set — falls back to `DEFAULT_BOX_EMOJI`. */
  emoji: string;
  /** What the axis means, in the owner's words. Absent when never written. */
  description?: string;
  createdAt: string;
  members: string[];
  count: number;
  /** Resolved UNITS — what « 3 séries · 14 entrées » reports first. */
  unitCount: number;
  /** Size of the « écartés » set; absent when empty, as it is on disk. */
  excludedCount?: number;
  /** Groups DECLARED here — the ones whose collapse actually applies. */
  groups?: string[];
  /** Up to ten units, best example first, each marked with how many it stands for. */
  top: BoxTopEntry[];
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
        // Read once for the whole list: every box resolves its units against the
        // same global definitions.
        const groups = getGroups();

        const boxes: BoxSummary[] = getBoxes().map(box => {
          // Best-scored first so the card's face is the box's strongest example
          // rather than whatever happened to be filed first.
          const resolved = box.members
            .map(id => byId.get(id))
            .filter((a): a is AnimeRecord => !!a)
            .sort((a, b) => (b.personal.score || 0) - (a.personal.score || 0));

          // One slot per resolved unit, faced by its best-scored member. This is
          // the one place the collapse is applied for DISPLAY without a groups
          // region beside it — a card has room for a list, not for two regions.
          const units = resolveBoxUnits(box, groups);
          const rank = new Map(resolved.map((a, i) => [a.id, i]));
          const top: BoxTopEntry[] = units.units
            .map(unit => {
              // `resolved` is already personal-score desc, so the lowest index in
              // it is the unit's best example. Score alone barely orders these
              // (`Unique vibe` is nine 10s), hence insertion order as the
              // tie-break — "what I filed first" is a serviceable proxy.
              const best = unit.members
                .filter(id => rank.has(id))
                .sort((x, y) => rank.get(x)! - rank.get(y)!)[0];
              if (!best) return null;
              return {
                row: toLeanRow(byId.get(best)!, titleLang),
                extra: unit.members.length - 1,
                members: unit.members,
              };
            })
            .filter((e): e is BoxTopEntry => e !== null)
            .sort((a, b) => rank.get(a.row.id)! - rank.get(b.row.id)!)
            .slice(0, TOP_COUNT);

          return {
            id: box.id,
            name: box.name,
            // Always populated, so a box created before the default existed (or
            // with the field left blank) still renders a chip the same height as
            // its neighbours. The stored value is left alone — this is display
            // normalization, and the detail page's editor is what writes one.
            emoji: box.emoji || DEFAULT_BOX_EMOJI,
            // Unlike the emoji, NOT defaulted: a box with no description must
            // render as one, so the field's absence is the editor's placeholder
            // state and the chip tooltip's fall-back-to-the-name signal.
            ...(box.description ? { description: box.description } : {}),
            createdAt: box.createdAt,
            members: box.members,
            count: box.members.length,
            // The honest count: « 3 séries · 14 entrées ». This is where §1's
            // inflation becomes visible per box and therefore fixable by
            // judgement. ⚠️ Do NOT write a migration to collapse existing
            // memberships — `user/boxes.json` is durable user data and the four
            // TYBW cours may well be deliberate.
            unitCount: units.units.length,
            ...(box.excluded?.length ? { excludedCount: box.excluded.length } : {}),
            // Live ids only — see `liveDeclared`.
            ...(liveDeclared(box.groups, groups).length ? { groups: liveDeclared(box.groups, groups) } : {}),
            top,
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
        const description = typeof req.body?.description === 'string' ? req.body.description : undefined;
        return res.status(201).json({ box: createBox(name, emoji, description) });
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
