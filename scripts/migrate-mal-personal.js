/**
 * H1 migration (docs/PROVIDER-PARITY.md "H1"): split MAL's personal-list state
 * out of the catalog payload into its own slice, like every other provider.
 *
 *   animes_mal.json           { canonicalId → MALAnime (incl. my_list_status) }
 *      → animes_mal.json          { canonicalId → MALAnime (no my_list_status) }
 *      → animes_mal_personal.json { canonicalId → MALPersonalEntry }
 *
 * Why a script (not a startup migration): matches the canonical-id precedent —
 * a migration that runs inside the NAS container is one whose output nobody
 * reads, and the new app code REFUSES TO START against an un-migrated store
 * (it finds `my_list_status` still embedded and throws). So this must run,
 * against the stopped app, before the new image is deployed.
 *
 * Order of operations (write-verify-remove): write the personal file → verify it
 * parses and its entry count matches → rewrite the catalog with `my_list_status`
 * stripped. A crash mid-run therefore leaves the catalog untouched, never a
 * catalog stripped before its personal file exists.
 *
 * Idempotent: a catalog already free of `my_list_status` is treated as migrated
 * and the script is a no-op (it still reports). The catalog is already
 * canonical-keyed (the canonical-id migration shipped), so keys pass through —
 * no id resolution.
 *
 * Only a NON-EMPTY status is carried into the personal file. MAL's write path
 * can leave an empty-status artifact (`{ status: '', score: 8 }`); an empty
 * status is not personal state (it is exactly what `providerStateFromMal`
 * treats as absent), so it is dropped, matching split-on-ingest in store.ts.
 *
 * Usage:
 *   node scripts/migrate-mal-personal.js <dataPath> [--dry-run]
 *   DATA_PATH=/path node scripts/migrate-mal-personal.js [--dry-run]
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
  console.error('Usage: node scripts/migrate-mal-personal.js <dataPath> [--dry-run]');
  process.exit(1);
}

// Layout-aware: this script predates the folder layout (docs/DATA-LAYOUT.md) and
// a pre-H1 store is by definition pre-layout, so the flat names are the normal
// case. But the two migrations are independent scripts and can be run in either
// order, so fall through to the new paths when the store has already moved.
const FLAT = { catalog: 'animes_mal.json', personal: 'animes_mal_personal.json' };
const NESTED = { catalog: 'catalog/mal.json', personal: 'personal/mal.json' };
const layout = fs.existsSync(path.join(DATA_PATH, FLAT.catalog)) ? FLAT : NESTED;
const CATALOG = layout.catalog;
const PERSONAL = layout.personal;

const file = name => path.join(DATA_PATH, name);
const ensureDir = name => fs.mkdirSync(path.dirname(file(name)), { recursive: true });

function readJson(name, fallback) {
  const p = file(name);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error(`Failed to parse ${name}: ${e.message}`);
    process.exit(1);
  }
}

console.log(`Splitting MAL personal state in: ${DATA_PATH}${DRY_RUN ? '  (dry run)' : ''}`);

const catalog = readJson(CATALOG, null);
if (catalog === null) {
  console.log(`No ${CATALOG} present — nothing to migrate.`);
  process.exit(0);
}

// ── Extract ──
const personalOut = {};
let embedded = 0;      // rows that carried a my_list_status object at all
let carried = 0;       // rows whose status was non-empty (kept in personal file)
let droppedEmpty = 0;  // embedded but empty-status artifacts (dropped)
let strippedRows = 0;  // catalog rows that had the field removed

const nextCatalog = {};
for (const [key, anime] of Object.entries(catalog)) {
  if (anime && typeof anime === 'object' && 'my_list_status' in anime) {
    embedded++;
    const { my_list_status, ...rest } = anime;
    nextCatalog[key] = rest;
    strippedRows++;
    if (my_list_status && my_list_status.status) {
      personalOut[key] = my_list_status;
      carried++;
    } else {
      droppedEmpty++;
    }
  } else {
    nextCatalog[key] = anime;
  }
}

console.log(
  `Scanned ${Object.keys(catalog).length} catalog rows: ` +
    `${embedded} embedded my_list_status (${carried} statused → personal, ` +
    `${droppedEmpty} empty-status dropped).`
);

// ── Idempotency / merge with any existing personal file ──
const existingPersonal = readJson(PERSONAL, null);

if (embedded === 0) {
  if (existingPersonal !== null) {
    console.log(`Catalog already free of my_list_status and ${PERSONAL} exists — already migrated. No-op.`);
    process.exit(0);
  }
  console.log(`Catalog already free of my_list_status and no ${PERSONAL} — nothing to do (empty personal file will be created on first write).`);
  process.exit(0);
}

// If a personal file already exists, this is an interrupted/partial run. Refuse
// to silently last-writer-wins; merge only if the existing entries agree, else
// report and stop.
let mergedPersonal = personalOut;
if (existingPersonal !== null) {
  const conflicts = [];
  for (const [key, entry] of Object.entries(existingPersonal)) {
    if (personalOut[key] && JSON.stringify(personalOut[key]) !== JSON.stringify(entry)) {
      conflicts.push(key);
    }
  }
  if (conflicts.length > 0) {
    console.error(
      `REFUSING: ${PERSONAL} already exists AND disagrees with the catalog's embedded ` +
        `values for ${conflicts.length} title(s) (e.g. ${conflicts.slice(0, 5).join(', ')}). ` +
        `This looks like an interrupted run or a live write after a partial migration. ` +
        `Restore from backup and re-run against a clean store.`
    );
    process.exit(1);
  }
  // Union: keep any existing entry the catalog no longer carries, plus the new.
  mergedPersonal = { ...existingPersonal, ...personalOut };
  console.log(`Merged with existing ${PERSONAL} (${Object.keys(existingPersonal).length} entries) — no conflicts.`);
}

if (DRY_RUN) {
  console.log(
    `[dry run] Would write ${PERSONAL} with ${Object.keys(mergedPersonal).length} entries, ` +
      `then rewrite ${CATALOG} with my_list_status stripped from ${strippedRows} rows.`
  );
  process.exit(0);
}

// ── Write (verify) → rewrite catalog ──
// 1. personal file first.
ensureDir(PERSONAL);
fs.writeFileSync(file(PERSONAL), JSON.stringify(mergedPersonal, null, 2), 'utf-8');

// 2. verify it parses and the count matches before touching the catalog.
const verify = JSON.parse(fs.readFileSync(file(PERSONAL), 'utf-8'));
if (Object.keys(verify).length !== Object.keys(mergedPersonal).length) {
  console.error(`Verification failed: ${PERSONAL} did not round-trip. Catalog left UNTOUCHED.`);
  process.exit(1);
}

// 3. rewrite the catalog with the field stripped.
fs.writeFileSync(file(CATALOG), JSON.stringify(nextCatalog, null, 2), 'utf-8');

console.log(
  `Done. Wrote ${PERSONAL} (${Object.keys(mergedPersonal).length} entries); ` +
    `rewrote ${CATALOG} with my_list_status removed from ${strippedRows} rows.`
);
