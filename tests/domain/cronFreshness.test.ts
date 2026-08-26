/**
 * `computeCronFreshness` — is the 02:00 job still alive?
 *
 * This is the one piece of "stabilize the app" that no test of the sync code
 * could reach, because both real outages were **absences**: an 11-day 401 nobody
 * was looking for, and a truncated crontab that logged nothing at all. The
 * indicator's whole job is to notice a non-event, so what has to be pinned is
 * which non-event means what — and, above all, the two ways it could lie.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCronFreshness, CRON_STALE_AFTER_HOURS, CRON_FRESHNESS_LEVELS,
  type CronHealth,
} from '@/lib/domain/cronFreshness';

const NOW = Date.UTC(2026, 7, 26, 9, 0, 0);
const HOUR = 3_600_000;
const hoursAgo = (h: number) => NOW - h * HOUR;

const freshness = (health: CronHealth) => computeCronFreshness(health, NOW);

/**
 * ⚠️ THE reason this feature exists in the shape it does. `runCronSync` has two
 * entry points, and if the "Tout synchroniser" button counted, the first thing
 * anyone does while investigating a dead cron — press it — would turn the light
 * green and bury the outage. The manual run is still reported, so it is visible
 * that it happened and that it did not count.
 */
test('a manual run never makes the scheduled job look healthy', () => {
  const result = freshness({
    lastCronRun: { completedAt: hoursAgo(24 * 5), ok: true },
    lastManualRun: { completedAt: hoursAgo(1), ok: true },
  });

  assert.notEqual(result.level, 'ok');
  assert.equal(result.level, 'silent');
  assert.equal(result.lastCronAt, hoursAgo(24 * 5), 'the verdict reads the scheduled clock');
  assert.equal(result.lastManualAt, hoursAgo(1), 'but the manual run is still surfaced');
});

/**
 * ⚠️ The false alarm this must not raise. A tick landing while a manual run holds
 * the lock returns immediately and completes nothing — so it leaves an arrival
 * with no completion behind it, which looks exactly like a hung run. It is not
 * one: last night's completion is still recent, and that is what matters. This
 * is why `ok` is decided before `stalled`.
 */
test('a tick that collided with the run lock is not an alarm', () => {
  const result = freshness({
    lastCronRun: { completedAt: hoursAgo(24), ok: true },
    lastCronArrivalAt: hoursAgo(1),
    lastManualRun: { completedAt: hoursAgo(1.5), ok: true },
  });
  assert.equal(result.level, 'ok');
});

test('a recent scheduled run is ok', () => {
  assert.equal(freshness({ lastCronRun: { completedAt: hoursAgo(7), ok: true } }).level, 'ok');
  assert.equal(freshness({ lastCronRun: { completedAt: hoursAgo(CRON_STALE_AFTER_HOURS - 1), ok: true } }).level, 'ok');
});

/**
 * Degradation is deliberately not a level — a run with failed steps still RAN,
 * which is the question this answers. The steps ride along so the panel can say
 * so without a fifth verdict.
 */
test('failed steps are reported without changing the verdict', () => {
  const result = freshness({
    lastCronRun: { completedAt: hoursAgo(6), ok: false, failedSteps: ['simklPersonal', 'anilistPush'] },
  });
  assert.equal(result.level, 'ok');
  assert.deepEqual(result.failedSteps, ['simklPersonal', 'anilistPush']);
});

/**
 * The 2026-08-24 signature: the crontab held a truncated command, crond ran it
 * nightly, and nothing ever reached the app — so there is no arrival either.
 * Silence is the ONLY evidence, which is the whole point of the indicator.
 */
test('nothing arriving at all is silent — the truncated-crontab shape', () => {
  const result = freshness({ lastCronRun: { completedAt: hoursAgo(24 * 4), ok: true } });
  assert.equal(result.level, 'silent');
  assert.ok(result.ageHours != null && result.ageHours > CRON_STALE_AFTER_HOURS);
});

/**
 * Arrivals landing but nothing finishing is a DIFFERENT problem with a different
 * fix — a hung or crashing run rather than a broken crontab — so it gets its own
 * level rather than being folded into `silent`.
 */
test('arriving but never completing is stalled, not silent', () => {
  const result = freshness({
    lastCronRun: { completedAt: hoursAgo(24 * 4), ok: true },
    lastCronArrivalAt: hoursAgo(5),
  });
  assert.equal(result.level, 'stalled');
});

/**
 * The 2026-08-06 signature: a `cronSecret` stored in settings.json outranked the
 * env var the cron container still sent, so every tick 401'd for 11 days.
 */
test('a rejection newer than the last contact is the 401 shape', () => {
  const result = freshness({
    lastCronRun: { completedAt: hoursAgo(24 * 11), ok: true },
    lastRejection: { at: hoursAgo(7), reason: 'secretMismatch' },
  });
  assert.equal(result.level, 'rejected');
  assert.deepEqual(result.rejection, { at: hoursAgo(7), reason: 'secretMismatch' });
});

/**
 * An arrival means the auth check PASSED, so anything that arrived after a
 * rejection proves it recovered. Without this the panel would keep accusing a
 * secret that has since been fixed.
 */
test('a rejection older than the last arrival is history, not news', () => {
  const result = freshness({
    lastCronRun: { completedAt: hoursAgo(6), ok: true },
    lastCronArrivalAt: hoursAgo(6.1),
    lastRejection: { at: hoursAgo(30), reason: 'secretMismatch' },
  });
  assert.equal(result.level, 'ok');
  assert.equal(result.rejection, undefined);
});

/**
 * ⚠️ Must NOT read as a problem. The watermark is empty until the first tick
 * after this ships, so on the day it deploys this is the honest answer — and a
 * feature whose first act is to report a false outage is one nobody trusts
 * afterwards.
 */
test('an empty watermark is unknown, not an alarm', () => {
  const result = freshness({});
  assert.equal(result.level, 'unknown');
  assert.equal(result.lastCronAt, undefined);
  assert.equal(result.rejection, undefined);
});

test('every level the function can return is declared in CRON_FRESHNESS_LEVELS', () => {
  const produced = [
    freshness({}),
    freshness({ lastCronRun: { completedAt: hoursAgo(2), ok: true } }),
    freshness({ lastCronRun: { completedAt: hoursAgo(200), ok: true } }),
    freshness({ lastCronRun: { completedAt: hoursAgo(200), ok: true }, lastCronArrivalAt: hoursAgo(3) }),
    freshness({ lastRejection: { at: hoursAgo(3), reason: 'noHeader' } }),
  ].map(r => r.level);

  assert.deepEqual([...new Set(produced)].sort(), [...CRON_FRESHNESS_LEVELS].sort(),
    'the fixtures above should exercise every declared level exactly once');
});
