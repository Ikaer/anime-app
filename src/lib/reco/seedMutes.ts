/**
 * Seed mutes — « ne plus partir de ce titre » — `user/seed_mutes.json`.
 *
 * A durable set of canonical ids that stop acting as SEEDS. The title keeps its
 * score, keeps counting in `/stats`, stays in its boxes and stays excluded from
 * the feed as already-seen: all it loses is the right to project crowd edges and
 * to feed the positive taste profile.
 *
 * **It removes a term from the sum; it never adds a negative one.** That
 * distinction is the whole design. Subtracting the crowd edges of a dislike set
 * was built and measured monotonically worse at all three backtest cutoffs — the
 * dislike neighbourhood correlates with the positive one (r = +0.34), so it
 * cancels `crowd`, the feed's anchor, instead of adding signal. A mute has no
 * such failure mode because it asserts nothing: it just stops counting a seed.
 *
 * ⚠️ **An "anti-box" folding these titles into the `rejection` profile would be
 * arithmetically a no-op**, which is why that shape was not built. The titles
 * worth muting are high-scored completions, so they sit in `likedAnimes`;
 * `buildDiscriminativeProfiles` nets each side's rate against the other, so
 * their genres, studios and T1 staff would cancel to ~zero. Removing them from
 * the positive side IS the mute.
 *
 * Lives in `reco/` rather than `store/` for `feedback.ts`'s reason: it is a
 * recommendation-engine annotation, not a slice of the record, so it is off the
 * seven-slice join and a write here cannot change any assembled row (no
 * `invalidateRecordCache`).
 *
 * Server-only (uses `fs` via `jsonStore`).
 */

import { AnimeRecord } from '@/models/anime';
import { getAnimeForDisplay } from '@/lib/store';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';

const SEED_MUTES_FILE = dataFile('user/seed_mutes.json');

/** A bare array of canonical ids, the shape `user/hidden.json` already uses. */
export function getSeedMutes(): string[] {
  return readJsonFile<string[]>(SEED_MUTES_FILE, []);
}

/** The same set, for the per-candidate membership tests in the ranking loops. */
export function getSeedMuteSet(): Set<string> {
  return new Set(getSeedMutes());
}

export function addSeedMute(canonicalId: string): void {
  const ids = getSeedMutes();
  if (!ids.includes(canonicalId)) {
    ids.push(canonicalId);
    writeJsonFile(SEED_MUTES_FILE, ids);
  }
}

export function removeSeedMute(canonicalId: string): void {
  const ids = getSeedMutes();
  const next = ids.filter(id => id !== canonicalId);
  if (next.length !== ids.length) writeJsonFile(SEED_MUTES_FILE, next);
}

/**
 * The muted titles as records, for the review-and-undo list in the sidebar.
 *
 * An id with no record is dropped rather than surfaced as a bare `a_<n>`: the
 * store is the authority on what exists, and a mute for a title that is gone
 * costs nothing to keep on disk but would render as an unclickable ghost row.
 */
export function getMutedSeedAnime(): AnimeRecord[] {
  const ids = getSeedMuteSet();
  return ids.size === 0 ? [] : getAnimeForDisplay().filter(a => ids.has(a.id));
}
