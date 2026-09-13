/**
 * `sortLeanRows` — the quick-edit panes' « Trier par ».
 *
 * Pinned: only what fails SILENTLY. Every case still renders a full, plausible
 * pane; the owner just finds the wrong titles at the top:
 *
 *  - an unrated title read as score 0 is correct for « meilleures d'abord » and
 *    wrong for « moins bonnes d'abord », which would then open on every unrated
 *    title instead of on the lowest scores;
 *  - a title with no SIMKL watch date belongs at the foot of « Vu récemment »,
 *    not wherever a comparator returning 0 for it happens to leave it;
 *  - ties keep the input order — the server's score-then-air order IS the
 *    tie-break, so a sort that dropped it would shuffle equal scores;
 *  - « Season 10 » after « Season 2 », which a plain string compare inverts.
 *
 * Each test below was verified by breaking the thing it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortLeanRows, type LeanAnimeRow } from '@/lib/domain/leanRow';

const row = (id: string, extra: Partial<LeanAnimeRow> = {}): LeanAnimeRow => ({ id, title: id, ...extra });
const ids = (rows: LeanAnimeRow[]) => rows.map(r => r.id);

test('unrated sorts last in BOTH score directions', () => {
  const rows = [row('unrated'), row('five', { score: 5 }), row('zero', { score: 0 }), row('nine', { score: 9 })];
  assert.deepEqual(ids(sortLeanRows(rows, 'scoreDesc')), ['nine', 'five', 'unrated', 'zero']);
  assert.deepEqual(ids(sortLeanRows(rows, 'scoreAsc')), ['five', 'nine', 'unrated', 'zero']);
});

test('feed: newest first, undated last', () => {
  const rows = [
    row('undated'),
    row('old', { watchedAt: '2025-01-03T10:00:00Z' }),
    row('new', { watchedAt: '2026-09-01T21:30:00Z' }),
  ];
  assert.deepEqual(ids(sortLeanRows(rows, 'feed')), ['new', 'old', 'undated']);
});

test('ties keep the input order, and the input is not mutated', () => {
  const rows = [row('b', { score: 8 }), row('a', { score: 8 }), row('c', { score: 9 })];
  assert.deepEqual(ids(sortLeanRows(rows, 'scoreDesc')), ['c', 'b', 'a']);
  assert.deepEqual(ids(rows), ['b', 'a', 'c']);
});

test('label compares numerically, not code-point by code-point', () => {
  const rows = [row('s10', { title: 'Season 10' }), row('s2', { title: 'season 2' })];
  assert.deepEqual(ids(sortLeanRows(rows, 'label')), ['s2', 's10']);
});
