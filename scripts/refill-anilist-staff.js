/**
 * One-shot: re-queue every AniList entry for a staff refill.
 *
 * The staff cap moved from 15 (one truncated page) to 50 (two aliased pages of
 * 25 — AniList's per-page hard cap). Raising the constant alone changes nothing
 * for a store that is already synced: `selectMetaTargets` queues a title only
 * when `staff === undefined`, and an entry holding 15 credits looks complete. So
 * the refill signal has to be re-armed, which is what this does:
 *
 *   catalog/anilist.json  { canonicalId → { …, staff: [15 entries] } }
 *      →                  { canonicalId → { …            } }   (staff removed)
 *
 * Then run "Sync AniList Metadata" on /connections (or let cron-sync reach it).
 * The sweep re-fetches tags + staff + banner + relations in the same query, so
 * the wider staff costs no extra requests — roughly 19k entries / 50 per batch
 * ≈ 390 requests at the shared ~2.1s throttle ≈ 14 minutes.
 *
 * Why a script rather than a version field on the entry: `catalog/anilist.json`
 * is refetchable provider data with exactly one copy in the world, so the
 * cheap move is to drop the stale slice and re-pull it (CLAUDE.md, "Project
 * posture"). A `staff_version` marker would be a permanent compat shim paid on
 * every read to save a one-time 14-minute sweep.
 *
 * NOTE the staff-shaped surfaces read empty until that sweep completes — the
 * detail page's staff block, /stats' technical-staff dimension, and
 * /credits/staff/[id]. Tags, banners and relations are untouched by this script,
 * but they DO get rewritten by the sweep that follows. Nothing here is durable
 * user data.
 *
 * Idempotent: a slice with no staff anywhere is a no-op (it still reports).
 *
 * Usage:
 *   node scripts/refill-anilist-staff.js <dataPath> [--dry-run]
 *   DATA_PATH=/path node scripts/refill-anilist-staff.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── args ──
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const DRY_RUN = flags.has('--dry-run');

function defaultDataPath() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'anime-app', 'data');
  }
  return path.join(os.homedir(), '.anime-app', 'data');
}

const DATA_PATH = positional[0] || process.env.DATA_PATH || defaultDataPath();

if (!fs.existsSync(DATA_PATH)) {
  console.error(`Data path does not exist: ${DATA_PATH}`);
  console.error('Usage: node scripts/refill-anilist-staff.js <dataPath> [--dry-run]');
  process.exit(1);
}

const META = 'catalog/anilist.json';
const file = name => path.join(DATA_PATH, name);

const metaPath = file(META);
if (!fs.existsSync(metaPath)) {
  console.log(`No ${META} present — nothing to re-queue (the first sync will fetch the full staff list).`);
  process.exit(0);
}

let meta;
try {
  meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
} catch (e) {
  console.error(`Failed to parse ${META}: ${e.message}`);
  process.exit(1);
}

console.log(`Re-arming the AniList staff refill in: ${DATA_PATH}${DRY_RUN ? '  (dry run)' : ''}`);

// ── Strip ──
const OLD_CAP = 15;
let stripped = 0;
let credits = 0;
let atOldCap = 0;

const next = {};
for (const [key, entry] of Object.entries(meta)) {
  if (entry && typeof entry === 'object' && Array.isArray(entry.staff)) {
    credits += entry.staff.length;
    if (entry.staff.length >= OLD_CAP) atOldCap++;
    const { staff, ...rest } = entry;
    next[key] = rest;
    stripped++;
  } else {
    next[key] = entry;
  }
}

const total = Object.keys(meta).length;
console.log(
  `Scanned ${total} entries: ${stripped} carried a staff array ` +
    `(${credits} credits total, ${atOldCap} sitting at the old ${OLD_CAP} cap — those were truncated).`
);

if (stripped === 0) {
  console.log('No staff arrays found — already re-queued, or never synced. No-op.');
  process.exit(0);
}

if (DRY_RUN) {
  console.log(`[dry run] Would rewrite ${META} with staff removed from ${stripped} entries.`);
  process.exit(0);
}

// ── Write (verify) ──
// Write to a sibling temp file and rename, so an interrupted run can never leave
// a half-written 57 MB slice the app would then refuse to parse.
const tmpPath = `${metaPath}.tmp`;
fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');

const verify = JSON.parse(fs.readFileSync(tmpPath, 'utf-8'));
if (Object.keys(verify).length !== total) {
  console.error(`Verification failed: ${META} did not round-trip. Original left UNTOUCHED.`);
  fs.unlinkSync(tmpPath);
  process.exit(1);
}

fs.renameSync(tmpPath, metaPath);

console.log(
  `Done. Rewrote ${META} with staff removed from ${stripped} entries.\n` +
    `Next: run "Sync AniList Metadata" on /connections to refill at the 50-credit cap.`
);
