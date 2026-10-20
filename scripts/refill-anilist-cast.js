/**
 * One-shot: re-queue every cast entry the old 25-character cap truncated.
 *
 * The cast query moved from one page of 25 characters to up to four (100 —
 * see `CHARACTERS_PAGE_SIZE` in src/lib/providers/anilist/cast.ts). Raising the
 * cap alone changes nothing for titles already fetched: any existing entry
 * short-circuits the lazy fetch and the /stats sweep. So the entries that sat
 * AT the old cap — the only ones that can have been cut — are dropped:
 *
 *   catalog/anilist_cast.json  { canonicalId → { characters: [25 entries], … } }
 *      →                       (entry removed)
 *
 * Entries holding fewer than 25 were already complete and are kept. A dropped
 * title refills on its next detail-page view, or all statused ones at once via
 * the cast sweep on /stats (resumable, ~2-8s a title at the shared throttle).
 * Until then its cast section and its producers read as missing. Nothing here
 * is durable user data — it is the posture's delete-and-repull.
 *
 * Idempotent: once no entry sits at 25, it is a no-op.
 *
 * Usage:
 *   node scripts/refill-anilist-cast.js <dataPath> [--dry-run]
 *   DATA_PATH=/path node scripts/refill-anilist-cast.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const DATA_PATH = args.find(a => !a.startsWith('--')) || process.env.DATA_PATH;

if (!DATA_PATH || !fs.existsSync(DATA_PATH)) {
  console.error(`Data path does not exist: ${DATA_PATH ?? '(none given)'}`);
  console.error('Usage: node scripts/refill-anilist-cast.js <dataPath> [--dry-run]');
  process.exit(1);
}

const CAST = 'catalog/anilist_cast.json';
const castPath = path.join(DATA_PATH, CAST);
if (!fs.existsSync(castPath)) {
  console.log(`No ${CAST} present — nothing to re-queue.`);
  process.exit(0);
}

const cast = JSON.parse(fs.readFileSync(castPath, 'utf-8'));
const OLD_CAP = 25;

const next = {};
let dropped = 0;
for (const [key, entry] of Object.entries(cast)) {
  if (Array.isArray(entry?.characters) && entry.characters.length >= OLD_CAP) dropped++;
  else next[key] = entry;
}

const total = Object.keys(cast).length;
console.log(`Scanned ${total} cast entries in ${DATA_PATH}: ${dropped} at the old ${OLD_CAP} cap.`);

if (dropped === 0) {
  console.log('Nothing truncated — no-op.');
  process.exit(0);
}
if (DRY_RUN) {
  console.log(`[dry run] Would drop ${dropped} entries from ${CAST}.`);
  process.exit(0);
}

// Temp file + rename, so an interrupted run never leaves a half-written slice.
const tmpPath = `${castPath}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
if (Object.keys(JSON.parse(fs.readFileSync(tmpPath, 'utf-8'))).length !== total - dropped) {
  fs.unlinkSync(tmpPath);
  console.error(`Verification failed: ${CAST} left UNTOUCHED.`);
  process.exit(1);
}
fs.renameSync(tmpPath, castPath);

console.log(
  `Done. Dropped ${dropped} entries. Next: run the cast sweep on /stats, ` +
    'or open a title to refill it.'
);
