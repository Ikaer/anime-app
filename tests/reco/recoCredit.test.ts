/**
 * « Vu grâce à la reco » — the two rules that decide whether the probe tells
 * the truth about the feed, and that fail SILENTLY if dropped.
 *
 * Both failures look like a tidy-up and produce a number that reads fine: the
 * feed simply comes out better than it is. Nothing crashes, nothing warns, and
 * the only way to notice would be to already suspect it.
 *
 * Each was verified by breaking the thing it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRecoCredit, creditDay, type RecoCreditMap } from '@/lib/reco/recoCredit';
import type { AnimeRecord } from '@/models/anime';

const anime = (id: string, status?: string, score?: number): AnimeRecord => ({
  id,
  crosswalk: {},
  catalog: { title: id, genres: [], studios: [] },
  personal: { status, score },
  sources: {},
  provenance: { catalog: {}, personal: {} },
} as unknown as AnimeRecord);

const credits = (...ids: string[]): RecoCreditMap =>
  Object.fromEntries(ids.map(id => [id, { at: '2026-11-01' }]));

test('a credited title the owner never started still counts', () => {
  // ⚠️ The bucket that makes the measurement honest. Joining the credit map
  // against the watched list is the obvious tidy-up, and it would measure the
  // feed only on the titles it succeeded with — survivorship bias, after which
  // the engine looks perfect. `plan_to_watch` belongs here too: flagging a pick
  // and planning it are near enough the same act, so counting it as
  // follow-through would make every pick read as taken up.
  const all = [
    anime('never'),
    anime('planned', 'plan_to_watch'),
    anime('watching', 'watching'),
    anime('done', 'completed', 9),
  ];
  const s = summarizeRecoCredit(all, credits('never', 'planned', 'watching', 'done'));

  assert.equal(s.credited, 4);
  assert.equal(s.outcome.notStarted, 2, 'no status AND plan_to_watch are both "not started"');
  assert.equal(s.outcome.watching, 1);
  assert.equal(s.outcome.completed, 1);
});

test('a dropped title with a score stays out of the satisfaction comparison', () => {
  // A score on an abandonment is a verdict on stopping, not on the pick. Letting
  // it into `scored` would read as the feed delivering bad titles when what it
  // delivered was a title the owner chose to stop — and it would do so on
  // exactly the population where the feed is most often blamed.
  const all = [
    anime('bailed', 'dropped', 4),
    anime('loved', 'completed', 9),
  ];
  const s = summarizeRecoCredit(all, credits('bailed', 'loved'));

  assert.deepEqual(s.scored.credited, [9]);
  assert.equal(s.outcome.dropped, 1, 'it is counted — just not as a score');
});

test('the control holds every OTHER scored completion, and nothing else', () => {
  // The comparison the probe rests on. `other` must not quietly become "every
  // scored title": an uncredited drop in there would drag the control down and
  // flatter the feed, the mirror of the rule above.
  const all = [
    anime('mine', 'completed', 7),
    anime('alone', 'completed', 8),
    anime('alsoAlone', 'completed', 6),
    anime('theirDrop', 'dropped', 3),
    anime('unrated', 'completed', 0),
  ];
  const s = summarizeRecoCredit(all, credits('mine'));

  assert.deepEqual(s.scored.credited, [7]);
  assert.deepEqual(s.scored.other.sort(), [6, 8], 'scored completions only, credited one excluded');
});

test('a credited id with no record is reported, never silently dropped', () => {
  const s = summarizeRecoCredit([anime('here', 'completed', 8)], credits('here', 'gone'));
  assert.equal(s.credited, 1);
  assert.equal(s.unresolved, 1);
});

test('creditDay is the UTC calendar day, the format `at` stores', () => {
  assert.equal(creditDay(new Date('2026-11-01T23:30:00Z')), '2026-11-01');
});
