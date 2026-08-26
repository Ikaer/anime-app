/**
 * Is the 02:00 cron job still alive?
 *
 * ## Why this exists
 *
 * Both real cron outages this app has had were **silent**, and neither is
 * reachable by a test (see CLAUDE.md, "Scheduled sync"):
 *
 *  - 2026-08-06: a `cronSecret` saved via `/settings` outranked the `CRON_SECRET`
 *    the compose cron container still sent (`resolveSetting` reads stored before
 *    env), so every tick 401'd **for 11 days**. The symptom was AniList progress
 *    frozen while MAL and SIMKL advanced, because `anilistPush` only ever runs
 *    from the cron.
 *  - 2026-08-24: the secret was baked into a `printf` FORMAT string, a
 *    metacharacter truncated it mid-quote, and `/etc/crontabs/root` ended up
 *    holding an unterminated command. crond ran `sh -c` on it nightly and
 *    **nothing reached the app at all** — not even the 401 path logged.
 *
 * The second is the important shape: the evidence of failure was *the absence of
 * evidence*. Nothing on screen said anything, because nothing had happened.
 *
 * ## Why not derive this from the connection log
 *
 * `logs/connection_log.json` is a 500-entry rolling buffer shared by every
 * channel, and `anilist/sync.ts` alone has 39 `appendLog` sites — a busy day can
 * evict a whole run. "Scrolled out of the buffer" and "never happened" would be
 * indistinguishable, which is precisely the distinction this has to make. So the
 * facts are stamped into their own tiny watermark (`providers/cronHealth.ts`)
 * and this module is the pure reading of it.
 *
 * ## The two rules that make it worth having
 *
 * ⚠️ **A manual run must never count.** `runCronSync` has two entry points —
 * the 02:00 tick and the "Tout synchroniser" button — and if pressing the button
 * turned the light green, the first thing anyone does while investigating a dead
 * cron would hide the very outage this exists to catch. `lastManualRun` is
 * recorded and reported, but it decides nothing.
 *
 * ⚠️ **Arrival is stamped separately from completion**, so the two silences stay
 * apart. They have different fixes: nothing arriving is a crontab or container
 * problem (the `printf` signature), while arriving and never completing is a
 * hung or crashing run. Collapsing them into one "stale" would also cry wolf on
 * a lock collision — a tick that lands during a manual run returns immediately
 * on `isRunning` and completes nothing, which is not a failure at all.
 */

/** A finished `runCronSync`, per trigger. */
export interface CronRunRecord {
  completedAt: number;
  ok: boolean;
  /** Step names that reported `ok: false` — the run happened but was degraded. */
  failedSteps?: string[];
}

/** Why a cron request was turned away at the door, before `runCronSync`. */
export type CronRejectionReason = 'method' | 'secretMismatch' | 'noHeader';

export interface CronRejection {
  at: number;
  reason: CronRejectionReason;
}

/** The watermark, persisted at `sync/cron_health.json`. */
export interface CronHealth {
  /**
   * A cron request that PASSED the auth check, stamped before the run starts.
   * Proves the request reached the app even when the run then does nothing
   * (lock held) or never finishes.
   */
  lastCronArrivalAt?: number;
  lastCronRun?: CronRunRecord;
  /** Recorded and shown, but deliberately not part of the freshness verdict. */
  lastManualRun?: CronRunRecord;
  lastRejection?: CronRejection;
}

/**
 * Each level is a DIFFERENT FIX, which is the only reason there is more than
 * one. Degradation is not a level — a run with failed steps is still a run, and
 * `failedSteps` on the result carries it.
 *
 * - `ok`        — a scheduled run completed recently.
 * - `rejected`  — requests are arriving and being turned away. Check the secret.
 * - `stalled`   — requests arrive but no run completes. The run is hung/crashing.
 * - `silent`    — nothing is arriving. Check crond, the container, the URL.
 * - `unknown`   — nothing recorded yet. NOT an alarm: the watermark is empty
 *                 until the first tick after this shipped, so on a fresh deploy
 *                 this is the honest answer for up to a day.
 */
export type CronFreshnessLevel = 'ok' | 'rejected' | 'stalled' | 'silent' | 'unknown';

export const CRON_FRESHNESS_LEVELS: CronFreshnessLevel[] =
  ['ok', 'rejected', 'stalled', 'silent', 'unknown'];

/**
 * The job runs `0 2 * * *`. 36 hours lets a full night be missed before the
 * indicator says anything, so a one-off overrun or a clock skew is not an
 * alarm, while a second missed night always is.
 */
export const CRON_STALE_AFTER_HOURS = 36;

export interface CronFreshness {
  level: CronFreshnessLevel;
  /** Completion of the last SCHEDULED run — the only clock that decides `level`. */
  lastCronAt?: number;
  /** Hours since `lastCronAt`, rounded to one decimal. */
  ageHours?: number;
  /** Steps that failed in that run. Present at any level, including `ok`. */
  failedSteps?: string[];
  /** Shown so a manual run is visible, never counted toward the verdict. */
  lastManualAt?: number;
  /** Set on `rejected`, so the message can name which failure shape it is. */
  rejection?: CronRejection;
}

const HOUR_MS = 3_600_000;

/**
 * Derive the verdict. Pure — `now` is a parameter so this is testable and so a
 * server render and a client render of the same watermark cannot disagree.
 *
 * Order is load-bearing. `ok` is decided BEFORE `stalled`, which is what stops a
 * lock collision from raising an alarm: the tick that arrived and did nothing
 * leaves an arrival newer than any completion, but last night's completion is
 * still recent, and a recent completion is the thing that actually matters.
 */
export function computeCronFreshness(health: CronHealth, now: number): CronFreshness {
  const { lastCronArrivalAt, lastCronRun, lastManualRun, lastRejection } = health;

  const base: CronFreshness = {
    level: 'unknown',
    ...(lastCronRun ? { lastCronAt: lastCronRun.completedAt } : {}),
    ...(lastCronRun?.failedSteps?.length ? { failedSteps: lastCronRun.failedSteps } : {}),
    ...(lastManualRun ? { lastManualAt: lastManualRun.completedAt } : {}),
    ...(lastCronRun ? { ageHours: Math.round(((now - lastCronRun.completedAt) / HOUR_MS) * 10) / 10 } : {}),
  };

  // Nothing scheduled has ever been seen. Reported before anything else so a
  // fresh install is never told it has a problem.
  if (!lastCronArrivalAt && !lastCronRun && !lastRejection) return base;

  // A rejection is only news while it is the LATEST thing the cron did: an
  // arrival is proof the auth check passed, so a later arrival means it
  // recovered and the old rejection is history.
  const lastContact = Math.max(lastCronArrivalAt ?? 0, lastCronRun?.completedAt ?? 0);
  if (lastRejection && lastRejection.at > lastContact) {
    return { ...base, level: 'rejected', rejection: lastRejection };
  }

  const fresh = lastCronRun != null && now - lastCronRun.completedAt <= CRON_STALE_AFTER_HOURS * HOUR_MS;
  if (fresh) return { ...base, level: 'ok' };

  // Requests are reaching us; the run is what is broken.
  if (lastCronArrivalAt != null && lastCronArrivalAt > (lastCronRun?.completedAt ?? 0)) {
    return { ...base, level: 'stalled' };
  }

  return { ...base, level: 'silent' };
}
