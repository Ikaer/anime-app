/**
 * « Mes regroupements » — the durable store for `user/groups.json`.
 *
 * A `UserGroup` is a hand-drawn statement that several titles ARE one thing:
 * four cours of TYBW, a show and its recap movie, two halves of a split-cour.
 * The provider relation graph is a *suggestion* a group is seeded from, never an
 * authority it obeys — which is the whole point of drawing one by hand.
 *
 * **Definition is global, application is per box.** The members live here, once,
 * and are picked from this list when a second box wants them; only the
 * declaration is box-local (`Box.groups`). So editing a group's members changes
 * every box that declared it, which is intended — a group is ONE statement about
 * what those titles are, not a per-box copy to keep in sync.
 *
 * **Why it lives in `reco/` rather than `store/`**, exactly `boxes.ts`' and
 * `feedback.ts`' reason: durable `user/` data deliberately NOT joined into
 * `AnimeRecord`. A write here cannot change an assembled row, so it must not
 * invalidate the row cache and does not pay the seven-slice join's tax.
 *
 * ⚠️ **Durable user data.** Like `boxes.json`, no provider can re-supply it —
 * it is in CLAUDE.md's "costs that are real" list, not the reprocess-freely one.
 *
 * The collapse ARITHMETIC is deliberately not here: it is the client-safe
 * `domain/boxUnits.ts`, because the quick-edit panes resolve their own groups
 * regions in the browser. Same split as `providers/capabilities.ts` (declarative,
 * client-safe) against `providers/registry.ts` (runtime, `fs`).
 *
 * Server-only (uses `fs` via `jsonStore`), and listed as such in the eslint
 * client-safety block.
 */

import type { Box, UserGroup } from '@/models/anime';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { mintGroupId } from '@/lib/domain/slug';

const GROUPS_FILE = dataFile('user/groups.json');

/** A bare array, beside `boxes.json` / `hidden.json` / `reco_feedback.json`. */
export function getGroups(): UserGroup[] {
  return readJsonFile<UserGroup[]>(GROUPS_FILE, []);
}

export function getGroup(id: string): UserGroup | undefined {
  return getGroups().find(g => g.id === id);
}

/**
 * Create a group. `members` arrives already carved — the blade is the side that
 * knows which entries of the seeded component actually belong, so this stays a
 * dumb setter like `setBoxMembers`.
 *
 * ⚠️ **`boxes` is required, and every caller passes `getBoxes()`.** The mint
 * must reserve every group id a box still declares (see `mintGroupId`), but
 * this module cannot read the boxes itself: `boxes.ts` imports `getGroups` from
 * here, so importing `getBoxes` back would make the two mutually recursive —
 * the shape `domain/slug.ts` exists to avoid. It is required rather than
 * defaulted to `[]` because a forgotten argument would silently drop the
 * reservation, which is the whole bug.
 */
export function createGroup(
  name: string,
  members: string[],
  boxes: Pick<Box, 'groups'>[]
): UserGroup {
  const groups = getGroups();
  const group: UserGroup = {
    // Reserves the dead ids boxes still declare — see `mintGroupId`.
    id: mintGroupId(name, groups, boxes),
    name: name.trim() || 'Sans nom',
    members: [...new Set(members)],
    createdAt: new Date().toISOString(),
  };
  groups.push(group);
  writeJsonFile(GROUPS_FILE, groups);
  return group;
}

/**
 * Rename, and/or replace the membership. The id is a URL-ish key and never
 * moves — a rename is not a re-mint, so it cannot collide with a dead id a box
 * still declares; a blank name falls back to the current one, `boxes.ts`' rule — a group
 * must always have a name, because the name is what the chip and the card say.
 */
export function updateGroup(
  id: string,
  patch: { name?: string; members?: string[] }
): UserGroup | undefined {
  const groups = getGroups();
  const group = groups.find(g => g.id === id);
  if (!group) return undefined;
  if (patch.name !== undefined) group.name = patch.name.trim() || group.name;
  if (patch.members !== undefined) group.members = [...new Set(patch.members)];
  writeJsonFile(GROUPS_FILE, groups);
  return group;
}

/**
 * Drop a group.
 *
 * ⚠️ **Deliberately does NOT sweep `Box.groups`.** A dangling declaration is a
 * no-op by construction (`resolveBoxUnits` ignores an id it cannot resolve), so
 * rewriting every box here would be a multi-file write to achieve nothing — and
 * `user/boxes.json` is the one file in this app that cannot be re-fetched from a
 * provider, so the fewer things that rewrite it wholesale, the better.
 *
 * ⚠️ **"Inert" holds only because the id is never re-minted.** A dangling `bleach`
 * resolves to nothing today; if `createGroup` handed `bleach` to the next group
 * named « Bleach », every box still declaring it would silently start collapsing
 * that group's members. `mintGroupId` reserves every id a box still names, which
 * is what closes that — so not sweeping here stays safe only while the mint does.
 */
export function deleteGroup(id: string): boolean {
  const groups = getGroups();
  const next = groups.filter(g => g.id !== id);
  if (next.length === groups.length) return false;
  writeJsonFile(GROUPS_FILE, next);
  return true;
}

/**
 * Incremental membership, for the blade's checkboxes.
 *
 * `add`/`remove` rather than a full replacement, and for `boxes.ts`' race
 * argument: the blade fires a write per checkbox against a list the server also
 * holds, so a read-modify-write on the client would let the second click clobber
 * the first.
 */
export function editGroupMembers(
  id: string,
  add: string[] = [],
  remove: string[] = []
): UserGroup | undefined {
  const group = getGroup(id);
  if (!group) return undefined;
  const dropped = new Set(remove);
  return updateGroup(id, { members: [...group.members.filter(m => !dropped.has(m)), ...add] });
}

/**
 * Every group holding this title — the flat region's group chip, for one card.
 *
 * Note it answers about the GLOBAL definitions, not about any box's
 * declarations: the chip's job is "this title is part of a group you drew", and
 * whether the current box counts that group is a separate question the box pane
 * answers with its own region.
 */
export function groupsContaining(canonicalId: string, groups = getGroups()): UserGroup[] {
  return groups.filter(g => g.members.includes(canonicalId));
}
