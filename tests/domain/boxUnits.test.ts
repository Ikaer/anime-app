/**
 * The collapse arithmetic's contracts — every one of them a silent failure.
 *
 * Nothing here crashes when it breaks. A box whose members collapse wrongly
 * still renders, still ranks, still proposes a plausible-looking list; the only
 * symptom is that the proposals are subtly the wrong ones, which is exactly the
 * bug this module was written to fix and exactly the bug no one notices twice.
 * `scripts/probe-box.js` measures whether the ranking is any good — the question
 * that matters and the one no assertion can settle. These pin the shape.
 *
 * Each was verified by breaking the thing it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBoxUnits,
  unitWeightFn,
  unitCount,
  groupsPresentIn,
} from '@/lib/domain/boxUnits';
import type { Box, UserGroup } from '@/models/anime';

const box = (members: string[], groups?: string[]): Box => ({
  id: 'b',
  name: 'b',
  members,
  ...(groups ? { groups } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
});

const group = (id: string, members: string[]): UserGroup => ({
  id,
  name: id,
  members,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** The invariant the whole scheme was chosen for. */
const sumsPerUnit = (b: Box, gs: UserGroup[]): number[] =>
  resolveBoxUnits(b, gs).units.map(u => u.members.length * u.weight);

test('an undeclared box behaves exactly as before: every member weighs 1', () => {
  // The backwards-compat guarantee. Break it and 26 live boxes silently
  // re-rank on a collapse their owner never asked for.
  const b = box(['a_1', 'a_2', 'a_3']);
  const res = resolveBoxUnits(b, [group('bleach', ['a_1', 'a_2'])]);

  assert.equal(unitCount(res), 3);
  const w = unitWeightFn(res);
  for (const id of b.members) assert.equal(w({ id }), 1);
});

test('ONLY declared groups collapse — a global group alone does nothing', () => {
  // §4's central ruling, and auto-apply is the explicitly rejected design: a
  // broad « Gundam » group made for a mecha box would otherwise fuse 08th MS
  // Team and Iron-Blooded Orphans inside `Absolute cinema`, where they were
  // deliberately filed as two. The failure is that the owner is never asked.
  const groups = [group('bleach', ['a_1', 'a_2'])];

  assert.equal(unitCount(resolveBoxUnits(box(['a_1', 'a_2', 'a_3']), groups)), 3);
  assert.equal(unitCount(resolveBoxUnits(box(['a_1', 'a_2', 'a_3'], ['bleach']), groups)), 2);
});

test('collapse is restricted to members: an unfiled sibling does not dilute the unit', () => {
  // The hazard being pinned: counting the group's whole member list would divide
  // TYBW's four FILED cours by five, so each weighs 1/5 and the unit sums to 0.8
  // — the box quietly casting four fifths of a vote, with nothing on screen to
  // say so.
  //
  // ⚠️ Honest scope: `resolveBoxUnits` enforces this structurally (the union-find
  // is seeded from `members` and the buckets are built by iterating `members`),
  // so deleting the intersection filter inside it changes NO output — measured.
  // This asserts the contract, not that one line. What it does catch is a
  // rewrite that derives the divisor from the group instead of the component,
  // which is the shape the mistake would actually take.
  const groups = [group('bleach', ['tybw1', 'tybw2', 'tybw3', 'tybw4', 'base'])];
  const b = box(['tybw1', 'tybw2', 'tybw3', 'tybw4'], ['bleach']);
  const res = resolveBoxUnits(b, groups);

  assert.equal(unitCount(res), 1);
  const w = unitWeightFn(res);
  for (const id of b.members) assert.equal(w({ id }), 1 / 4);
  assert.deepEqual(sumsPerUnit(b, groups), [1]);
});

test('two overlapping DECLARED groups fuse into one unit', () => {
  // Otherwise the shared title's show gets two votes — the exact inflation the
  // module exists to remove, reintroduced through the back door. Having
  // declared both, the fusion is the owner's own call.
  const groups = [group('g1', ['a_1', 'a_2']), group('g2', ['a_2', 'a_3'])];
  const b = box(['a_1', 'a_2', 'a_3'], ['g1', 'g2']);
  const res = resolveBoxUnits(b, groups);

  assert.equal(unitCount(res), 1);
  assert.deepEqual([...res.units[0].members].sort(), ['a_1', 'a_2', 'a_3']);
  assert.deepEqual(sumsPerUnit(b, groups), [1]);
});

test('disjoint declared subsets stay two units — the subset case works', () => {
  // The reason a title may belong to several groups at all: the owner picks
  // different subsets of seasons depending on what the box is about. Fusing
  // these would make the feature pointless.
  const groups = [group('s1', ['a_1', 'a_2']), group('s2', ['a_3', 'a_4'])];
  const b = box(['a_1', 'a_2', 'a_3', 'a_4'], ['s1', 's2']);

  assert.equal(unitCount(resolveBoxUnits(b, groups)), 2);
  assert.deepEqual(sumsPerUnit(b, groups), [1, 1]);
});

test('every unit sums to exactly one vote, whatever the topology', () => {
  // The invariant the fractional scheme was chosen for over electing a
  // representative. A chain, an overlap, a singleton and an unfiled group at
  // once — if any shape leaks, the box's total vote silently drifts.
  const groups = [
    group('chain1', ['a_1', 'a_2']),
    group('chain2', ['a_2', 'a_3']),
    group('pair', ['a_4', 'a_5']),
    group('elsewhere', ['a_90', 'a_91']),
  ];
  const b = box(
    ['a_1', 'a_2', 'a_3', 'a_4', 'a_5', 'a_6'],
    ['chain1', 'chain2', 'pair', 'elsewhere']
  );

  for (const sum of sumsPerUnit(b, groups)) assert.equal(sum, 1);
  // {1,2,3} + {4,5} + {6}
  assert.equal(unitCount(resolveBoxUnits(b, groups)), 3);
});

test('a declared group with no filed members contributes nothing', () => {
  // The lens rule: `groups` is never a second membership list. If a declaration
  // could add members, `/mix?box=` and `computeAnchored` — which read `members`
  // alone — would disagree with the ranking, invisibly.
  const groups = [group('elsewhere', ['a_90', 'a_91'])];
  const b = box(['a_1', 'a_2'], ['elsewhere']);
  const res = resolveBoxUnits(b, groups);

  assert.equal(unitCount(res), 2);
  assert.deepEqual([...res.sizeOf.keys()].sort(), ['a_1', 'a_2']);
});

test('a declaration naming a deleted group is ignored, not an error', () => {
  // `deleteGroup` deliberately does not sweep `Box.groups`, so dangling ids are
  // the normal steady state rather than a corruption to repair.
  const b = box(['a_1', 'a_2'], ['gone', 'bleach']);
  const res = resolveBoxUnits(b, [group('bleach', ['a_1', 'a_2'])]);

  assert.equal(unitCount(res), 1);
});

test('a duplicated member id is one node, not two', () => {
  // `members` is deduped on write, but a hand-edited file or a future
  // incremental write path is one bug away from a repeat — and a duplicate
  // would be a second vote for the same title, which is the whole complaint.
  //
  // ⚠️ The count is NOT where this shows: a repeated id lands in one bucket
  // either way, so `unitCount` reads 2 with or without the dedupe. It shows in
  // the WEIGHT — the duplicate makes the bucket size 2 and halves the title's
  // vote to 0.5. Assert the weight, or this test passes on the broken version
  // (measured).
  const res = resolveBoxUnits(box(['a_1', 'a_1', 'a_2']), []);
  assert.equal(unitCount(res), 2);
  assert.equal(unitWeightFn(res)({ id: 'a_1' }), 1);
  assert.deepEqual(res.units.map(u => u.members), [['a_1'], ['a_2']]);
});

test('groupsPresentIn needs TWO members present, not one', () => {
  // The groups region's job is "here are the collapses actually happening". A
  // wall of one-item group cards empties it of that meaning, and such a title
  // belongs in the flat region carrying a chip instead.
  const groups = [group('bleach', ['a_1', 'a_2']), group('solo', ['a_1', 'a_9'])];
  const hit = groupsPresentIn(groups, new Set(['a_1', 'a_2']));

  assert.deepEqual(hit.map(h => h.group.id), ['bleach']);
  assert.deepEqual(hit[0].members, ['a_1', 'a_2']);
});
