import type { NextApiRequest, NextApiResponse } from 'next';
import { getBox, BOX_TAG_MIN_RANK } from '@/lib/reco/boxes';
import { getGroups } from '@/lib/reco/groups';
import { getAnimeForDisplay } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import { toLeanRow, byAirDate, type LeanAnimeRow } from '@/lib/domain/leanRow';
import { resolveBoxUnits, faceUnits } from '@/lib/domain/boxUnits';
import { buildBoxComposition, type BoxComposition } from '@/lib/domain/boxComposition';
import { DEFAULT_BOX_EMOJI, type AnimeRecord } from '@/models/anime';

/**
 * GET /api/anime/boxes/[id]/members — everything one box's page renders.
 *
 * `GET /api/anime/boxes` deliberately ships bare ids (a list of every box would
 * otherwise carry every box's rows), so resolving them to titles and posters is
 * this endpoint's job. Both the audit grid and the sidebar's seed chips read it,
 * which is why it exists rather than each of them filtering some larger payload.
 *
 * It also carries the box's own record, its resolved UNITS, its « écartés » set
 * and the composition block, so `/boxes/[id]` renders from ONE request. The
 * alternative was the page fetching `/api/anime/boxes` and finding itself in it,
 * which would compute all 26 boxes' top slices to render one.
 *
 * Ids the store no longer knows are reported in `missing` rather than dropped
 * silently — a member that vanished is a registry question, not an empty slot.
 */

/** One display slot: the unit's best example, and everything it stands for. */
export interface BoxUnitRow {
  /** The face — what the slot shows. Also `members[0]`. */
  row: LeanAnimeRow;
  /**
   * Every entry the slot stands for, face first.
   *
   * Full rows rather than ids because présentation expands a unit in place: §6.1
   * says « every member, no Tout afficher », and a slot marked « +6 » only
   * honours that if the six are reachable. A box is 20-40 entries, so this costs
   * nothing.
   */
  members: LeanAnimeRow[];
}

export interface BoxMembersResponse {
  boxId: string;
  /** The box's own record — name, emoji, description, declared groups. */
  box: {
    id: string;
    name: string;
    emoji: string;
    description?: string;
    createdAt: string;
    members: string[];
    excluded?: string[];
    groups?: string[];
  };
  /** Air-date order, flat. The audit grid's shape; unchanged. */
  members: LeanAnimeRow[];
  /** The same members collapsed under the box's DECLARED groups, best example first. */
  units: BoxUnitRow[];
  /**
   * The « écartés » set as rows.
   *
   * ⚠️ **Resolved from ids alone, never joined against the watched list.** §3:
   * the recos tab surfaces unseen candidates and « Non » files them here, so
   * this list contains unwatched titles by construction. Joining it against
   * what the owner has seen is the same failure shape as deriving a seiyuu
   * filmography from the cast slice — it would return only what was watched and
   * look like an empty feature.
   */
  excluded: LeanAnimeRow[];
  /** What the box is made of — the diagnosis block (§6.1). */
  composition: BoxComposition;
  /** Member ids with no record in the store. */
  missing: string[];
  /** Excluded ids with no record in the store, reported for the same reason. */
  missingExcluded: string[];
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

    // Display order: personal score desc, insertion order as the tie-break.
    // Score alone barely orders a box (`Unique vibe` is nine 10s) and "what I
    // filed first" is a serviceable proxy for "best example". ⚠️ The SAME order
    // the landing card uses — présentation is that card at full length, and a
    // slot facing a different title on each would read as two different boxes.
    const rank = new Map(
      [...resolved]
        .sort((a, b) => (b.personal.score || 0) - (a.personal.score || 0))
        .map((a, i) => [a.id, i] as const)
    );
    const faced = faceUnits(resolveBoxUnits(box, getGroups()), rank);

    const row = (id: string) => toLeanRow(byId.get(id)!, titleLang);
    const excludedIds = box.excluded ?? [];

    return res.status(200).json({
      boxId,
      box: {
        id: box.id,
        name: box.name,
        // Display normalization, as on the list route: a box created before the
        // default existed still renders a chip the height of its neighbours.
        emoji: box.emoji || DEFAULT_BOX_EMOJI,
        // NOT defaulted, unlike the emoji: absence is the editor's placeholder
        // state and the chip tooltip's fall-back-to-the-name signal.
        ...(box.description ? { description: box.description } : {}),
        createdAt: box.createdAt,
        members: box.members,
        ...(box.excluded?.length ? { excluded: box.excluded } : {}),
        ...(box.groups?.length ? { groups: box.groups } : {}),
      },
      members: resolved.sort(byAirDate(titleLang)).map(a => toLeanRow(a, titleLang)),
      units: faced.map(unit => ({ row: row(unit.face), members: unit.members.map(row) })),
      excluded: excludedIds.filter(id => byId.has(id)).map(row),
      composition: buildBoxComposition(faced, byId, BOX_TAG_MIN_RANK),
      missing,
      missingExcluded: excludedIds.filter(id => !byId.has(id)),
    } satisfies BoxMembersResponse);
  } catch (error) {
    console.error(`Error loading members of box ${boxId}:`, error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
