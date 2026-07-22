/**
 * Feedback store (👍 "bonne pioche" / 👎 "pas pour moi") — `user/reco_feedback.json`.
 *
 * A durable, standalone verdict map (canonical id -> 'up'|'down'), deliberately
 * decoupled from the transient feed in `data.ts`: a thumb persists even after the
 * title leaves the feed. 👎 subsumes the old pure-hide "Écarter" (it hides AND
 * feeds negative taste); 👍 both re-ranks the feed (the `feedback` source) and,
 * at the next refresh, joins the crowd seeds so new candidates enter.
 *
 * Server-only (uses `fs` via `jsonStore`).
 */

import { AnimeRecord, RecoVerdict } from '@/models/anime';
import { getAnimeForDisplay } from '@/lib/store';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';

const FEEDBACK_FILE = dataFile('user/reco_feedback.json');
const DISMISSED_FILE = dataFile('user/reco_dismissed.json');

/** Keyed by canonical id. */
export type FeedbackMap = Record<string, RecoVerdict>;

export function getFeedback(): FeedbackMap {
  return readJsonFile<FeedbackMap>(FEEDBACK_FILE, {});
}

export function setFeedbackVerdict(canonicalId: string, verdict: RecoVerdict): void {
  const fb = getFeedback();
  fb[canonicalId] = verdict;
  writeJsonFile(FEEDBACK_FILE, fb);
}

export function removeFeedback(canonicalId: string): void {
  const fb = getFeedback();
  if (canonicalId in fb) {
    delete fb[canonicalId];
    writeJsonFile(FEEDBACK_FILE, fb);
  }
}

/** Canonical ids carrying the given verdict. */
export function feedbackIds(fb: FeedbackMap, verdict: RecoVerdict): Set<string> {
  return new Set(
    Object.entries(fb).filter(([, v]) => v === verdict).map(([k]) => k)
  );
}

/** Anime carrying the given verdict, for the review lists. */
export function getFeedbackAnime(verdict: RecoVerdict): AnimeRecord[] {
  const ids = feedbackIds(getFeedback(), verdict);
  return getAnimeForDisplay().filter(a => ids.has(a.id));
}

/**
 * Legacy pure-hide dismiss list — superseded by 👎 feedback. Kept read-only so
 * any previously-dismissed ids stay excluded from the feed. Still MAL-keyed.
 */
export function getDismissedIds(): number[] {
  return readJsonFile<number[]>(DISMISSED_FILE, []);
}
