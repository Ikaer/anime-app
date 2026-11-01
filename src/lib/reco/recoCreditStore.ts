/**
 * `user/reco_credit.json` — the `fs` half of « Vu grâce à la reco ». The rules
 * and the reason the flag exists are the pure `recoCredit.ts`; this module only
 * reads and writes.
 *
 * ⚠️ Durable user data, like `boxes.json`: it records that the owner credited
 * the engine for a title, which no provider and no rebuild can re-supply.
 *
 * Lives in `reco/` rather than `store/` for `seedMutes.ts`' reason: it is a
 * recommendation-engine annotation, not a slice of the record, so it is off the
 * seven-slice join and a write here cannot change any assembled row (no
 * `invalidateRecordCache`). Server-only.
 */
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { creditDay, type RecoCreditMap } from '@/lib/reco/recoCredit';

const RECO_CREDIT_FILE = dataFile('user/reco_credit.json');

export function getRecoCredits(): RecoCreditMap {
  return readJsonFile<RecoCreditMap>(RECO_CREDIT_FILE, {});
}

/** The ids alone, for the per-card membership test the feed and the detail page make. */
export function getRecoCreditSet(): Set<string> {
  return new Set(Object.keys(getRecoCredits()));
}

/**
 * Credit the engine for a title. ⚠️ Idempotent on the DATE: re-crediting an
 * already-credited title keeps the first `at`, because that date is the one
 * thing here that cannot be recovered — it is roughly when the feed proposed
 * it, and overwriting it with today's would turn an old pick into a new one in
 * every per-period count.
 */
export function addRecoCredit(canonicalId: string, now = new Date()): void {
  const credits = getRecoCredits();
  if (credits[canonicalId]) return;
  credits[canonicalId] = { at: creditDay(now) };
  writeJsonFile(RECO_CREDIT_FILE, credits);
}

export function removeRecoCredit(canonicalId: string): void {
  const credits = getRecoCredits();
  if (!(canonicalId in credits)) return;
  delete credits[canonicalId];
  writeJsonFile(RECO_CREDIT_FILE, credits);
}
