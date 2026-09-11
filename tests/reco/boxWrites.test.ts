/**
 * The two `Box` write rules that have no compiler and no visible symptom.
 *
 * These are pure-shape tests over the *reducer* half of the store — the part
 * that decides what the next `Box` looks like — deliberately separated from the
 * `fs` half so they need no fixture on disk (`DATA_PATH` is a module-init const
 * in `jsonStore.ts`, which is why the suite stays on pure functions).
 *
 * Both were verified by breaking the thing they guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupMembersToFile, nextExcluded, nextGroups } from '@/lib/domain/boxWrites';
import type { Box } from '@/models/anime';

const box = (patch: Partial<Box> = {}): Box => ({
  id: 'b',
  name: 'b',
  members: ['a_1', 'a_2', 'a_3'],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...patch,
});

test('excluding a member REMOVES it from members', () => {
  // They are mutually exclusive answers to one question. A title in both makes
  // every count disagree with every other — `unitCount` says one thing, the
  // members grid another, and the écartés strip a third — with nothing to say
  // which is wrong.
  const next = nextExcluded(box(), ['a_2'], []);

  assert.deepEqual(next.members, ['a_1', 'a_3']);
  assert.deepEqual(next.excluded, ['a_2']);
});

test('un-excluding returns a title to the undecided pool, NOT to the box', () => {
  // The asymmetry is the point: « je m'étais trompé » is not « c'est ça ». If
  // undo re-filed it, a mis-click on ⊘ followed by ↩ would silently add a
  // member the owner never chose.
  const next = nextExcluded(box({ members: ['a_1'], excluded: ['a_2'] }), [], ['a_2']);

  assert.deepEqual(next.members, ['a_1']);
  assert.equal(next.excluded, undefined);
});

test('an empty excluded set is absent, not []', () => {
  // Matches how `description` and `emoji` are already stored, and keeps every
  // "has one?" check from reading an empty array as true.
  const next = nextExcluded(box({ excluded: ['a_9'] }), [], ['a_9']);
  assert.equal('excluded' in next && next.excluded !== undefined, false);
});

test('declaring a group NEVER adds membership', () => {
  // ⚠️ The lens rule, and the sharpest silent failure in the feature. `members`
  // is authoritative; every consumer (`/mix?box=`, `computeAnchored`,
  // `box_candidates`, `list_boxes`) reads it ALONE. A title present only in
  // `groups` would be invisible to the very ranking this exists to fix — the box
  // would look fuller on screen and rank as though it were not.
  const before = box();
  const next = nextGroups(before, ['bleach'], []);

  assert.deepEqual(next.members, before.members);
  assert.deepEqual(next.groups, ['bleach']);
});

test('undeclaring drops the declaration and touches nothing else', () => {
  const before = box({ groups: ['bleach', 'gundam'] });
  const next = nextGroups(before, [], ['gundam']);

  assert.deepEqual(next.groups, ['bleach']);
  assert.deepEqual(next.members, before.members);
});

test('declarations dedupe, so a double click cannot count a group twice', () => {
  const next = nextGroups(box({ groups: ['bleach'] }), ['bleach'], []);
  assert.deepEqual(next.groups, ['bleach']);
});

test('« Créer et ajouter » never re-files an écarté', () => {
  // The owner already said « non » for this box. Re-filing it would pull the
  // title out of the strip with no other symptom.
  const add = groupMembersToFile(['a_1', 'a_2', 'a_3'], new Set(['a_1', 'a_2', 'a_3']), new Set(), new Set(['a_2']));
  assert.deepEqual(add, ['a_1', 'a_3']);
});

test('« Créer et ajouter » files only WATCHED members, and nothing already filed', () => {
  // A group drawn from the relation graph holds the unaired sequel; the source
  // pane could never have offered it, so the shortcut must not file it either.
  const add = groupMembersToFile(['a_1', 'a_2', 'a_9'], new Set(['a_1', 'a_2']), new Set(['a_1']), new Set());
  assert.deepEqual(add, ['a_2']);
});
