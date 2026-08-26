/**
 * The cron watermark — `sync/cron_health.json`.
 *
 * Server-only (it touches `fs` through `jsonStore`); the pure reading of what it
 * stores, and the reasoning behind every field, lives in
 * [domain/cronFreshness.ts](../domain/cronFreshness.ts), which React may import.
 *
 * It sits under `sync/` beside `simkl_checkpoint.json` and `anilist_years.json`
 * because it is the same kind of thing: a tiny watermark about a sync, not a
 * slice of the record. It is **rebuildable in the sense that nothing breaks
 * without it** — a deleted file simply reports `unknown` until the next tick —
 * so it is not in the durable-user-data class and needs no backup ceremony.
 *
 * Every writer here is read-modify-write through `writeJsonFile`, which is what
 * the `jsonStore` shared-reference contract requires: the parse cache hands back
 * the same object to later readers, so a mutation that is not written back would
 * leak into them.
 */
import { readJsonFile, writeJsonFile, dataFile } from '@/lib/store/jsonStore';
import type { CronHealth, CronRejectionReason, CronRunRecord } from '@/lib/domain/cronFreshness';

const HEALTH_FILE = dataFile('sync/cron_health.json');

export function getCronHealth(): CronHealth {
  return readJsonFile<CronHealth>(HEALTH_FILE, {});
}

function update(patch: (current: CronHealth) => CronHealth): void {
  writeJsonFile(HEALTH_FILE, patch({ ...getCronHealth() }));
}

/**
 * A cron request passed the auth check.
 *
 * ⚠️ Stamped by the ROUTE, before `runCronSync` is called — not inside it. That
 * is the whole point: `runCronSync` returns immediately when the lock is held,
 * so a tick landing during a manual run would otherwise leave no trace and drift
 * the indicator toward an alarm while the cron is perfectly healthy. It also
 * separates "nothing is arriving" (crontab/container) from "arriving but never
 * finishing" (a hung run), which are different problems with different fixes.
 */
export function recordCronArrival(at = Date.now()): void {
  update(health => ({ ...health, lastCronArrivalAt: at }));
}

/**
 * A cron request was turned away at the door (405, or a secret that did not
 * match). These never reach `runCronSync`, so nothing else would record them —
 * and this is the 11-day-401 signature.
 */
export function recordCronRejection(reason: CronRejectionReason, at = Date.now()): void {
  update(health => ({ ...health, lastRejection: { at, reason } }));
}

/**
 * A run finished.
 *
 * ⚠️ `trigger` is required rather than defaulted, so both call sites must say
 * which they are. A manual "Tout synchroniser" is recorded under its own key and
 * **never counts toward freshness**: if it did, pressing the button — the first
 * thing anyone does when investigating a dead cron — would turn the light green
 * and hide the outage.
 */
export function recordCronRun(
  trigger: 'cron' | 'manual',
  run: CronRunRecord,
): void {
  update(health => ({ ...health, [trigger === 'cron' ? 'lastCronRun' : 'lastManualRun']: run }));
}
