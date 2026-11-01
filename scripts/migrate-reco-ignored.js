/**
 * `user/reco_feedback.json` -> `user/reco_ignored.json`.
 *
 * The 👍/👎 thumbs were removed in favour of a single « Ignorer » (see
 * src/lib/reco/ignored.ts for the measurement that decided it). Both verdicts
 * hard-excluded their title from the feed, so BOTH sides migrate: the owner's
 * "stop showing me this" is preserved exactly, and only the ranking effect —
 * the `feedback` source, the 👍-as-crowd-seed path and the 👎 fold into the
 * rejection profile — is dropped.
 *
 * Idempotent: re-running merges into whatever `reco_ignored.json` already holds
 * and leaves it alone once the old file is gone.
 *
 * Usage: DATA_PATH=/path/to/data node scripts/migrate-reco-ignored.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = process.env.DATA_PATH || '/app/data';
const dryRun = process.argv.includes('--dry-run');
const file = name => path.join(DATA_PATH, name);

const OLD = file('user/reco_feedback.json');
const NEW = file('user/reco_ignored.json');

if (!fs.existsSync(OLD)) {
  console.log(`[migrate-reco-ignored] ${OLD} is absent — nothing to migrate.`);
  process.exit(0);
}

const feedback = JSON.parse(fs.readFileSync(OLD, 'utf-8'));
const existing = fs.existsSync(NEW) ? JSON.parse(fs.readFileSync(NEW, 'utf-8')) : [];

const counts = { up: 0, down: 0 };
const merged = new Set(existing);
for (const [id, verdict] of Object.entries(feedback)) {
  if (verdict in counts) counts[verdict]++;
  merged.add(id);
}

const ids = [...merged];
console.log(
  `[migrate-reco-ignored] ${counts.up} 👍 + ${counts.down} 👎 -> ${ids.length} ignored id(s)` +
  (existing.length ? ` (${existing.length} already filed)` : '')
);

if (dryRun) {
  console.log('[migrate-reco-ignored] --dry-run: nothing written.');
  process.exit(0);
}

fs.writeFileSync(NEW, JSON.stringify(ids, null, 2) + '\n', 'utf-8');
fs.unlinkSync(OLD);
console.log(`[migrate-reco-ignored] wrote ${NEW} and removed ${OLD}.`);
