/**
 * « Où plusieurs se croisent » — the rules that fail silently.
 *
 * Each leaves a plausible list on screen: counting a crowd voice puts every
 * long-runner on top, no franchise collapse turns one casting into ten rows,
 * a sequel face sends the reader into season 3, and the noisy-OR ordering ties
 * dozens of rows that the counts still separate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCrossings, type CrossingCandidate } from '@/lib/reco/favSeiyuuCrossings';
import type { FavSeiyuuHit, SeiyuuRole } from '@/lib/reco/favSeiyuu';

const hit = (staffId: number, role: SeiyuuRole): FavSeiyuuHit => ({ staffId, name: `p${staffId}`, role, characters: [] });

const cand = (id: string, roles: SeiyuuRole[], over: Partial<CrossingCandidate> = {}): CrossingCandidate => ({
  id,
  hits: roles.map((r, i) => hit(i + 1, r)),
  mediaType: 'tv',
  startDate: '2020-01-01',
  mean: 7,
  franchiseKey: id,
  sequel: false,
  ...over,
});

test('a BACKGROUND role is not a crossing, and one person is not enough', () => {
  const rows = findCrossings([
    cand('a', ['MAIN', 'BACKGROUND']),
    cand('b', ['MAIN']),
    cand('c', ['SUPPORTING', 'SUPPORTING']),
  ]);
  assert.deepEqual(rows.map(r => r.id), ['c']);
  assert.equal(rows[0].count, 2);
});

test('a BACKGROUND role is dropped from the people shown, not only from the count', () => {
  const [row] = findCrossings([cand('a', ['MAIN', 'SUPPORTING', 'BACKGROUND'])]);
  assert.deepEqual(row.hits.map(h => h.role), ['MAIN', 'SUPPORTING']);
});

test('one row per franchise, counting the entries folded into it', () => {
  const rows = findCrossings([
    cand('s1', ['MAIN', 'MAIN'], { franchiseKey: 'f' }),
    cand('s2', ['MAIN', 'MAIN'], { franchiseKey: 'f', startDate: '2022' }),
    cand('petit', ['MAIN', 'SUPPORTING'], { franchiseKey: 'f' }),
    cand('other', ['MAIN', 'SUPPORTING']),
  ]);
  assert.equal(rows.length, 2);
  const f = rows.find(r => r.id === 's1')!;
  assert.equal(f.others, 2);
});

test('the face is an entry point even when a sequel has more leads', () => {
  const [row] = findCrossings([
    cand('q3', ['MAIN', 'MAIN', 'MAIN'], { franchiseKey: 'q', sequel: true }),
    cand('q1', ['MAIN', 'MAIN'], { franchiseKey: 'q' }),
  ]);
  assert.equal(row.id, 'q1');
  assert.equal(row.sequel, false);
});

test('a franchise whose only crossing is a sequel is still listed, and says so', () => {
  const [row] = findCrossings([cand('s2', ['MAIN', 'MAIN'], { sequel: true })]);
  assert.equal(row.id, 's2');
  assert.equal(row.sequel, true);
});

test('the face is the earliest aired entry even when a later one has more leads, undated last', () => {
  const [row] = findCrossings([
    cand('undated', ['MAIN', 'MAIN', 'MAIN'], { franchiseKey: 'f', startDate: undefined }),
    cand('dateMovie', ['MAIN', 'MAIN', 'MAIN'], { franchiseKey: 'f', startDate: '2020-07' }),
    cand('tvS1', ['MAIN', 'SUPPORTING', 'SUPPORTING'], { franchiseKey: 'f', startDate: '2020-07-11' }),
  ]);
  // '2020-07' sorts before '2020-07-11' as a string — a month-precision date is
  // the earlier claim, which is fine; what matters is the undated one never wins.
  assert.equal(row.id, 'dateMovie');
  const [row2] = findCrossings([
    cand('undated', ['MAIN', 'MAIN', 'MAIN'], { franchiseKey: 'g', startDate: undefined }),
    cand('tvS1', ['MAIN', 'SUPPORTING'], { franchiseKey: 'g', startDate: '2020-07-11' }),
    cand('movie', ['MAIN', 'MAIN', 'MAIN'], { franchiseKey: 'g', startDate: '2022-01-01' }),
  ]);
  assert.equal(row2.id, 'tvS1');
});

test('the row carries the union of people at their best role, and ranks on it', () => {
  const tv: CrossingCandidate = { ...cand('tv', []), franchiseKey: 'f', startDate: '2020',
    hits: [hit(1, 'MAIN'), hit(2, 'SUPPORTING')] };
  const movie: CrossingCandidate = { ...cand('movie', []), franchiseKey: 'f', startDate: '2022',
    hits: [hit(1, 'MAIN'), hit(2, 'MAIN'), hit(3, 'SUPPORTING')] };
  const rival = cand('rival', ['MAIN', 'MAIN'], { mean: 9 });
  const rows = findCrossings([tv, movie, rival]);
  assert.equal(rows[0].id, 'tv');
  assert.equal(rows[0].main, 2);
  assert.equal(rows[0].count, 3);
  assert.deepEqual(rows[0].hits.map(h => `${h.staffId}:${h.role}`), ['1:MAIN', '2:MAIN', '3:SUPPORTING']);
});

test('ordered by leads then people — where the noisy-OR would tie', () => {
  const rows = findCrossings([
    cand('twoLeads', ['MAIN', 'MAIN'], { mean: 9 }),
    cand('threeLeads', ['MAIN', 'MAIN', 'MAIN'], { mean: 6 }),
    cand('twoLeadsPlus', ['MAIN', 'MAIN', 'SUPPORTING'], { mean: 5 }),
    cand('twoLeadsLowMean', ['MAIN', 'MAIN'], { mean: 6 }),
    // More people, fewer leads: four supporting voices do not outrank two leads.
    cand('oneLeadManySupp', ['MAIN', 'SUPPORTING', 'SUPPORTING', 'SUPPORTING'], { mean: 9 }),
  ]);
  assert.deepEqual(rows.map(r => r.id), ['threeLeads', 'twoLeadsPlus', 'twoLeads', 'twoLeadsLowMean', 'oneLeadManySupp']);
});

test('PVs, CMs and music videos are never rows', () => {
  const rows = findCrossings([
    cand('pv', ['MAIN', 'MAIN'], { mediaType: 'pv' }),
    cand('cm', ['MAIN', 'MAIN'], { mediaType: 'cm' }),
    cand('mv', ['MAIN', 'MAIN'], { mediaType: 'music' }),
    cand('movie', ['MAIN', 'MAIN'], { mediaType: 'movie' }),
  ]);
  assert.deepEqual(rows.map(r => r.id), ['movie']);
});
