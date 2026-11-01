/**
 * « Vu grâce à la reco » — did the recommendation engine actually cause this?
 *
 * **Why it has to be recorded rather than derived.** `scripts/backtest-reco.js`
 * grades the engine on "titles the owner went on to complete and score >= 8",
 * which cannot tell a lucky ranking from a causal one: a title the owner would
 * have found anyway scores the harness exactly like one the feed delivered.
 * Nothing in the store distinguishes the two, and nothing can reconstruct it
 * after the fact — the same argument `markHistory.ts` makes for the mark, and
 * the gap the probe there already names ("a ★ is more likely to be started").
 * So the owner says so, once, and the store remembers.
 *
 * **One flag, one meaning, any surface.** `{ canonicalId: { at } }`, nothing
 * else. It is deliberately NOT a ranking input, and that is a measured
 * conclusion rather than a scope cut:
 *
 *  - ⚠️ **It is circular.** A title watched BECAUSE the feed ranked it high is
 *    by construction a title the feed already liked. Weighting it feeds the
 *    engine's own prior back into itself and the ranking narrows onto what it
 *    already surfaces. Structurally the mirror of the negative-crowd-seeds
 *    experiment: there the signal was not orthogonal to `crowd` and CANCELLED
 *    it (r = +0.34); here it is not orthogonal either, so it AMPLIFIES.
 *  - ⚠️ **The label can only exist on titles the feed surfaced**, so it says
 *    nothing about what the feed MISSED — which is the error that matters.
 *  - **The volume is not there, and the useful part is redundant.** Measured on
 *    the live store: 41 scored completions in 2023, 43 in 2024, 79 in 2025 (the
 *    191 of 2026 are inflated by SIMKL import dates). Even if a third came from
 *    the feed that is ~15-25 rows a year against **322** existing seeds — and
 *    the ones worth learning from are scored >= 8, hence already seeds.
 *
 * Read it with `scripts/probe-reco-credit.js`. Like the mark history it starts
 * empty and the first useful numbers are a season or two out.
 *
 * Pure (records + map in, counts out) and client-safe; the `fs` half is
 * `recoCreditStore.ts`. Pinned in tests/reco/recoCredit.test.ts.
 */
import type { AnimeRecord } from '@/models/anime';
import { getEffectiveStatus, getEffectiveScore } from '@/lib/domain/animeUtils';

export interface RecoCreditEntry {
  /** The day the owner credited the feed, `YYYY-MM-DD` (UTC). */
  at: string;
}

/** Keyed by canonical id. */
export type RecoCreditMap = Record<string, RecoCreditEntry>;

/** What became of the credited picks. Every credited title lands in exactly one. */
export interface RecoCreditOutcome {
  /**
   * ⚠️ Picked and never started — and this bucket is the whole reason the flag
   * is worth filing BEFORE watching rather than after. Drop it (by joining the
   * credit map against the watched list, the obvious "tidy-up") and the feed is
   * only ever measured on the titles it succeeded with: survivorship bias, and
   * the engine comes out looking perfect. `plan_to_watch` counts HERE, not as a
   * start — flagging a pick and planning it are near enough the same act, so
   * counting it as follow-through would make every pick look taken up.
   */
  notStarted: number;
  watching: number;
  onHold: number;
  dropped: number;
  completed: number;
}

export interface RecoCreditSummary {
  /** Credited ids with a record behind them. */
  credited: number;
  /** Credited ids the store no longer knows — reported, never silently dropped. */
  unresolved: number;
  outcome: RecoCreditOutcome;
  /**
   * Scores of COMPLETED + scored titles, split by whether the feed was
   * credited. A dropped title carrying a score stays out of both — it belongs
   * to `outcome.dropped`, and mixing a verdict-on-abandonment into a
   * satisfaction comparison would read as the feed delivering bad titles when
   * what it delivered was a title the owner stopped.
   *
   * ⚠️ **`other` is a contaminated control**: it holds what the owner genuinely
   * found alone PLUS every pick they forgot to flag. The contamination runs one
   * way — a forgotten pick drags the control UP — so a credited-vs-other gap is
   * a LOWER bound on the feed's effect, never an upper one. Say so when
   * reporting it; do not "fix" it by assuming unflagged means self-found.
   */
  scored: { credited: number[]; other: number[] };
}

/** Today as `YYYY-MM-DD` (UTC), the key format `at` uses. */
export function creditDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function summarizeRecoCredit(
  all: AnimeRecord[],
  credits: RecoCreditMap,
): RecoCreditSummary {
  const outcome: RecoCreditOutcome = {
    notStarted: 0, watching: 0, onHold: 0, dropped: 0, completed: 0,
  };
  const scored: { credited: number[]; other: number[] } = { credited: [], other: [] };
  const seen = new Set<string>();

  for (const anime of all) {
    const isCredited = anime.id in credits;
    const status = getEffectiveStatus(anime);
    const score = getEffectiveScore(anime);

    if (isCredited) {
      seen.add(anime.id);
      switch (status) {
        case 'watching': outcome.watching++; break;
        case 'on_hold': outcome.onHold++; break;
        case 'dropped': outcome.dropped++; break;
        case 'completed': outcome.completed++; break;
        // `plan_to_watch`, and no status at all, are both "not started".
        default: outcome.notStarted++; break;
      }
    }

    if (status !== 'completed' || score == null || score <= 0) continue;
    (isCredited ? scored.credited : scored.other).push(score);
  }

  return {
    credited: seen.size,
    unresolved: Object.keys(credits).filter(id => !seen.has(id)).length,
    outcome,
    scored,
  };
}
