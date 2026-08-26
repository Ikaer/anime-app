/**
 * The reco kernel's arithmetic — the parts a backtest cannot falsify.
 *
 * `scripts/backtest-reco.js` is how a ranking CHANGE is justified, and nothing
 * here replaces it: there is no ground truth for whether a weight is right.
 * What a backtest also cannot do is notice that a helper silently stopped
 * spanning [0,1], or that a netted profile stopped netting — those move the
 * numbers without moving them enough to look wrong, and every knob downstream
 * quietly changes meaning.
 *
 * So: contracts, not rankings. Nothing here asserts an ordering of titles, and
 * nothing pins a weight — those are meant to move.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  popularityScale, fieldMatch, computeIdf, computeIdfSet,
  buildDiscriminativeProfiles, TUNING, FIELD_EXTRACTORS,
  type FieldProfile,
} from '@/lib/reco/scoring';
import type { AnimeRecord } from '@/models/anime';

interface Fixture {
  status?: string;
  score?: number;
  genres?: string[];
}

const anime = (id: string, f: Fixture = {}): AnimeRecord => ({
  id,
  crosswalk: {},
  catalog: {
    genres: (f.genres ?? []).map(name => ({ id: 0, name })),
    studios: [],
  },
  personal: { status: f.status, score: f.score },
  sources: {},
  provenance: { catalog: {}, personal: {} },
} as unknown as AnimeRecord);

// ---------------------------------------------------------------------------
// popularityScale
// ---------------------------------------------------------------------------

/**
 * ⚠️ The regression this function exists to prevent. It used to be
 * `log10(users)/log10(maxUsers)` — a ratio, not a normalization. A candidate
 * pool is built of titles the crowd already recommends, so its members sit
 * within about one order of magnitude of each other: the value never left
 * [0.488, 1.000] (IQR 0.107), and the -0.15 weight acted as a near-constant
 * offset applied to everything rather than a penalty that discriminated.
 *
 * Subtracting the pool floor is the fix, and `scale(min) === 0` is the whole
 * assertion — the old form could not produce 0 for any real input.
 */
test('popularityScale spans the full [0,1] range across the pool', () => {
  const scale = popularityScale(1_000, 1_000_000);
  assert.equal(scale(1_000), 0, 'the least popular title in the pool must score 0');
  assert.equal(scale(1_000_000), 1, 'the most popular must score 1');
  assert.ok(scale(100_000) > 0 && scale(100_000) < 1);
});

test('popularityScale is monotonic in users', () => {
  const scale = popularityScale(1_000, 1_000_000);
  const points = [1_000, 10_000, 100_000, 500_000, 1_000_000].map(scale);
  for (let i = 1; i < points.length; i++) {
    assert.ok(points[i] > points[i - 1], `not increasing at index ${i}`);
  }
});

/** No spread means nothing to penalize; a flat 0 is neutral, NaN is not. */
test('popularityScale returns a flat 0 for a degenerate pool', () => {
  for (const scale of [popularityScale(500, 500), popularityScale(0, 0), popularityScale(900, 100)]) {
    for (const users of [0, 500, 10_000]) {
      assert.equal(scale(users), 0);
    }
  }
});

/** `POPULARITY_FLOOR` clamps the log input, so a 0-member title is not -Infinity. */
test('popularityScale never returns a non-finite value', () => {
  const scale = popularityScale(0, 2_000_000);
  for (const users of [0, 1, TUNING.POPULARITY_FLOOR, 5_000_000]) {
    assert.ok(Number.isFinite(scale(users)), `users=${users}`);
  }
});

// ---------------------------------------------------------------------------
// fieldMatch
// ---------------------------------------------------------------------------

const genreProfile = (weights: Record<string, number>): FieldProfile => ({
  weights: new Map(Object.entries(weights)),
  extract: FIELD_EXTRACTORS.genre,
});

/**
 * ⚠️ `fieldMatch` divides by the CANDIDATE's value count, and that division is
 * why several calibrations elsewhere exist: it is the reason the negative staff
 * profile is narrowed to T1 (a series composer drowns among ~40 credits), and
 * the reason `/boxes` demotes `studio` to 0.05 (a near-binary field scores ~1.0
 * against a tag hit's ~0.4). Remove the denominator and every one of those
 * silently becomes wrong while every test about them still passes.
 */
test('fieldMatch divides by the candidate value count, so a match dilutes', () => {
  const profile = genreProfile({ hit: 1 });

  const focused = fieldMatch(anime('a', { genres: ['hit'] }), profile);
  const diluted = fieldMatch(anime('b', { genres: ['hit', 'x', 'y', 'z', 'w'] }), profile);

  assert.equal(focused.score, 1);
  assert.equal(diluted.score, 0.2);
  assert.deepEqual(diluted.matched, ['hit'], 'only weighted values count as matched');
});

/** 0/0 is the shape that would otherwise put NaN into an additive score sum. */
test('fieldMatch returns 0, not NaN, for a candidate with no values', () => {
  const result = fieldMatch(anime('a', { genres: [] }), genreProfile({ hit: 1 }));
  assert.equal(result.score, 0);
  assert.deepEqual(result.matched, []);
});

// ---------------------------------------------------------------------------
// IDF
// ---------------------------------------------------------------------------

/** The lever that makes a ~6-value field and a ~1000-value field comparable. */
test('computeIdf weights a rare value above a ubiquitous one', () => {
  const corpus = [
    anime('a', { genres: ['common', 'rare'] }),
    anime('b', { genres: ['common'] }),
    anime('c', { genres: ['common'] }),
    anime('d', { genres: ['common'] }),
  ];
  const idf = computeIdf(corpus, FIELD_EXTRACTORS.genre);
  assert.ok((idf.get('rare') ?? 0) > (idf.get('common') ?? 0));
});

// ---------------------------------------------------------------------------
// Discriminative netting
// ---------------------------------------------------------------------------

/**
 * ⚠️ The netting, stated as the claim it exists to support: **a value equally
 * present in what you liked and what you dropped predicts nothing, so it must
 * score on NEITHER side.** Before netting it scored on both at once — a shonen
 * watcher who drops the occasional shonen was given `+genre` and `-rejection`
 * on every shonen candidate simultaneously.
 *
 * The fixture puts `Action` at an identical rate on both sides, `Mecha` only in
 * the likes, `Ecchi` only in the drops. Membership is asserted rather than
 * magnitude: the weights are IDF-scaled and normalized, and pinning those
 * numbers would freeze tuning that is meant to move.
 */
test('a value equally present in likes and dislikes scores on neither side', () => {
  const liked = ['l1', 'l2', 'l3', 'l4'].map(id =>
    anime(id, { status: 'completed', score: 9, genres: ['Action', 'Mecha'] }));
  const disliked = ['d1', 'd2', 'd3', 'd4'].map(id =>
    anime(id, { status: 'dropped', genres: ['Action', 'Ecchi'] }));
  const all = [...liked, ...disliked];

  const profiles = buildDiscriminativeProfiles(all, new Set(), computeIdfSet(all));

  assert.equal(profiles.posGenre.weights.has('Action'), false, 'netted out of the positive side');
  assert.equal(profiles.negGenre.weights.has('Action'), false, 'netted out of the rejection side');

  assert.equal(profiles.posGenre.weights.has('Mecha'), true, 'concentrated in the likes, so it survives');
  assert.equal(profiles.negGenre.weights.has('Mecha'), false);

  assert.equal(profiles.negGenre.weights.has('Ecchi'), true, 'concentrated in the drops, so it survives');
  assert.equal(profiles.posGenre.weights.has('Ecchi'), false);
});

/**
 * The knob the test above is really about. `0` is documented as reproducing the
 * pre-netting behaviour, so the shipped value is what makes netting active at
 * all — asserting it stops the test above from passing for the wrong reason.
 */
test('DISCRIMINATION ships at full netting', () => {
  assert.equal(TUNING.DISCRIMINATION, 1);
});

/**
 * The dislike set is dropped ∪ scored-low ∪ 👎. The thumbs arm is the one that
 * reaches titles with no watch history at all, so it cannot be inferred from
 * status and is the easiest of the three to drop by accident.
 */
test('a thumbs-down title joins the rejection profile even when never watched', () => {
  const liked = ['l1', 'l2'].map(id => anime(id, { status: 'completed', score: 9, genres: ['Mecha'] }));
  const thumbed = anime('x', { genres: ['Ecchi'] });
  const all = [...liked, thumbed];

  const without = buildDiscriminativeProfiles(all, new Set(), computeIdfSet(all));
  const withThumb = buildDiscriminativeProfiles(all, new Set(['x']), computeIdfSet(all));

  assert.equal(without.negGenre.weights.has('Ecchi'), false);
  assert.equal(withThumb.negGenre.weights.has('Ecchi'), true);
});

/**
 * A low score is a rejection whether or not the title was dropped —
 * `NEGATIVE_SCORE_THRESHOLD` is the other arm, and `> 0` matters because 0 is
 * how an unrated entry is spelled, not a rating of zero.
 */
test('a completed-but-low-scored title is a rejection; an unrated one is not', () => {
  const base = ['l1', 'l2'].map(id => anime(id, { status: 'completed', score: 9, genres: ['Mecha'] }));

  const lowScored = anime('x', { status: 'completed', score: TUNING.NEGATIVE_SCORE_THRESHOLD, genres: ['Ecchi'] });
  const withLow = [...base, lowScored];
  assert.equal(
    buildDiscriminativeProfiles(withLow, new Set(), computeIdfSet(withLow)).negGenre.weights.has('Ecchi'),
    true,
  );

  const unrated = anime('y', { status: 'completed', score: 0, genres: ['Ecchi'] });
  const withUnrated = [...base, unrated];
  assert.equal(
    buildDiscriminativeProfiles(withUnrated, new Set(), computeIdfSet(withUnrated)).negGenre.weights.has('Ecchi'),
    false,
    'score 0 means unrated, not a rating of zero',
  );
});
