/**
 * `profileWeights` — how a stored reco profile becomes the weights a ranker
 * runs with (docs/recoProfiles/DESIGN.md §6).
 *
 * The invariant that earns this file its place is the `anilistStaff` zeroing:
 * the eight craft families are SUBSETS of `anilistStaff`'s credit list, so a
 * profile that turns one on without silencing the whole-list field counts a
 * shared director twice, at scales ~18× apart. That produces a plausible
 * ranking and no error — the `GENRE_ALIASES` failure mode exactly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveProfile, resolveProfileOver, sanitizeProfileWeights, mintProfileId, PROFILE_PRESETS,
} from '@/lib/reco/profileWeights';
import { BOX_WEIGHTS, ANCHORED_WEIGHTS, resolveWeights } from '@/lib/reco/weights';
import { STAFF_FAMILIES } from '@/lib/reco/staffFields';

test('any non-zero family forces anilistStaff to 0, and says so', () => {
  const r = resolveProfile(BOX_WEIGHTS, { staffDirector: 0.8 });
  assert.equal(r.weights.anilistStaff, 0);
  assert.equal(r.families.staffDirector, 0.8);
  assert.equal(r.staffZeroed, true);
});

test('the zeroing holds even when a profile sets anilistStaff explicitly', () => {
  const r = resolveProfile(ANCHORED_WEIGHTS, { staffMusic: 0.5, anilistStaff: 2 });
  assert.equal(r.weights.anilistStaff, 0, 'a double count is unrepresentable, not merely discouraged');
});

test('with every family at 0, anilistStaff keeps whatever it resolves to', () => {
  assert.equal(resolveProfile(BOX_WEIGHTS, {}).weights.anilistStaff, BOX_WEIGHTS.anilistStaff);
  assert.equal(resolveProfile(BOX_WEIGHTS, { staffDirector: 0 }).weights.anilistStaff, BOX_WEIGHTS.anilistStaff);
  const r = resolveProfile(BOX_WEIGHTS, { anilistStaff: 0.9 });
  assert.equal(r.weights.anilistStaff, 0.9);
  assert.equal(r.staffZeroed, false);
});

/**
 * Each ranker takes the subset of the union it understands. `crowd` is not a
 * `BOX_WEIGHTS` key, so a profile carrying it must not grow a stray key on the
 * box ranker's weights — and it must reach the anchored ranker, whose base has it.
 */
test('a profile overrides only the keys its base carries', () => {
  const profile = { crowd: 0.4, genre: 0.6 };
  const box = resolveProfile(BOX_WEIGHTS, profile);
  assert.equal(box.weights.genre, 0.6);
  assert.ok(!('crowd' in box.weights));
  assert.equal(resolveProfile(ANCHORED_WEIGHTS, profile).weights.crowd, 0.4);
});

/**
 * `mix?box=`'s precedence: base < profile < URL. Each edge fails silently.
 *
 * A URL value that happens to EQUAL the anchored default must still beat the
 * profile — resolved the other way, a slider dragged back to the default would
 * snap to the profile's value. And a hand-typed `w=anilistStaff:1` must not
 * slip past the zeroing just because the URL is applied last.
 */
test('URL overrides sit on top of a profile, and cannot un-zero anilistStaff', () => {
  const profile = { genre: 0.9, staffDirector: 1 };
  const r = resolveProfileOver(ANCHORED_WEIGHTS, profile, { genre: ANCHORED_WEIGHTS.genre, anilistStaff: 1 });
  assert.equal(r.weights.genre, ANCHORED_WEIGHTS.genre, 'the URL wins, even at the base value');
  assert.equal(r.weights.anilistStaff, 0, 'the zeroing holds after the URL');
  assert.equal(r.families.staffDirector, 1, 'families come from the profile');
  assert.equal(resolveProfileOver(ANCHORED_WEIGHTS, profile, {}).weights.genre, 0.9);
});

/** `/mix?ids=` has no profile, and must rank exactly as it did before profiles existed. */
test('with no profile, URL overrides resolve exactly as resolveWeights does', () => {
  const overrides = { crowd: 0.3, anilistStaff: 2, popularity: 0 };
  const r = resolveProfileOver(ANCHORED_WEIGHTS, undefined, overrides);
  assert.deepEqual(r.weights, resolveWeights(overrides, ANCHORED_WEIGHTS));
  assert.equal(r.staffZeroed, false);
  assert.ok(Object.values(r.families).every(v => v === 0));
});

/**
 * Sparse by INTENT, never by equality: `genre` is 0.25 on one base and 0.2 on
 * the other, so a value equal to one base must survive sanitizing — dropping it
 * would change what the other surface ranks with.
 */
test('sanitizing keeps a value equal to a base, and drops the unusable', () => {
  assert.deepEqual(sanitizeProfileWeights({ genre: BOX_WEIGHTS.genre }), { genre: BOX_WEIGHTS.genre });
  assert.deepEqual(
    sanitizeProfileWeights({ bogus: 1, genre: 'x', staffArt: Number.NaN, studio: Infinity }),
    {}
  );
  assert.deepEqual(sanitizeProfileWeights(null), {});
});

test('sanitizing clamps families to 0-1 and a source to its slider bounds', () => {
  assert.deepEqual(
    sanitizeProfileWeights({ staffDirector: 4, staffArt: -1, rejection: 0.5, anilistStaff: 9 }),
    { staffDirector: 1, staffArt: 0, rejection: 0, anilistStaff: 3 }
  );
});

/**
 * A deleted profile leaves every box's `profileId` in place, inert. If the mint
 * handed that freed slug to the next profile of the same name, those boxes would
 * silently start ranking with a weighting nobody attached to them.
 */
test('a dead profile id a box still names is never re-minted', () => {
  const boxes = [{ profileId: 'realisation' }, {}];
  assert.equal(mintProfileId('Réalisation', [], boxes), 'realisation-2');
  assert.equal(mintProfileId('Réalisation', [{ id: 'realisation' }], []), 'realisation-2');
  assert.equal(mintProfileId('Réalisation', [], [{}]), 'realisation');
});

test('every preset that turns a family on states anilistStaff: 0', () => {
  for (const preset of PROFILE_PRESETS) {
    const onFamily = STAFF_FAMILIES.some(f => (preset.weights[f] ?? 0) !== 0);
    if (onFamily) assert.equal(preset.weights.anilistStaff, 0, preset.key);
  }
});
