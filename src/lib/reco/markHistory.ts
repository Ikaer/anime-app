/**
 * The « Recommandé » mark's history — what the mark said about a title BEFORE
 * the owner judged it, so it can be held against the score they gave in the end.
 *
 * **Why it has to be recorded rather than replayed.** `scripts/probe-affinity.js`
 * replays a past season, but it scores it with TODAY's AniList tags, which
 * accumulate by vote as a show airs (median 4 strong tags the season before
 * airing vs 12 after). So the probe measures a ceiling, never what was actually
 * on screen. The only honest version of that question is a snapshot taken at the
 * time, and only the running app is there at the time. Hence this file, written
 * by the cron (`cronSync.ts`, step `affinityMarks`) and read by
 * `scripts/probe-marks.js`.
 *
 * **Per TITLE, not per season**, because a show does not respect season
 * boundaries — a split-cour, a two-season run, a title announced a year out.
 * Three points per title, each tied to the title's own clock:
 *
 *  - `first`  — the first time the cron saw it unaired. Written ONCE.
 *  - `preAir` — the LAST observation while still unaired, overwritten every
 *    tick until it airs, then frozen. This is "what the badge said the day it
 *    came out", the question actually being asked; `first` beside it shows how
 *    much the mark moved while metadata arrived.
 *  - `ep3`    — the first tick at or after `startDate + EP3_DAY_OFFSET`, which is
 *    where a show's community score has roughly settled (about three weekly
 *    episodes; a mid-cour break makes it two, accepted). Written ONCE, and only
 *    inside `[offset, offset + EP3_WINDOW_DAYS]`: a store that starts capturing
 *    today must not stamp every title that aired years ago with a fake "J+21".
 *
 * ⚠️ **A point is only taken off a DAY-PRECISE `startDate`** for `ep3`.
 * `Date.parse('2026-10')` is Oct 1st, so an imprecise date would silently pin
 * J+21 to the wrong day. Such titles simply get no `ep3`; the probe counts them.
 *
 * ⚠️ **This is durable data**, in `history/`: nothing can re-supply what the
 * mark said in the past. Same class as `user/` for `data:copy*` purposes.
 *
 * Pure (records in, history out) and client-safe; the `fs` half is
 * `markHistoryStore.ts`. Pinned in tests/reco/markHistory.test.ts.
 */
import type { AnimeRecord, AffinityTier } from '@/models/anime';
import { getEffectiveStatus } from '@/lib/domain/animeUtils';
import { AFFINITY_TAG_MIN_RANK, isUnseenCandidate, type AffinityIndex } from '@/lib/reco/affinity';

/** Days after `startDate` the settled-score point is taken. ~3 weekly episodes. */
export const EP3_DAY_OFFSET = 21;
/** How late past the offset a missed tick may still take the point. */
export const EP3_WINDOW_DAYS = 14;

export interface MarkPoint {
  /** Capture day, `YYYY-MM-DD` (UTC). */
  at: string;
  /** Affinity score; `null` = unscoreable (no AniList tags/staff yet). */
  score: number | null;
  /** Share of the eligible unseen catalog scoring below it — comparable across time, unlike the raw score. */
  pct: number | null;
  /** The tier the score reaches against that day's cuts, eligible or not. */
  tier: AffinityTier | null;
  /** Whether the badge was actually on screen (unseen, not a premature sequel, above the cut). */
  shown: boolean;
  /** Metadata density: AniList tags above the rank floor, and staff credits. */
  tags: number;
  staff: number;
  /** The owner's effective status at capture — a binge release can be finished by J+21. */
  status?: string;
}

export interface Ep3Point extends MarkPoint {
  /** Days since `startDate` at capture (21 unless a tick was missed). */
  day: number;
  /** Community means on MAL's 1-10 scale, read raw per provider. */
  malMean?: number;
  anilistMean?: number;
  /** MAL's scoring-user count, so a mean of 7.8 on 40 voters reads as such. */
  scoringUsers?: number;
}

export interface MarkHistoryEntry {
  /** `startDate` as last seen — it moves (delays, TBA → dated). */
  startDate?: string;
  first?: MarkPoint;
  preAir?: MarkPoint;
  ep3?: Ep3Point;
}

export type MarkHistory = Record<string, MarkHistoryEntry>;

const DAY_PRECISE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` (UTC) of an instant. */
export function isoDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Not aired yet, as far as the catalog can tell: no community mean, no airing
 * status saying otherwise, and a start date that is absent (TBA) or still ahead. An imprecise date (`2026-10`) is
 * compared on its own precision, so a title dated "this month" stays unaired
 * until a mean or a precise date says otherwise.
 */
export function isPreAir(anime: AnimeRecord, today: string): boolean {
  if (anime.catalog.mean) return false;
  const airing = anime.catalog.airingStatus;
  if (airing === 'currently_airing' || airing === 'finished_airing') return false;
  const start = anime.catalog.startDate;
  if (!start) return true;
  // A precise date already behind us wins over a stale `not_yet_aired`.
  return start >= today.slice(0, start.length);
}

function point(anime: AnimeRecord, index: AffinityIndex, today: string): MarkPoint {
  const score = index.scoreOf(anime);
  const src = anime.sources.anilist;
  const tier: AffinityTier | null =
    score == null ? null
    : score >= index.thresholds.strong ? 'strong'
    : score >= index.thresholds.notable ? 'notable'
    : null;
  const status = getEffectiveStatus(anime);
  return {
    at: today,
    score,
    pct: score == null ? null : index.percentileOf(score),
    tier,
    shown: index.marks.has(anime.id),
    tags: (src?.tags || []).filter(t => (t.rank ?? 0) >= AFFINITY_TAG_MIN_RANK).length,
    staff: (src?.staff || []).length,
    ...(status ? { status } : {}),
  };
}

/**
 * One tick's worth of captures. Returns a NEW history (the input is a parse-
 * cache object and must not be mutated — the `jsonStore` contract) and how many
 * points of each kind were written.
 */
export function captureMarks(
  all: AnimeRecord[],
  index: AffinityIndex,
  history: MarkHistory,
  options: { now: Date; downIds: ReadonlySet<string> },
): { history: MarkHistory; written: { first: number; preAir: number; ep3: number } } {
  const today = isoDay(options.now);
  const next: MarkHistory = { ...history };
  const written = { first: 0, preAir: 0, ep3: 0 };

  for (const anime of all) {
    const prev = history[anime.id];
    const start = anime.catalog.startDate;

    if (isPreAir(anime, today)) {
      // Only what the badge could have been on: unseen and not refused.
      if (!isUnseenCandidate(anime, options.downIds)) continue;
      const p = point(anime, index, today);
      next[anime.id] = {
        ...prev,
        ...(start ? { startDate: start } : {}),
        first: prev?.first ?? p,
        preAir: p,
      };
      if (!prev?.first) written.first++;
      written.preAir++;
      continue;
    }

    if (prev?.ep3 || !start || !DAY_PRECISE.test(start)) continue;
    const day = daysBetween(start, today);
    if (day < EP3_DAY_OFFSET || day > EP3_DAY_OFFSET + EP3_WINDOW_DAYS) continue;

    const raw = { mal: anime.sources.mal?.mean, anilist: anime.sources.anilist?.catalog?.mean };
    next[anime.id] = {
      ...prev,
      startDate: start,
      ep3: {
        ...point(anime, index, today),
        day,
        ...(raw.mal ? { malMean: raw.mal } : {}),
        ...(raw.anilist ? { anilistMean: raw.anilist } : {}),
        ...(anime.catalog.numScoringUsers ? { scoringUsers: anime.catalog.numScoringUsers } : {}),
      },
    };
    written.ep3++;
  }

  return { history: next, written };
}
