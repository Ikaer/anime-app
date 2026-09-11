/**
 * Collapse arithmetic for « Mes boîtes » — how many VOTES a box's members cast.
 *
 * `buildFieldProfile` weights every member `() => 1`, so N filed entries of one
 * show cast N votes. Measured on the live store that hands the biggest show 50%
 * of the vote in three of the 13 non-empty boxes, and what it drowns is the
 * giveaway: holding the exclusion set fixed, collapsing each show to one vote
 * changes 11 of the top 15 proposals for `Absolute cinema`, surfacing the box's
 * own third show (`Ghost in the Shell`, `Stand Alone Complex`, `Psycho-Pass 2`)
 * from under its Bleach and Link Click blocs.
 *
 * **The rule, and both of its restrictions are load-bearing.** For a box's
 * member set, build the connected components of "shares a DECLARED group with",
 * **restricted to members**, and weight each member `1 / componentSize`.
 *
 *  - Only groups in `box.groups` participate. Auto-applying every group wherever
 *    its members happened to land was designed first and rejected: it silently
 *    imposes a judgement made for a different box. See `Box.groups`.
 *  - Only titles in `box.members` are nodes. Counting a group's unfiled members
 *    would divide TYBW's four cours by five and make the unit sum to 0.8.
 *
 * **The invariant this buys — every unit sums to exactly one vote**, whatever
 * the group topology, and that is why it beats picking a representative.
 *
 * ⚠️ **Fractional weights, NOT a representative.** `buildFieldProfile` already
 * takes a `weightFn`, so the change is passing `a => 1 / componentSize(a)`
 * instead of `() => 1`. Electing one member per unit would throw away the tags
 * of the other cours — TYBW's would be replaced by base Bleach's. Fractional
 * weighting keeps a tag all four share at 1 and a tag unique to one cour at
 * 1/4, which is the faithful reading of what was filed.
 *
 * ⚠️ **The math merges; the DISPLAY does not.** Two overlapping declared groups
 * fuse into one unit here (otherwise the show gets two votes) and still render
 * as two cards. Math and display answer different questions and need not agree:
 * this operates on the member SET, the panes operate on groups. Do not
 * reintroduce a single-draw rule to make them line up — an earlier draft paid
 * for that assumption with an invented tie-break and a divergence marker, both
 * removed.
 *
 * Client-safe (`domain/**` is in the enforced no-`fs` set) because the
 * quick-edit panes resolve their own regions in the browser.
 */

import type { Box, UserGroup } from '@/models/anime';

/** One resolved unit: the member ids the owner declared to be one thing. */
export interface BoxUnit {
  /** Member ids forming this unit, in `box.members` order. */
  members: string[];
  /**
   * The vote each member carries — `1 / members.length`. Precomputed because
   * every caller wants it and none wants to rediscover the invariant.
   */
  weight: number;
}

export interface BoxUnitResolution {
  /** Every unit, in first-appearance order of its earliest member. */
  units: BoxUnit[];
  /** Member id → the size of its unit. Ungrouped members map to 1. */
  sizeOf: Map<string, number>;
  /** Member id → its index in `units`. */
  unitOf: Map<string, number>;
}

/**
 * Resolve a box's members into units under its DECLARED groups.
 *
 * `groups` is the global definition set; only ids in `box.groups` are read from
 * it, and an id it does not resolve is ignored — a deleted group leaves a
 * dangling declaration, which is a no-op rather than an error (`Box.groups`).
 */
export function resolveBoxUnits(box: Box, groups: UserGroup[]): BoxUnitResolution {
  const members = [...new Set(box.members)];
  const memberSet = new Set(members);

  // Union-find over member ids. Overlapping declared groups merge into one unit
  // for free, which is the only well-defined answer and — having declared both
  // — the owner's own call.
  const parent = new Map<string, string>(members.map(id => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression, so a long chain of cours is not walked twice.
    let cursor = id;
    while (parent.get(cursor) !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const declared = new Set(box.groups || []);
  if (declared.size > 0) {
    const byId = new Map(groups.map(g => [g.id, g]));
    for (const groupId of declared) {
      const group = byId.get(groupId);
      if (!group) continue;                       // deleted group: ignore
      // Restricted to members — though note the restriction is STRUCTURAL, not
      // this line's doing: `parent` is seeded from `members` and `byRoot` below
      // iterates `members`, so an unfiled sibling could not reach a bucket even
      // if it got here. What this filter actually buys is keeping non-members
      // out of the union-find at all: `find` on an unseeded id walks off the map
      // and returns `undefined`, which would then be written back as a root.
      // Same answer either way today; the difference is whether the structure
      // stays legible. (Measured — removing it changes no output, so do not
      // expect a test to catch its removal.)
      const present = group.members.filter(id => memberSet.has(id));
      for (let i = 1; i < present.length; i++) union(present[0], present[i]);
    }
  }

  const byRoot = new Map<string, string[]>();
  for (const id of members) {
    const root = find(id);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(id);
    else byRoot.set(root, [id]);
  }

  const units: BoxUnit[] = [];
  const sizeOf = new Map<string, number>();
  const unitOf = new Map<string, number>();
  for (const unitMembers of byRoot.values()) {
    const index = units.length;
    units.push({ members: unitMembers, weight: 1 / unitMembers.length });
    for (const id of unitMembers) {
      sizeOf.set(id, unitMembers.length);
      unitOf.set(id, index);
    }
  }

  return { units, sizeOf, unitOf };
}

/**
 * The `weightFn` to hand `buildFieldProfile`.
 *
 * A member the resolution does not know (it was filtered out of the ranker's
 * record set, say) weighs 1 — the pre-collapse behaviour, which is also what an
 * undeclared box gets throughout.
 */
export const unitWeightFn = (resolution: BoxUnitResolution) =>
  (anime: { id: string }): number => 1 / (resolution.sizeOf.get(anime.id) ?? 1);

/**
 * « 3 séries · 14 entrées » — the honest count, and the place §1's inflation
 * becomes visible per box and therefore fixable by judgement.
 *
 * ⚠️ Do NOT turn this into a migration that collapses existing memberships:
 * `user/boxes.json` is durable user data and the four TYBW cours may well be
 * deliberate.
 */
export const unitCount = (resolution: BoxUnitResolution): number => resolution.units.length;

/**
 * Which global groups have at least `min` of their members present in a given
 * id set — the quick-edit panes' groups region.
 *
 * ⚠️ The two panes call this over DIFFERENT group sets, on purpose. The box pane
 * passes only `box.groups`, because that region is a picture of how the ranker
 * sees the box and an undeclared group casts no collapsed vote. The source pane
 * passes every global group: nothing there is declared yet, and the region is a
 * browsing convenience whose whole point is letting one click file a whole show.
 *
 * A group with exactly one member present is deliberately excluded (`min = 2`):
 * that region's job is "here are the collapses actually happening", and a wall
 * of one-item cards would empty it of meaning. Such a title renders in the flat
 * region carrying a group chip instead.
 */
export function groupsPresentIn(
  groups: UserGroup[],
  present: Set<string>,
  min = 2
): { group: UserGroup; members: string[] }[] {
  const out: { group: UserGroup; members: string[] }[] = [];
  for (const group of groups) {
    const hit = group.members.filter(id => present.has(id));
    if (hit.length >= min) out.push({ group, members: hit });
  }
  return out;
}

/**
 * The SOURCE pane's groups region: every group with something left to file.
 *
 * A group qualifies when at least one member is still in the source (there is
 * something for « Tout ajouter » to act on) AND at least two of its members are
 * present across the source and the box together. `members` is what is LEFT —
 * the number the card counts and the click files.
 *
 * ⚠️ **Not `groupsPresentIn(groups, source)`, which is what this replaced.** That
 * counts only what is still in the source, so a PARTIALLY-FILED show vanished
 * from the region the moment its first entry went in: Black Lagoon with S1
 * filed, The Second Barrage still to file and the OVA unwatched counts one, so
 * the group rendered as nothing but a chip on the box-side title — exactly when
 * the card is the useful thing, since « Tout ajouter » there both finishes the
 * show and makes the box count it as one. Found on the live store.
 *
 * The lone-title exclusion `groupsPresentIn` exists for still holds, because it
 * is the TOTAL that must reach two: a group with one watched entry and nothing
 * filed is still a one-item card, and still stays a chip.
 */
export function groupsToFile(
  groups: UserGroup[],
  source: Set<string>,
  filed: Set<string>
): { group: UserGroup; members: string[] }[] {
  const out: { group: UserGroup; members: string[] }[] = [];
  for (const group of groups) {
    const left = group.members.filter(id => source.has(id));
    if (left.length === 0) continue;
    const here = group.members.filter(id => filed.has(id)).length;
    if (left.length + here >= 2) out.push({ group, members: left });
  }
  return out;
}

/**
 * A box's declared group ids that still name a group — the ones worth COUNTING.
 *
 * `deleteGroup` deliberately does not sweep `Box.groups` (a declaration naming a
 * deleted group is an unresolvable id the collapse simply ignores), so a raw
 * `box.groups.length` over-reports once a group has been deleted: the header
 * would say « 1 regroupement » over a box where nothing collapses. The math
 * never needed this; the two routes that echo the count do.
 */
export const liveDeclared = (declared: string[] | undefined, groups: { id: string }[]): string[] => {
  if (!declared?.length) return [];
  const known = new Set(groups.map(g => g.id));
  return declared.filter(id => known.has(id));
};

/** One unit prepared for DISPLAY: the slot's face, and everything it stands for. */
export interface FacedUnit {
  /** The member id shown on the slot — the unit's best example. */
  face: string;
  /** Every member id the slot stands for, `face` first, best-first after it. */
  members: string[];
}

/**
 * Turn a resolution into display slots, faced by each unit's best member.
 *
 * Shared rather than written twice because the landing card and the détail
 * page's présentation tab are the SAME rendering at two lengths (§6.1), and a
 * slot that faced a different title in each would read as two different boxes.
 *
 * `rank` is the display order — lower is better — which the callers build as
 * personal score desc, then insertion order. Score alone barely orders a box
 * (`Unique vibe` is nine 10s), and "what I filed first" is a serviceable proxy
 * for "best example"; both are cheap and stable, and neither needs new state.
 *
 * A member absent from `rank` has no record in the store and is dropped, so a
 * unit made entirely of dangling ids produces no slot at all — the same
 * treatment the `missing` list reports separately, rather than an empty poster.
 */
export function faceUnits(
  resolution: BoxUnitResolution,
  rank: Map<string, number>
): FacedUnit[] {
  return resolution.units
    .map(unit => {
      const members = unit.members
        .filter(id => rank.has(id))
        .sort((a, b) => rank.get(a)! - rank.get(b)!);
      return members.length > 0 ? { face: members[0], members } : null;
    })
    .filter((u): u is FacedUnit => u !== null)
    .sort((a, b) => rank.get(a.face)! - rank.get(b.face)!);
}
