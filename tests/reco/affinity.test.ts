/**
 * The « Recommandé » mark's contracts — the parts `scripts/probe-affinity.js`
 * cannot catch.
 *
 * The probe measures whether the RANKING is any good, which is the question
 * that matters and the one no assertion can settle (the ranking is meant to
 * move). What it cannot notice is the mark quietly firing on the wrong
 * population: every failure below leaves a plausible-looking badge on screen,
 * a green build, and a probe whose numbers barely twitch.
 *
 * Each of these was verified by breaking the thing it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAffinityIndex,
  buildAnticipationIndex,
  AFFINITY_TIER_PERCENTILE,
} from '@/lib/reco/affinity';
import { flooredFieldMatch, type FieldProfile, type FieldValue } from '@/lib/reco/scoring';
import type { AnimeRecord, SeasonName } from '@/models/anime';

interface Fixture {
  status?: string;
  score?: number;
  genres?: string[];
  tags?: string[];
  hidden?: boolean;
  mean?: number;
  users?: number;
  season?: { year: number; season: SeasonName };
}

const anime = (id: string, f: Fixture = {}): AnimeRecord => ({
  id,
  crosswalk: {},
  catalog: {
    title: id,
    genres: (f.genres ?? []).map(name => ({ id: 0, name })),
    studios: [],
    mean: f.mean,
    numListUsers: f.users,
    startSeason: f.season,
  },
  personal: { status: f.status, score: f.score },
  sources: f.tags
    ? { anilist: { tags: f.tags.map(name => ({ name, rank: 80, category: 'x' })), staff: [] } }
    : {},
  provenance: { catalog: {}, personal: {} },
  hidden: f.hidden,
} as unknown as AnimeRecord);

/** A seed set that makes `Action`+`sf` the owner's taste. */
const seeds = () => [
  anime('seed1', { status: 'completed', score: 9, genres: ['Action'], tags: ['Space'] }),
  anime('seed2', { status: 'completed', score: 10, genres: ['Action'], tags: ['Space'] }),
];

test('an unseen title with no AniList entry is never marked, and never counted in the bar', () => {
  // ⚠️ The threshold is a percentile of the SCOREABLE population. Counting the
  // metadata-less rows would put the cut inside a block of zeros: on the live
  // store ~40% of unseen rows have no AniList entry, so a p90 over all of them
  // lands at 0 and every scoreable title gets a badge. Silent, and catastrophic
  // for what the badge asserts.
  const all = [
    ...seeds(),
    ...Array.from({ length: 40 }, (_, i) => anime(`bare${i}`)),
    anime('rich', { genres: ['Action'], tags: ['Space'] }),
  ];
  const index = buildAffinityIndex(all);

  assert.equal(index.coverage.scoreable, 1, 'only the AniList-backed row is scoreable');
  assert.equal(index.coverage.unseen, 41, 'the bare rows still count as unseen — that is the coverage gap');
  for (let i = 0; i < 40; i++) {
    assert.equal(index.marks.has(`bare${i}`), false);
    assert.equal(index.scores.has(`bare${i}`), false);
  }
  assert.ok(index.thresholds.notable > 0, 'the bar must be a real score, not a floor of zeros');
});

test('the mark is for unseen, unhidden, un-thumbed-down titles only', () => {
  const all = [
    ...seeds(),
    anime('seen', { status: 'completed', score: 6, genres: ['Action'], tags: ['Space'] }),
    anime('planned', { status: 'plan_to_watch', genres: ['Action'], tags: ['Space'] }),
    anime('hidden', { hidden: true, genres: ['Action'], tags: ['Space'] }),
    anime('down', { genres: ['Action'], tags: ['Space'] }),
    anime('fresh', { genres: ['Action'], tags: ['Space'] }),
  ];
  const index = buildAffinityIndex(all, { downIds: new Set(['down']) });

  assert.equal(index.marks.has('fresh'), true, 'the eligible one is marked');
  // `plan_to_watch` is NOT a status you have judged the show by — it stays
  // eligible, the same reading `/mix`'s excludeSeen uses.
  assert.equal(index.marks.has('planned'), true);
  for (const id of ['seen', 'hidden', 'down']) {
    assert.equal(index.marks.has(id), false, `${id} must not be marked`);
    assert.equal(index.scores.has(id), false, `${id} must not be scored`);
  }
});

test('no seeds, no marks — an empty taste profile badges nothing', () => {
  // Otherwise a fresh install badges whatever the IDF happens to favour, which
  // reads exactly like a recommendation and is not one.
  const index = buildAffinityIndex([anime('a', { genres: ['Action'], tags: ['Space'] })]);
  assert.equal(index.seedCount, 0);
  assert.equal(index.marks.size, 0);
  assert.equal(index.scores.size, 0);
});

test('strong is a strictly higher bar than notable', () => {
  assert.ok(AFFINITY_TIER_PERCENTILE.strong > AFFINITY_TIER_PERCENTILE.notable);
  const all = [
    ...seeds(),
    ...Array.from({ length: 50 }, (_, i) =>
      anime(`c${i}`, { genres: i < 25 ? ['Action'] : ['Comedy'], tags: i % 3 === 0 ? ['Space'] : ['Cooking'] })),
  ];
  const index = buildAffinityIndex(all);
  assert.ok(index.thresholds.strong >= index.thresholds.notable);
  for (const [id, mark] of index.marks) {
    const score = index.scores.get(id)!;
    assert.equal(mark.tier, score >= index.thresholds.strong ? 'strong' : 'notable');
  }
});

test('the denominator floor keeps a one-tag title from scoring a perfect match', () => {
  // The *LONA* lesson from the box ranker, which this ranker inherits and needs
  // more: season-start titles carry a median of ONE tag above the rank floor,
  // so without the floor the thinnest entries would monopolise the badge.
  const profile: FieldProfile = {
    weights: new Map<FieldValue, number>([['Space', 1]]),
    extract: a => (a.sources.anilist?.tags || []).map(t => t.name),
  };
  const sparse = anime('sparse', { tags: ['Space'] });
  const rich = anime('rich', { tags: ['Space', 'Mecha', 'Drama', 'Comedy'] });

  assert.equal(flooredFieldMatch(sparse, profile, 1).score, 1, 'no floor: one tag is a perfect match');
  assert.equal(flooredFieldMatch(sparse, profile, 10).score, 0.1, 'floored: one tag of an expected ten');
  assert.equal(flooredFieldMatch(rich, profile, 10).score, 0.1, 'the well-covered title is unchanged by the floor');
});

test('anticipation ranks inside one season and never lands on a rated title', () => {
  // ⚠️ Member counts are a present-day snapshot that grows with a title's age,
  // so ranking across seasons would measure age, not hype. And once a mean
  // exists the count stops being anticipation and becomes success.
  const winter = (n: number, users: number, mean?: number) =>
    anime(`w${n}`, { users, mean, season: { year: 2026, season: 'winter' } });
  const all = [
    ...Array.from({ length: 10 }, (_, i) => winter(i, (i + 1) * 1000)),
    winter(99, 999_999, 8.5),
    // A cohort too small to carry a distribution: a percentile over three rows
    // is not a claim about hype.
    anime('lonely', { users: 500_000, season: { year: 2027, season: 'fall' } }),
  ];
  const index = buildAnticipationIndex(all);

  assert.equal(index.get('w9')!.rank, 1, 'the most-listed unrated title of its season leads');
  assert.equal(index.get('w9')!.cohort, 10, 'the rated title is not in the cohort');
  assert.equal(index.get('w9')!.percentile, 1);
  assert.equal(index.get('w0')!.rank, 10);
  assert.equal(index.has('w99'), false, 'a title with a mean has a score to show instead');
  assert.equal(index.has('lonely'), false, 'a cohort below the minimum reports nothing');
});
