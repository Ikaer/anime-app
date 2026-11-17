/**
 * The NSFW narrowing filter — `getNsfwLevel` + `applyNarrowingFilters`' `nsfw`.
 *
 * MAL is the only provider carrying a content rating, so every AniList-only
 * title has none. Both ways of folding that absence into a real level fail
 * silently: read as `white`, "safe only" admits titles nobody rated; read as
 * excluded, "hide gray" quietly drops ~1,700 AniList-only titles from every
 * list. Hence `unknown` as its own level, which these tests hold.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNarrowingFilters, getNsfwLevel } from '@/lib/domain/animeUtils';
import type { AnimeRecord } from '@/models/anime';

function rec(id: string, nsfw: string | undefined): AnimeRecord {
  return {
    id,
    crosswalk: {},
    catalog: { title: id, nsfw } as AnimeRecord['catalog'],
    personal: {} as AnimeRecord['personal'],
    sources: {},
    provenance: {} as AnimeRecord['provenance'],
  } as AnimeRecord;
}

const ROWS = [rec('w', 'white'), rec('g', 'gray'), rec('b', 'black'), rec('al', undefined), rec('odd', 'purple')];
const ids = (rows: AnimeRecord[]) => rows.map(r => r.id);

test('a title with no MAL rating is `unknown`, never `white`', () => {
  assert.equal(getNsfwLevel(rec('x', undefined)), 'unknown');
  assert.equal(getNsfwLevel(rec('x', '')), 'unknown');
  assert.equal(getNsfwLevel(rec('x', 'purple')), 'unknown');
});

test('« white » alone does not admit unrated titles', () => {
  assert.deepEqual(ids(applyNarrowingFilters(ROWS, { nsfw: ['white'] })), ['w']);
});

test('excluding gray keeps unrated titles when `unknown` is ticked', () => {
  assert.deepEqual(ids(applyNarrowingFilters(ROWS, { nsfw: ['white', 'unknown'] })), ['w', 'al', 'odd']);
});

test('no level ticked is no filter', () => {
  assert.equal(applyNarrowingFilters(ROWS, { nsfw: [] }).length, ROWS.length);
});
