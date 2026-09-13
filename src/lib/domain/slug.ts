/**
 * Readable, deduped slug ids for the hand-drawn `user/` objects — boxes and
 * « regroupements ».
 *
 * **Why it is its own module rather than a helper on `reco/boxes.ts`.** Both
 * stores mint the same way (the design says a `UserGroup` id uses "the same mint
 * as `Box`"), so sharing the function is what makes that true rather than a
 * comment two files apart can drift out of — but importing it FROM `boxes.ts`
 * made `boxes.ts` and `groups.ts` mutually recursive. That works today and is
 * exactly the shape this repo already refused once: `store/recordCache.ts` is a
 * two-variable module for no other reason than to keep `record.ts` and the slice
 * writers from importing each other.
 *
 * Client-safe (`domain/**` is in the enforced no-`fs` set), which is a small
 * bonus: a create form can preview the id it is about to mint.
 */

import type { Box } from '@/models/anime';

/**
 * Slug from a name, deduped against what already exists.
 *
 * Kept readable rather than random because it is a URL — `/boxes/[id]`, and a
 * bookmarked box should say which one it is.
 */
export function mintSlugId(name: string, taken: Set<string>, fallback = 'boite'): string {
  const base = name
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || fallback;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The id a new « regroupement » gets: a slug of its name, deduped.
 *
 * ⚠️ **Dead ids are taken too** — `mintProfileId`'s rule, for the same hazard.
 * `deleteGroup` leaves every box's `groups` declaration in place, inert
 * (`resolveBoxUnits` ignores an id it cannot resolve). `mintSlugId` over the
 * live groups alone would hand that freed slug to the next group of the same
 * name, and every box still declaring it would silently start collapsing the new
 * group's members — a collapse the owner never declared there, shifting
 * `rankBoxCandidates` and `/mix?box=` with nothing on screen to say so. So every
 * id any box still names is reserved. Pure, so the rule is pinned without a
 * store on disk.
 */
export function mintGroupId(
  name: string,
  groups: { id: string }[],
  boxes: Pick<Box, 'groups'>[]
): string {
  const taken = new Set([
    ...groups.map(g => g.id),
    ...boxes.flatMap(b => b.groups ?? []),
  ]);
  return mintSlugId(name, taken, 'groupe');
}
