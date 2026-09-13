/**
 * `mintGroupId` — the mint that keeps a deleted « regroupement » inert.
 *
 * `deleteGroup` deliberately leaves every box's `groups` declaration in place,
 * and that is safe only because a dangling id resolves to nothing. If the mint
 * handed the freed slug to the next group of the same name, every box still
 * declaring it would silently start collapsing a group its owner never declared
 * there: no error, just a ranking that shifts. `mintProfileId` pins the same rule
 * for reco profiles (tests/reco/profileWeights.test.ts).
 *
 * Verified by breaking it both ways: dropping the box ids fails the first
 * assertion, dropping the live group ids fails the second.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintGroupId } from '@/lib/domain/slug';

test('a dead group id a box still declares is never re-minted', () => {
  // Reserved by a box alone — the group itself is gone.
  assert.equal(mintGroupId('Bleach', [], [{ groups: ['bleach'] }]), 'bleach-2');
  // Reserved by a live group alone — the reservation adds to the live check, never replaces it.
  assert.equal(mintGroupId('Bleach', [{ id: 'bleach' }], []), 'bleach-2');
  // Reserved by neither — nothing over-reserved.
  assert.equal(mintGroupId('Bleach', [], [{ groups: ['other'] }]), 'bleach');
  // `Box.groups` is optional; an undeclared box reserves nothing and must not throw.
  assert.equal(mintGroupId('Bleach', [], [{}]), 'bleach');
});

test('both reservations stack: the next free suffix skips live and dead ids alike', () => {
  const groups = [{ id: 'bleach' }];
  const boxes = [{ groups: ['bleach-2'] }, { groups: ['bleach-3', 'bleach'] }];
  assert.equal(mintGroupId('Bleach', groups, boxes), 'bleach-4');
});
