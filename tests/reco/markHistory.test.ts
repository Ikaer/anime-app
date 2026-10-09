/**
 * The mark history's timing rules — every one of them fails SILENTLY: a wrong
 * rule writes a plausible-looking point on the wrong day, and the file it lands
 * in is the one thing in the store that cannot be rebuilt afterwards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureMarks, isPreAir, EP3_DAY_OFFSET, EP3_WINDOW_DAYS, type MarkHistory } from '@/lib/reco/markHistory';
import type { AffinityIndex } from '@/lib/reco/affinity';
import type { AnimeRecord } from '@/models/anime';

const anime = (id: string, f: { start?: string; mean?: number; airing?: string; status?: string; score?: number } = {}): AnimeRecord => ({
  id,
  crosswalk: {},
  catalog: { title: id, genres: [], studios: [], startDate: f.start, mean: f.mean, airingStatus: f.airing },
  personal: { status: f.status, score: f.score },
  sources: { anilist: { tags: [{ name: 't', rank: 80, category: 'x' }], staff: [] } },
  provenance: { catalog: {}, personal: {} },
} as unknown as AnimeRecord);

/** Every title scores by its id's length — enough to tell two captures apart. */
const index = (bump = 0): AffinityIndex => ({
  scores: new Map(),
  marks: new Map(),
  thresholds: { strong: 100, notable: 0 },
  coverage: { scoreable: 0, unseen: 0 },
  seedCount: 1,
  scoreOf: a => a.id.length + bump,
  percentileOf: () => 0.5,
});

const at = (day: string) => ({ now: new Date(`${day}T02:00:00Z`), downIds: new Set<string>() });

test('first is written once; preAir follows the title until it airs', () => {
  const show = anime('show', { start: '2026-10-20' });
  const t1 = captureMarks([show], index(0), {}, at('2026-09-01')).history;
  const t2 = captureMarks([show], index(5), t1, at('2026-10-19')).history;
  assert.equal(t2.show.first?.at, '2026-09-01');
  assert.equal(t2.show.first?.score, 4);
  assert.equal(t2.show.preAir?.at, '2026-10-19');
  assert.equal(t2.show.preAir?.score, 9);

  // Aired: preAir freezes on its last pre-air value.
  const aired = anime('show', { start: '2026-10-20', mean: 7.5 });
  const t3 = captureMarks([aired], index(50), t2, at('2026-10-25')).history;
  assert.equal(t3.show.preAir?.at, '2026-10-19');
});

test('ep3 is taken at J+21 and never rewritten', () => {
  const show = anime('show', { start: '2026-10-01', mean: 7.9 });
  const before = captureMarks([show], index(), {}, at('2026-10-21')).history;
  assert.equal(before.show, undefined, 'J+20 is too early');

  const t1 = captureMarks([show], index(), {}, at('2026-10-22')).history;
  assert.equal(t1.show.ep3?.day, EP3_DAY_OFFSET);
  const t2 = captureMarks([show], index(9), t1, at('2026-10-23')).history;
  assert.equal(t2.show.ep3?.at, '2026-10-22');
});

test('a title that aired long before capture started gets no fake J+21', () => {
  const old = anime('old', { start: '2024-04-01', mean: 8 });
  assert.equal(captureMarks([old], index(), {}, at('2026-10-09')).history.old, undefined);

  const late = anime('late', { start: '2026-09-01', mean: 8 });
  const day = EP3_DAY_OFFSET + EP3_WINDOW_DAYS + 1;
  const now = new Date(Date.parse('2026-09-01T02:00:00Z') + day * 86_400_000);
  assert.equal(captureMarks([late], index(), {}, { now, downIds: new Set() }).history.late, undefined);
});

test('an imprecise start date never anchors J+21', () => {
  // Date.parse('2026-09') is Sept 1st — this is what the regex is for.
  const vague = anime('vague', { start: '2026-09', mean: 7 });
  assert.equal(captureMarks([vague], index(), {}, at('2026-09-22')).history.vague, undefined);
});

test('pre-air reads the date at its own precision, and a past precise date beats a stale status', () => {
  assert.equal(isPreAir(anime('a', { start: '2026-10' }), '2026-10-09'), true);
  assert.equal(isPreAir(anime('a', { start: '2026-09' }), '2026-10-09'), false);
  assert.equal(isPreAir(anime('a', { start: '2026-10-01', airing: 'not_yet_aired' }), '2026-10-09'), false);
  assert.equal(isPreAir(anime('a', {}), '2026-10-09'), true);
  assert.equal(isPreAir(anime('a', { start: '2027-01-01', airing: 'currently_airing' }), '2026-10-09'), false);
});

test('seen titles get no pre-air point, and the input history is not mutated', () => {
  const seen = anime('seen', { start: '2026-12-01', status: 'completed', score: 9 });
  const fresh = anime('fresh', { start: '2026-12-01' });
  const input: MarkHistory = {};
  const out = captureMarks([seen, fresh], index(), input, at('2026-10-09')).history;
  assert.equal(out.seen, undefined);
  assert.ok(out.fresh?.first);
  assert.deepEqual(input, {});
});
