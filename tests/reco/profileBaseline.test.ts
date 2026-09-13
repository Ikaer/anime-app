/**
 * The profile page's "against Défaut" framing (`reco/profileBaseline.ts`).
 *
 * Both rules fail SILENTLY, into a page that looks fine: a re-faced franchise
 * counted as "new" inflates « N nouveaux » on every slider release, and a
 * weighting that changes nothing rendered as a list is the fourth
 * recommendation surface DESIGN §7 refuses — both with no error anywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shiftsAgainst, tunesNothing } from '@/lib/reco/profileBaseline';
import { BOX_WEIGHTS, ANCHORED_WEIGHTS } from '@/lib/reco/weights';

test('a franchise group that re-faced under the new weights is found again, not "new"', () => {
  // Under Défaut the group is faced by a_2; the weighting makes a_1 its best
  // scorer, so the same group comes back faced by a_1.
  const baseline = [{ ids: ['a_9'] }, { ids: ['a_2', 'a_1', 'a_3'] }];
  const rows = [{ ids: ['a_1', 'a_2', 'a_3'] }, { ids: ['a_9'] }, { ids: ['a_7'] }];

  assert.deepEqual(shiftsAgainst(rows, baseline), [
    { kind: 'up', by: 1 },
    { kind: 'down', by: 1 },
    { kind: 'new' },
  ]);
});

test('"tunes nothing" is decided on the RESOLVED weights of the pool, not on the stored keys', () => {
  // `crowd` is not a field the metadata pools read: stored, and inert there.
  assert.equal(tunesNothing(BOX_WEIGHTS, { crowd: 1.4 }), true);
  assert.equal(tunesNothing(ANCHORED_WEIGHTS, { crowd: 1.4 }), false);
  // A key held at exactly its base value changes nothing either.
  assert.equal(tunesNothing(BOX_WEIGHTS, { genre: BOX_WEIGHTS.genre }), true);
  // A family always tunes something — and it zeroes `anilistStaff` besides.
  assert.equal(tunesNothing(BOX_WEIGHTS, { staffDirector: 1 }), false);
  assert.equal(tunesNothing(BOX_WEIGHTS, {}), true);
});
