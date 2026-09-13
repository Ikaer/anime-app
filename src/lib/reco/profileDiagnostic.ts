/**
 * The §8 diagnostic — per staff craft family, how many people the anchor set
 * credits and how many of them recur across two or more of its UNITS
 * (docs/recoProfiles/DESIGN.md §2, §8).
 *
 * ⚠️ **The cheapest defence in the design, and not optional.** A craft slider on
 * a small box is a RETRIEVAL knob: with three shows the family profile is a
 * lookup table of eight people, and cranking it means "more by these people",
 * not "the box is about direction". Measured: on the three boxes the owner named
 * as the motivating cases, no person recurred across two shows in any family —
 * the apparent recurrence was one show's cours. Without this block the failure
 * is invisible and confident, so the profile page must print it beside the
 * sliders. This module computes it; the sentence is the page's (phase 6).
 *
 * ⚠️ **Across UNITS, never entries.** Four cours of one show credit the same
 * director four times; counted by entry that reads as a recurring director and
 * a learned axis, when it is one show. The caller hands in the box's DECLARED
 * units (`resolveBoxUnits`) — the collapse the ranker weights by — so the
 * diagnostic and the ranking cannot disagree about what a "show" is. PLAN.md
 * phase 1 measured the relation-graph proxy disagreeing with the owner's groups
 * in both directions, which is why it is not used here. Pinned.
 *
 * Pure and client-safe: `scripts/probe-profile.js --box` prints it, the preview
 * route ships it, and neither carries a copy.
 */

import type { AnimeRecord } from '@/models/anime';
import { STAFF_FAMILIES, STAFF_FAMILY_EXTRACTORS, familyCredits, type StaffFamily } from '@/lib/reco/staffFields';

/**
 * - `empty` — the anchors credit nobody in this family: the slider moves nothing.
 * - `retrieval` — people, but none shared by two units: "more by these people".
 * - `axis` — at least one person recurs across units: the box agrees on someone.
 */
export type FamilyVerdict = 'empty' | 'retrieval' | 'axis';

/** Recurring people listed per family — enough to name the axis, not a roster. */
const SHARED_LIMIT = 5;

export interface FamilyDiagnostic {
  family: StaffFamily;
  /** Distinct people the anchors credit in this family. */
  people: number;
  /** Of those, how many are credited on two or more UNITS. */
  recurring: number;
  verdict: FamilyVerdict;
  /** The recurring people, most units first — the axis, named. */
  shared: { id: number; name: string; units: number }[];
}

export interface ProfileDiagnostic {
  /** Units the anchor set collapses to — the regime: ~3 is a lookup table, ~7+ starts to agree. */
  units: number;
  /** Entries across those units, for the "N séries · M entrées" honesty the box card already prints. */
  entries: number;
  families: FamilyDiagnostic[];
}

/** `units` = the anchor set's units, each the records it collapses (missing ids already dropped). */
export function diagnoseFamilies(units: AnimeRecord[][]): ProfileDiagnostic {
  const present = units.filter(u => u.length > 0);
  const titles = present.flat();

  const families = STAFF_FAMILIES.map((family): FamilyDiagnostic => {
    /** person id → the units crediting them */
    const unitsOf = new Map<number, Set<number>>();
    present.forEach((unit, index) => {
      for (const title of unit) {
        for (const person of STAFF_FAMILY_EXTRACTORS[family](title)) {
          const id = person as number;
          let seen = unitsOf.get(id);
          if (!seen) { seen = new Set(); unitsOf.set(id, seen); }
          seen.add(index);
        }
      }
    });

    const names = familyCredits(titles, family);
    const shared = [...unitsOf.entries()]
      .filter(([, u]) => u.size >= 2)
      .map(([id, u]) => ({ id, name: names.get(id)?.name.trim() || `#${id}`, units: u.size }))
      .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name));
    const people = unitsOf.size;
    return {
      family,
      people,
      recurring: shared.length,
      verdict: people === 0 ? 'empty' : shared.length === 0 ? 'retrieval' : 'axis',
      shared: shared.slice(0, SHARED_LIMIT),
    };
  });

  return { units: present.length, entries: titles.length, families };
}
