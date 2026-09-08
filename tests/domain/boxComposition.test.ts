/**
 * « De quoi cette boîte est faite » — two contracts, both silent.
 *
 * Nothing here crashes when it breaks. A block that tallied ENTRIES instead of
 * units renders perfectly: `Shounen 7/14` looks like agreement, reads like
 * evidence, and is in fact one show filed seven times — the exact inflation the
 * collapse exists to remove, reproduced in the one place the owner goes to check
 * for it. And a coverage line that counted tagless ENTRIES would report a number
 * the shares it qualifies are not out of.
 *
 * Both were verified by breaking the thing they guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoxComposition } from '@/lib/domain/boxComposition';
import type { FacedUnit } from '@/lib/domain/boxUnits';
import type { AnimeRecord } from '@/models/anime';

/** Only the fields the block reads; the rest of a record is irrelevant here. */
const rec = (
  id: string,
  tags: [string, number][],
  studios: string[] = [],
  extra: { score?: number; year?: number } = {}
): AnimeRecord => ({
  id,
  crosswalk: {},
  catalog: {
    title: id,
    genres: [],
    studios: studios.map(name => ({ id: 0, name })),
    ...(extra.year ? { startSeason: { year: extra.year, season: 'spring' } } : {}),
  },
  personal: { ...(extra.score ? { score: extra.score } : {}) },
  sources: { anilist: { tags: tags.map(([name, rank]) => ({ name, rank })) } },
  provenance: { catalog: {}, personal: {} },
} as unknown as AnimeRecord);

const index = (records: AnimeRecord[]) => new Map(records.map(r => [r.id, r]));

const unit = (members: string[]): FacedUnit => ({ face: members[0], members });

test('a value is counted once per UNIT, whichever of its members carry it', () => {
  // The whole point. Four cours of one show plus one other title is TWO units,
  // so a tag they all carry reads 2/2 — never 5/5, and never 4/5 for the tag
  // only the collapsed show has.
  const records = [
    rec('a_1', [['Shounen', 90]]),
    rec('a_2', [['Shounen', 90]]),
    rec('a_3', [['Shounen', 90]]),
    rec('a_4', [['Shounen', 90]]),
    rec('a_9', [['Shounen', 90], ['Philosophy', 80]]),
  ];
  const units = [unit(['a_1', 'a_2', 'a_3', 'a_4']), unit(['a_9'])];

  const composition = buildBoxComposition(units, index(records), 60);

  assert.equal(composition.units, 2);
  assert.equal(composition.entries, 5);
  assert.deepEqual(composition.tags, [{ value: 'Shounen', count: 2 }]);
  // `Philosophy` sits on one unit only and is therefore about that title, not
  // about the axis — dropped by the two-unit floor.
  assert.equal(composition.tags.find(v => v.value === 'Philosophy'), undefined);
});

test('a unit carries a value if ANY of its members does', () => {
  // A collapsed show's cours do not all carry the same tags — TYBW's differ
  // from base Bleach's — so requiring every member would erase most of what the
  // box actually has in common.
  const records = [
    rec('a_1', [['Swordplay', 80]]),
    rec('a_2', []),
    rec('a_9', [['Swordplay', 80]]),
  ];

  const composition = buildBoxComposition([unit(['a_1', 'a_2']), unit(['a_9'])], index(records), 60);

  assert.deepEqual(composition.tags, [{ value: 'Swordplay', count: 2 }]);
});

test('the tag floor is applied, so a rank-20 descriptor is not "what the box is made of"', () => {
  // `Male Protagonist` on two units is not an axis. The ranker cuts at
  // BOX_TAG_MIN_RANK and this block must cut at the same place, or it would
  // explain a ranking that is not happening.
  const records = [
    rec('a_1', [['Male Protagonist', 20], ['Steampunk', 85]]),
    rec('a_2', [['Male Protagonist', 20], ['Steampunk', 85]]),
  ];

  const composition = buildBoxComposition([unit(['a_1']), unit(['a_2'])], index(records), 60);

  assert.deepEqual(composition.tags, [{ value: 'Steampunk', count: 2 }]);
});

test('untagged counts UNITS with no strong tag, the same denominator as the shares', () => {
  // The honesty line. `Steampunk 2/3` means something quite different when the
  // third unit carries no AniList tag at all than when it simply lacks that one.
  const records = [
    rec('a_1', [['Steampunk', 85]]),
    rec('a_2', [['Steampunk', 85]]),
    rec('a_5', []),
    rec('a_3', [['Male Protagonist', 20]]),
    rec('a_4', []),
  ];

  const composition = buildBoxComposition(
    // ⚠️ The middle unit is the one that matters: a collapsed show with ONE
    // tagged cour is covered, because a unit's tags are its members' union.
    // Counting tagless ENTRIES would report 2 here and put the coverage line on
    // a different denominator from the shares it qualifies.
    [unit(['a_1']), unit(['a_2', 'a_5']), unit(['a_3', 'a_4'])],
    index(records),
    60
  );

  assert.equal(composition.units, 3);
  // Only the third: its two members carry nothing above the floor between them.
  assert.equal(composition.untagged, 1);
});

test('the score and year RANGES are computed over entries, and that is deliberate', () => {
  // A min and a max are immune to duplication — filing four cours cannot move
  // either bound — so collapsing them would only discard evidence, since a
  // unit's members legitimately span years.
  const records = [
    rec('a_1', [], [], { score: 9, year: 2004 }),
    rec('a_2', [], [], { score: 7, year: 2022 }),
    rec('a_9', [], [], { score: 8, year: 2012 }),
  ];

  const composition = buildBoxComposition([unit(['a_1', 'a_2']), unit(['a_9'])], index(records), 60);

  assert.deepEqual(composition.scoreRange, { min: 7, max: 9 });
  assert.deepEqual(composition.yearRange, { min: 2004, max: 2022 });
});

test('an unscored box reports no range at all rather than 0-0', () => {
  const composition = buildBoxComposition([unit(['a_1'])], index([rec('a_1', [])]), 60);

  assert.equal(composition.scoreRange, undefined);
  assert.equal(composition.yearRange, undefined);
});

test('studios tally by name across units, like tags', () => {
  const records = [
    rec('a_1', [], ['Bones']),
    rec('a_2', [], ['Bones']),
    rec('a_9', [], ['Madhouse']),
  ];

  const composition = buildBoxComposition([unit(['a_1', 'a_2']), unit(['a_9'])], index(records), 60);

  // Two entries of one unit share Bones, so it is ONE unit's studio — below the
  // floor, exactly as a tag would be.
  assert.deepEqual(composition.studios, []);
});
