/**
 * `history/affinity_marks.json` — the `fs` half of the mark history. The rules
 * (which point, when, written once or overwritten) are the pure
 * `markHistory.ts`; this module only reads, runs one capture, and writes.
 *
 * ⚠️ Durable: it records what the mark said at a moment that has passed, so no
 * provider and no rebuild can re-supply it. Server-only.
 */
import { readJsonFile, writeJsonFile, dataFile } from '@/lib/store/jsonStore';
import { getAnimeForDisplay } from '@/lib/store';
import { getFeedback, feedbackIds } from '@/lib/reco/feedback';
import { buildAffinityIndex } from '@/lib/reco/affinity';
import { captureMarks, type MarkHistory } from '@/lib/reco/markHistory';

const MARK_HISTORY_FILE = dataFile('history/affinity_marks.json');

export function getMarkHistory(): MarkHistory {
  return readJsonFile<MarkHistory>(MARK_HISTORY_FILE, {});
}

/**
 * One capture over the current store. Built with the same inputs the main
 * list's mark uses (`api/anime/animes`'s `getMarks`), so a recorded point is
 * the badge the owner saw that day.
 */
export function captureAffinityMarks(now = new Date()) {
  const all = getAnimeForDisplay();
  const downIds = feedbackIds(getFeedback(), 'down');
  const index = buildAffinityIndex(all, { downIds });
  const { history, written } = captureMarks(all, index, getMarkHistory(), { now, downIds });
  if (written.first + written.preAir + written.ep3 > 0) writeJsonFile(MARK_HISTORY_FILE, history);
  return { written, tracked: Object.keys(history).length, seedCount: index.seedCount };
}
