/**
 * « De quoi cette boîte est faite » — the block the old detail page lacked.
 *
 * It answers "what did I actually draw here" out of what the box already
 * contains: the tags, studios and T1 staff its members share, plus the score and
 * year ranges. Free, in the sense that every input is already on the record.
 *
 * **It is also a diagnosis, and that is why it earns a place on the page.** A
 * box whose shared values are content values (`Steampunk` 5/6, `Lost
 * Civilization` 5/6, `Aviation` 4/6) is a CONTENT axis and will project — its
 * grow tab works. A box whose members share `Philosophy` and exactly one T1
 * credit is a FORM axis, no catalog field encodes form, and the ranker will
 * drift to whatever is merely adjacent. Seeing that before trusting a ranked
 * list is the whole point: the two boxes look identical until you look at what
 * they have in common.
 *
 * ⚠️ **Every tally counts UNITS, never entries**, and the denominator is the
 * unit count. Seven filed Demon Slayer cours must not report `Shounen 7/14` —
 * that is exactly the inflation the collapse exists to remove, and a "made of"
 * block that reproduced it would be lying in the one place the owner goes to
 * check. A value counts once per unit, whichever of its members carry it.
 *
 * ⚠️ **The score and year RANGES are computed over entries, not units, and that
 * is not an oversight.** A min and a max are immune to duplication — filing a
 * show's four cours cannot move either bound — so collapsing them would only
 * discard evidence (a unit's members may span years, as TYBW and base Bleach
 * do).
 *
 * Client-safe (`domain/**` is in the enforced no-`fs` set) and pure, so it is
 * testable without a store and callable from either side.
 */

import type { AnimeRecord } from '@/models/anime';
import { staffRoleTier } from '@/lib/domain/staffRole';
import type { FacedUnit } from '@/lib/domain/boxUnits';

/** One shared value: what it is, and how many of the box's units carry it. */
export interface CompositionValue {
  value: string;
  /** Units carrying it — out of `BoxComposition.units`. */
  count: number;
}

export interface BoxComposition {
  /** The denominator every `count` is out of. */
  units: number;
  /** Entries behind those units — stated so a share can never be misread. */
  entries: number;
  tags: CompositionValue[];
  studios: CompositionValue[];
  /** T1 staff (director, series composition, character design, music…), by name. */
  staff: CompositionValue[];
  /** The owner's own scores across the box's members. Absent when none is scored. */
  scoreRange?: { min: number; max: number };
  yearRange?: { min: number; max: number };
  /**
   * Units carrying no AniList tag above the floor.
   *
   * The honesty line, and it belongs next to the tally rather than in a log: a
   * box of eight titles where five are tagless has a `4/8` that means something
   * quite different from one where all eight are covered. Same posture as
   * `GraphCoverage` and `/activity`'s `available: false`.
   */
  untagged: number;
}

/** How many rows a field shows. Enough to characterize an axis, not a data dump. */
const TOP_VALUES = 8;

/**
 * A value must be shared by at least this many units to be "what the box is
 * made of". A value carried by ONE unit describes that title, not the axis —
 * and on a small box the list would otherwise be its longest member's tag list.
 */
const MIN_UNITS = 2;

/** Count values across units: once per unit, whichever members carry it. */
function tally(
  units: FacedUnit[],
  byId: Map<string, AnimeRecord>,
  extract: (a: AnimeRecord) => string[]
): CompositionValue[] {
  const counts = new Map<string, number>();
  for (const unit of units) {
    const seen = new Set<string>();
    for (const id of unit.members) {
      const record = byId.get(id);
      if (!record) continue;
      for (const value of extract(record)) seen.add(value);
    }
    for (const value of seen) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= MIN_UNITS)
    // Count desc, then alphabetical — a stable order, so the block does not
    // reshuffle between two renders of the same box.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_VALUES)
    .map(([value, count]) => ({ value, count }));
}

const range = (values: number[]): { min: number; max: number } | undefined =>
  values.length === 0 ? undefined : { min: Math.min(...values), max: Math.max(...values) };

/**
 * Build the block.
 *
 * `tagMinRank` is the box ranker's `BOX_TAG_MIN_RANK`, passed in rather than
 * imported: `reco/boxes.ts` is `fs`-bound, and the two must agree — a block
 * naming tags the ranker never counted would explain a ranking that isn't
 * happening.
 */
export function buildBoxComposition(
  units: FacedUnit[],
  byId: Map<string, AnimeRecord>,
  tagMinRank: number
): BoxComposition {
  const members = units
    .flatMap(u => u.members)
    .map(id => byId.get(id))
    .filter((a): a is AnimeRecord => !!a);

  const strongTags = (a: AnimeRecord) =>
    (a.sources.anilist?.tags || []).filter(t => (t.rank ?? 0) >= tagMinRank).map(t => t.name);

  const untagged = units.filter(unit =>
    unit.members.every(id => {
      const record = byId.get(id);
      return !record || strongTags(record).length === 0;
    })
  ).length;

  const scoreRange = range(members.map(a => a.personal.score ?? 0).filter(s => s > 0));
  const yearRange = range(members.map(a => a.catalog.startSeason?.year).filter((y): y is number => !!y));

  return {
    units: units.length,
    entries: members.length,
    tags: tally(units, byId, strongTags),
    // Names, not the `catalogNameKey` the ranker matches on: this block is read,
    // not joined.
    studios: tally(units, byId, a => (a.catalog.studios || []).map(s => s.name)),
    staff: tally(units, byId, a =>
      (a.sources.anilist?.staff || []).filter(s => staffRoleTier(s.role) === 1).map(s => s.name)),
    // Absent rather than a zero range, so the page can omit the row instead of
    // rendering « 0 - 0 » for an unscored box.
    ...(scoreRange ? { scoreRange } : {}),
    ...(yearRange ? { yearRange } : {}),
    untagged,
  };
}
