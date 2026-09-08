/**
 * The projected shape a « regroupement » ships as — the group-shaped sibling of
 * [leanRow.ts](./leanRow.ts), and here for the same reason that file is.
 *
 * Two routes need it (`/api/anime/groups` for the index, `/api/anime/groups/[id]`
 * for the blade's initial state), and the alternative was one API route
 * importing a value out of another — which nothing in this repo does; `stats.tsx`
 * importing a *type* from its route is the whole precedent.
 *
 * **Why a `preview` slice rather than the full membership.** Unlike a `Box`,
 * whose ids are enough for the surfaces that consume it, a group's whole job is
 * to assert "these titles are one thing", so bare ids are unreadable and every
 * placement (the blade, the sidebar index, the panes' group cards) needs
 * posters. But a group can be large — the wide-scope Gundam component is 131
 * entries — and the index renders a card, not a filmography.
 *
 * ⚠️ The `jsonStore` shared-reference contract applies: this BUILDS new objects
 * and must never trim a record in place.
 *
 * Client-safe (`domain/**` is in the enforced no-`fs` set), hence `titleLang` as
 * a parameter rather than a `getTitleLanguage()` call.
 */

import type { AnimeRecord, UserGroup } from '@/models/anime';
import type { TitleLanguage } from '@/lib/url/viewDefaults';
import { toLeanRow, byAirDate, type LeanAnimeRow } from '@/lib/domain/leanRow';

/** Posters on a group card. Enough to read as "a show", not as a filmography. */
export const GROUP_PREVIEW_COUNT = 5;

export interface GroupSummary {
  id: string;
  name: string;
  createdAt: string;
  /** Canonical ids — the authoritative membership, as `Box` ships it. */
  members: string[];
  count: number;
  /** The first few members in AIRING order, resolved. The card's face. */
  preview: LeanAnimeRow[];
  /**
   * How many member ids the store no longer knows.
   *
   * Counted rather than dropped silently, `boxes/[id]/members`' rule: a member
   * that vanished is a registry question, not an empty slot.
   */
  missing: number;
}

export function projectGroup(
  group: UserGroup,
  byId: Map<string, AnimeRecord>,
  titleLang: TitleLanguage
): GroupSummary {
  const resolved: AnimeRecord[] = [];
  let missing = 0;
  for (const id of group.members) {
    const record = byId.get(id);
    if (record) resolved.push(record);
    else missing++;
  }
  return {
    id: group.id,
    name: group.name,
    createdAt: group.createdAt,
    members: group.members,
    count: group.members.length,
    // Airing order, not insertion order: a group IS a show, and a show reads
    // first-season-first. Same ordering `boxes/[id]/members` uses.
    preview: resolved
      .sort(byAirDate(titleLang))
      .slice(0, GROUP_PREVIEW_COUNT)
      .map(a => toLeanRow(a, titleLang)),
    missing,
  };
}
