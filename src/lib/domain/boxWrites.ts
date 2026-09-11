/**
 * The pure half of a `Box` write: what the next box looks like, decided without
 * touching disk.
 *
 * `reco/boxes.ts` owns the persistence (read the file, apply, write it back);
 * this owns the two rules that are easy to get wrong and impossible to see go
 * wrong. Splitting them is what lets the rules be pinned by
 * [tests/reco/boxWrites.test.ts](../../../tests/reco/boxWrites.test.ts) without
 * a fixture on disk — `DATA_PATH` is a module-init const in `jsonStore.ts` and
 * `readJsonFile`'s parse cache is module-level, which is why this suite stays on
 * pure functions.
 *
 * Client-safe (`domain/**` is in the enforced no-`fs` set), which is incidental
 * here but keeps the split honest.
 */

import type { Box } from '@/models/anime';

/**
 * Apply an « écartés » edit.
 *
 * ⚠️ **Excluding a title also REMOVES it from `members`.** Membership and
 * exclusion are mutually exclusive answers to the same question, and a title
 * holding both would make every count disagree with every other — `unitCount`
 * says one thing, the members grid another, the écartés strip a third, and
 * nothing says which is wrong.
 *
 * ⚠️ **The reverse is deliberately NOT symmetric.** Lifting an exclusion returns
 * the title to the undecided pool, never to the box: « je m'étais trompé » is
 * not « c'est ça ». Were undo to re-file it, a mis-click on ⊘ followed by ↩
 * would quietly add a member the owner never chose.
 *
 * `excluded` is dropped rather than left as `[]` when it empties, matching how
 * `description` and `emoji` are already stored — an empty array reads as true to
 * every "has one?" check.
 *
 * ⚠️ The set may hold UNWATCHED ids (the recos tab files unseen candidates), so
 * nothing that renders or counts it may join it against the watched list.
 */
export function nextExcluded(box: Box, add: string[], remove: string[]): Box {
  const dropped = new Set(remove);
  const excluded = [...new Set([...(box.excluded || []).filter(id => !dropped.has(id)), ...add])];
  const excluding = new Set(add);
  const next: Box = {
    ...box,
    members: add.length > 0 ? box.members.filter(id => !excluding.has(id)) : box.members,
  };
  if (excluded.length > 0) next.excluded = excluded;
  else delete next.excluded;
  return next;
}

/**
 * Apply a group DECLARATION edit — which « regroupements » collapse in this box.
 *
 * ⚠️ **A declaration NEVER adds membership**, and this is the lens rule the whole
 * feature rests on. `members` is authoritative; `groups` is a view over it. Every
 * consumer — `/mix?box=`, `computeAnchored`, `box_candidates`, `list_boxes` —
 * reads `members` ALONE, so a title present only in `groups` would be invisible
 * to the very ranking this exists to fix: the box would look fuller on screen
 * and rank as though it were not.
 *
 * "Add all 17 at once" is therefore the CALLER sending an `add` and a `declare`
 * together, deliberately — never this function inferring one from the other.
 *
 * A declaration naming a group that is later deleted is left in place: it is a
 * no-op by construction (`resolveBoxUnits` ignores an id it cannot resolve), and
 * sweeping it would mean rewriting the one file no provider can re-supply.
 */
export function nextGroups(box: Box, declare: string[], undeclare: string[]): Box {
  const dropped = new Set(undeclare);
  const groups = [...new Set([...(box.groups || []).filter(g => !dropped.has(g)), ...declare])];
  const next: Box = { ...box };
  if (groups.length > 0) next.groups = groups;
  else delete next.groups;
  return next;
}

/**
 * What « Créer et ajouter à la boîte » files: the new group's members that are
 * WATCHED, not already in the box, and not set aside in it.
 *
 * The group blade's shortcut for the fill loop that used to take five steps —
 * create the group, scroll up to its card, « Ajouter les N », scroll back down to
 * find your place. It sends the same `{ add, declare }` pair the card does, so
 * this only decides the `add` half. Two exclusions, both silent if dropped:
 *
 * - ⚠️ **« Écartés » are skipped.** The owner already answered « non » for this
 *   box; re-filing a set-aside title is the one thing that set exists to
 *   prevent, and it would happen with no symptom beyond the title quietly
 *   leaving the strip.
 * - ⚠️ **Unwatched members are skipped.** A group is drawn from the relation
 *   graph and routinely holds the unaired sequel; the source pane is watched-only
 *   by scope, and filing what it could never have offered would put titles the
 *   owner has not seen into a box about what they have.
 */
export function groupMembersToFile(
  members: string[],
  watched: Set<string>,
  filed: Set<string>,
  excluded: Set<string>
): string[] {
  return [...new Set(members)].filter(id => watched.has(id) && !filed.has(id) && !excluded.has(id));
}

/**
 * Apply an incremental membership edit. Deduped and order-preserving, the same
 * contract `setBoxMembers` has.
 */
export function nextMembers(box: Box, add: string[], remove: string[]): Box {
  const dropped = new Set(remove);
  return { ...box, members: [...new Set([...box.members.filter(id => !dropped.has(id)), ...add])] };
}
