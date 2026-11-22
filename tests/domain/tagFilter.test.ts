/**
 * The AniList tag filter — `domain/tagVocabulary.ts` + `applyNarrowingFilters`.
 *
 * Both failures render a sidebar that looks right:
 *  - a weak tag admitted (no rank floor) puts a show under « Tragedy » because
 *    one episode was sad — nothing on screen says the match was rank 20;
 *  - the vocabulary counting tags at EVERY rank while the filter keeps the
 *    floor makes each count overstate its result, and offers tags that exist
 *    only below the floor and so match nothing at all.
 * Each test was verified by breaking the thing it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNarrowingFilters } from '@/lib/domain/animeUtils';
import { getTagVocabulary, tagGroup, TAG_FILTER_MIN_RANK } from '@/lib/domain/tagVocabulary';
import type { AnimeRecord, AniListTagEntry } from '@/models/anime';

function rec(id: string, tags?: AniListTagEntry[]): AnimeRecord {
  return {
    id,
    crosswalk: {},
    catalog: { title: id, genres: [] } as unknown as AnimeRecord['catalog'],
    personal: {} as AnimeRecord['personal'],
    sources: tags ? { anilist: { tags } } : {},
    provenance: {},
  } as unknown as AnimeRecord;
}

const tag = (name: string, rank: number, category = 'Theme-Drama'): AniListTagEntry => ({ name, rank, category });

const ROWS = [
  rec('strong', [tag('Tragedy', 90), tag('Time Manipulation', 70, 'Theme-Sci-Fi')]),
  rec('weak', [tag('Tragedy', TAG_FILTER_MIN_RANK - 1), tag('Time Manipulation', 80, 'Theme-Sci-Fi')]),
  rec('floor', [tag('Tragedy', TAG_FILTER_MIN_RANK)]),
  rec('untagged'),
  rec('onlyWeak', [tag('Cameo', 10, 'Cast-Traits')]),
];

const ids = (rows: AnimeRecord[]) => rows.map(r => r.id).sort();

test('a tag below the rank floor does not match; at the floor it does', () => {
  assert.deepEqual(ids(applyNarrowingFilters(ROWS, { tags: ['Tragedy'] })), ['floor', 'strong']);
});

test('tags are AND-ed, and an untagged title matches no tag filter', () => {
  assert.deepEqual(ids(applyNarrowingFilters(ROWS, { tags: ['Tragedy', 'Time Manipulation'] })), ['strong']);
  assert.deepEqual(ids(applyNarrowingFilters(ROWS, { tags: [] })).length, ROWS.length);
});

test('every vocabulary count equals what filtering on that tag returns', () => {
  const v = getTagVocabulary(ROWS);
  const facets = Object.values(v.groups).flat();
  assert.ok(facets.length > 0);
  for (const f of facets) {
    assert.equal(applyNarrowingFilters(ROWS, { tags: [f.name] }).length, f.count, f.name);
  }
  // Present only below the floor: never offered.
  assert.ok(!facets.some(f => f.name === 'Cameo'));
});

test('groups come from the top-level AniList category, unknown ones fall through', () => {
  assert.equal(tagGroup('Theme-Sci-Fi-Mecha'), 'theme');
  assert.equal(tagGroup('Sexual Content'), 'sexual');
  assert.equal(tagGroup('Cast-Main Cast'), 'cast');
  assert.equal(tagGroup(undefined), 'other');
  assert.equal(tagGroup('Brand New Category'), 'other');
});
