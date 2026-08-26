/**
 * `computeDiscrepancy` — cross-provider personal-state comparison.
 *
 * Two of its rules are counterintuitive enough that they have already been
 * broken once each, and neither breaks loudly: a lost exception floods the
 * discrepancies page with phantom rows, a lost presence rule empties it. Both
 * look like "the data changed" rather than "the comparison changed".
 *
 * The module is pure and takes the provider map as an argument, so everything
 * here is fixtures — `buildProviderStates` decides WHICH providers are in the
 * map and is deliberately not under test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDiscrepancy, mapSimklStatus } from '@/lib/providers/discrepancy';
import type { ProviderPersonalState } from '@/models/anime';

/** A present entry; every field optional so each test states only what it means. */
const entry = (s: Partial<ProviderPersonalState> = {}): ProviderPersonalState =>
  ({ present: true, ...s });

test('a title only one provider knows about is not a discrepancy', () => {
  assert.equal(computeDiscrepancy({ mal: entry({ status: 'completed', score: 8 }) }), null);
  assert.equal(computeDiscrepancy({}), null);
});

test('providers that agree produce no discrepancy', () => {
  assert.equal(computeDiscrepancy({
    mal: entry({ status: 'completed', score: 8, progress: 12, total: 12 }),
    simkl: entry({ status: 'completed', score: 8, progress: 12, total: 12 }),
  }), null);
});

test('a status or score disagreement is reported on that dimension alone', () => {
  const status = computeDiscrepancy({
    mal: entry({ status: 'completed' }),
    simkl: entry({ status: 'watching' }),
  });
  assert.deepEqual(status?.disagree, { status: true, score: false, progress: false });

  const score = computeDiscrepancy({
    mal: entry({ status: 'completed', score: 8 }),
    simkl: entry({ status: 'completed', score: 6 }),
  });
  assert.deepEqual(score?.disagree, { status: false, score: true, progress: false });
});

/**
 * An unrated entry is not a competing opinion. `0` is how MAL and the local
 * provider both spell "no score", so counting it would make every half-rated
 * title contest itself.
 */
test('an unrated score does not contest a rated one', () => {
  assert.equal(computeDiscrepancy({
    mal: entry({ status: 'completed', score: 0 }),
    simkl: entry({ status: 'completed', score: 8 }),
  }), null);

  assert.equal(computeDiscrepancy({
    mal: entry({ status: 'completed', score: null }),
    simkl: entry({ status: 'completed', score: 8 }),
  }), null);
});

/**
 * ⚠️ The progress exception. Providers disagree about episode COUNTS, and each
 * entry is judged against its own catalog's total — so 12/12 against 13/13 is
 * two fully-watched entries, not a disagreement, and no edit could reconcile it.
 */
test('progress: all-watched-of-its-own-total is not a disagreement', () => {
  assert.equal(computeDiscrepancy({
    mal: entry({ status: 'completed', progress: 12, total: 12 }),
    simkl: entry({ status: 'completed', progress: 13, total: 13 }),
  }), null);
});

/**
 * The `completed` clause of that exception, which is the load-bearing half:
 * AniList's episode total is often unknown, and without it two *completed*
 * entries resurface as a phantom disagreement purely because one has no total.
 */
test('progress: completed counts as fully watched even with an unknown total', () => {
  assert.equal(computeDiscrepancy({
    mal: entry({ status: 'completed', progress: 1, total: 1 }),
    anilist: entry({ status: 'completed', progress: 24, total: null }),
  }), null);
});

/** `>=`, not `===`: watching past a borrowed total is not itself a mismatch. */
test('progress: watching past the recorded total still counts as fully watched', () => {
  assert.equal(computeDiscrepancy({
    mal: entry({ status: 'watching', progress: 13, total: 12 }),
    simkl: entry({ status: 'watching', progress: 12, total: 12 }),
  }), null);
});

test('progress: a genuine mid-watch difference IS reported', () => {
  const mid = computeDiscrepancy({
    mal: entry({ status: 'watching', progress: 5, total: 12 }),
    simkl: entry({ status: 'watching', progress: 9, total: 13 }),
  });
  assert.equal(mid?.disagree.progress, true);

  // One side done, the other not: the exception must not rescue this.
  const half = computeDiscrepancy({
    mal: entry({ status: 'completed', progress: 12, total: 12 }),
    simkl: entry({ status: 'watching', progress: 5, total: 13 }),
  });
  assert.equal(half?.disagree.progress, true);
});

/**
 * ⚠️ Presence is ASYMMETRIC, and this is the pair that keeps it so. The anchor
 * is the user's reference list; the others are subset feeds. "On SIMKL but not
 * on the reference" is news; the inverse is the normal state of every title the
 * reference holds and a smaller list does not — flagging it measured 430 of 671
 * titles, which is the same as flagging nothing.
 */
test('presence: absent from a NON-anchor provider is not news', () => {
  assert.equal(computeDiscrepancy({
    mal: entry({ status: 'completed', score: 8, anchor: true }),
    simkl: { present: false },
  }), null);
});

test('presence: absent from the ANCHOR is news, and names both sides', () => {
  const disc = computeDiscrepancy({
    mal: { present: false, anchor: true },
    simkl: entry({ status: 'completed', score: 8 }),
  });
  assert.deepEqual(disc?.presence, { present: ['simkl'], absent: ['mal'] });
  assert.deepEqual(disc?.disagree, { status: false, score: false, progress: false },
    'a presence split is not a value disagreement');
});

test('the result echoes the states it was given', () => {
  const states = {
    mal: entry({ status: 'completed' }),
    simkl: entry({ status: 'dropped' }),
  };
  assert.equal(computeDiscrepancy(states)?.providers, states);
});

/**
 * SIMKL's own status vocabulary, normalized to MAL's. `notinteresting` really
 * is SIMKL's spelling for a drop.
 */
test('mapSimklStatus normalizes SIMKL vocabulary to MAL', () => {
  assert.equal(mapSimklStatus('hold'), 'on_hold');
  assert.equal(mapSimklStatus('plantowatch'), 'plan_to_watch');
  assert.equal(mapSimklStatus('notinteresting'), 'dropped');
  assert.equal(mapSimklStatus('watching'), 'watching');
  // Already-normalized spellings are tolerated, as is sloppy casing/padding.
  assert.equal(mapSimklStatus('on_hold'), 'on_hold');
  assert.equal(mapSimklStatus('  Completed '), 'completed');
});

test('mapSimklStatus returns null rather than guessing', () => {
  assert.equal(mapSimklStatus('something_new'), null);
  assert.equal(mapSimklStatus(''), null);
  assert.equal(mapSimklStatus(null), null);
  assert.equal(mapSimklStatus(undefined), null);
});
