/**
 * Ignored recommendations — « Ignorer » — `user/reco_ignored.json`.
 *
 * A durable set of canonical ids that no recommendation surface proposes again.
 * It is a pure SUBTRACTION: the title keeps its score and status, keeps counting
 * in `/stats`, stays in its boxes, stays in the main list, and contributes to no
 * profile, no seed and no weight. All it loses is the right to be shown as a
 * recommendation.
 *
 * **It replaced the 👍/👎 thumbs, and the reason is measured.** « Bonne pioche »
 * / « Pas pour moi » asked a PREDICTIVE question — "will you like this title you
 * have not watched?" — which is the one thing the owner cannot answer: before
 * watching there is nothing to judge, and once watching has started the title
 * has left the feed as already-seen. Live store when they were removed:
 * `user/reco_feedback.json` held **two** entries after fifteen months, both
 * `down`, written on the same day. So the `feedback` source had scored a flat 0
 * on every candidate the feed had ever ranked, the 👍-as-crowd-seed path had
 * never once fired, and the 👎 fold added 2 titles to a 163-title dislike set.
 * ⚠️ Do NOT read that as evidence that hand-labeling fails — « Mes boîtes » is
 * the same owner labeling hundreds of titles happily, because a box asks a
 * RETROSPECTIVE question about shows already watched. It is evidence that
 * pre-watch labeling fails.
 *
 * ⚠️ **It is NOT `user/hidden.json`**, and the two must not be merged. A hide
 * removes a title from the catalog list — the owner saying "I do not want to see
 * this title in my app". An ignore is scoped to the recommendation surfaces: the
 * title stays browsable, searchable and filterable everywhere else. Collapsing
 * the two would make dismissing one feed card quietly delete a row from `/`.
 *
 * ⚠️ **It asserts nothing about taste**, which is `seedMutes.ts`' design rule
 * applied to the candidate side: subtracting a disliked set's crowd edges was
 * built, measured monotonically worse at all three backtest cutoffs and
 * reverted, because the dislike neighbourhood correlates with the positive one
 * (r = +0.34) and cancels `crowd`, the feed's anchor. An ignore has no such
 * failure mode because it adds no term — and because the owner was explicit
 * that this button must not move the ranking.
 *
 * Lives in `reco/` rather than `store/` for the reason `seedMutes.ts` does: it
 * is a recommendation-engine annotation, not a slice of the record, so it is off
 * the seven-slice join and a write here cannot change any assembled row (no
 * `invalidateRecordCache`).
 *
 * Server-only (uses `fs` via `jsonStore`).
 */

import { AnimeRecord } from '@/models/anime';
import { getAnimeForDisplay } from '@/lib/store';
import { createIdSetStore } from '@/lib/store/idSet';

/** A bare array of canonical ids, the shape `user/hidden.json` already uses. */
const ignored = createIdSetStore('user/reco_ignored.json');

export function getIgnoredIds(): string[] {
  return ignored.list();
}

/** The same set, for the per-candidate membership tests in the ranking loops. */
export function getIgnoredIdSet(): Set<string> {
  return ignored.set();
}

export function addIgnored(canonicalId: string): void {
  ignored.add(canonicalId);
}

export function removeIgnored(canonicalId: string): void {
  ignored.remove(canonicalId);
}

/**
 * The ignored titles as records, for the review-and-undo list.
 *
 * An id with no record is dropped rather than surfaced as a bare `a_<n>`: the
 * store is the authority on what exists, and an ignore for a title that is gone
 * costs nothing to keep on disk but would render as an unclickable ghost row.
 */
export function getIgnoredAnime(): AnimeRecord[] {
  const ids = getIgnoredIdSet();
  return ids.size === 0 ? [] : getAnimeForDisplay().filter(a => ids.has(a.id));
}
