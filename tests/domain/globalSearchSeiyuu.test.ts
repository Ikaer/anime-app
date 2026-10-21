/**
 * `searchCatalog`'s seiyuu group — what fails SILENTLY there.
 *
 * A missing seiyuu is not an error anywhere: the header box just shows no row,
 * which reads exactly like "nobody by that name". Three rules, each verified by
 * breaking it first:
 *
 *  1. The filmography slice is read, not only the cast slice. The cast slice
 *     covers ~the owner's own list, so a seiyuu met through a filmography alone
 *     (a favourite, a page reached from a credit) would be unfindable.
 *  2. A seiyuu counts once per TITLE — voicing twins, or a character and its
 *     child self, is one anime — and the filmography's count wins when known.
 *  3. Family-first order matches: `Kiyoto Arisa` finds AniList's `Arisa Kiyoto`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchCatalog } from '@/lib/domain/globalSearch';
import type { AniListCastEntry, AniListSeiyuuEntry } from '@/models/anime';

const va = (id: number, name: string) => ({ id, name });
const castEntry = (characters: Array<{ id: number; voiceActors: Array<{ id: number; name: string }> }>): AniListCastEntry => ({
  anilist_id: 1,
  characters: characters.map(c => ({ ...c, name: `c${c.id}`, role: 'SUPPORTING' })),
  studios: [],
  fetched_at: '2026-10-20T19:00:00Z',
});
const filmography = (staff_id: number, name: string, credits: number): AniListSeiyuuEntry => ({
  staff_id,
  name,
  credits: Array.from({ length: credits }, (_, i) => ({ anilist_id: i + 1, characters: [] })) as AniListSeiyuuEntry['credits'],
  complete: true,
  fetched_at: '2026-10-20T19:00:00Z',
});

const CAST: Record<string, AniListCastEntry> = {
  a_1: castEntry([{ id: 1, voiceActors: [va(10, 'Arisa Kiyoto')] }, { id: 2, voiceActors: [va(10, 'Arisa Kiyoto')] }]),
  a_2: castEntry([{ id: 3, voiceActors: [va(10, 'Arisa Kiyoto')] }]),
};

const seiyuu = (q: string, filmographies: Record<string, AniListSeiyuuEntry> = {}) =>
  searchCatalog(q, [], 'romaji', { cast: CAST, filmographies }).seiyuu;

test('a seiyuu known only from the filmography slice is found', () => {
  const hits = seiyuu('tomoko', { '20': filmography(20, 'Tomoko Kaneda', 5) });
  assert.deepEqual(hits.map(h => h.id), [20]);
});

test('counted once per title, and the filmography count wins when known', () => {
  // Two characters on a_1, one on a_2: two titles, not three.
  assert.equal(seiyuu('arisa')[0].count, 2);
  assert.equal(seiyuu('arisa', { '10': filmography(10, 'Arisa Kiyoto', 40) })[0].count, 40);
});

test('family-first order finds the given-family name', () => {
  assert.deepEqual(seiyuu('kiyoto arisa').map(h => h.id), [10]);
});

test('no people source, no seiyuu group', () => {
  assert.deepEqual(searchCatalog('arisa', [], 'romaji').seiyuu, []);
});
