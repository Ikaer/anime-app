/**
 * Phase B migration (docs/PROVIDER-FREE-CUTOVER.md): re-key every
 * identity-bearing store file from its provider id (MAL id) to the synthetic
 * canonical id, so the canonical id becomes the only key at rest. The registry
 * (animes_registry.json) is the durable identity spine and is preserved /
 * extended, never rebuilt.
 *
 * Re-keyed files (the catalog slices — Phase B):
 *   animes_mal.json               { malId → MALAnime }            → { canonicalId → MALAnime }
 *   animes_simkl.json             { malId → SimklPersonalEntry }  → { canonicalId → ... }
 *   animes_anilist_meta.json      { malId → AniListMetaEntry }    → { canonicalId → ... }
 *   animes_anilist_personal.json  { malId → AniListPersonalEntry} → { canonicalId → ... }
 *
 * Left untouched (deferred to Phase D, when the reco engine + outward id flip):
 *   animes_hidden.json            [ malId ]   — still MAL-keyed
 *   recommendations_feedback.json { malId … } — still MAL-keyed
 * These stay MAL-keyed on purpose: the reco engine that reads them is MAL-id-
 * keyed internally until Phase D, and the Phase B runtime reads hidden/feedback
 * by MAL id. Re-keying them now would silently mis-attach hides/thumbs.
 *
 * Also left untouched: the registry itself, recommendations.json +
 * recommendations_dismissed.json (reco cache — Phase D), auth/checkpoint/
 * preferences files, and animes_extensions.json (orphan — read by nothing).
 *
 * Resolve-before-mint: every provider id is resolved against the registry
 * first; a new canonical id is minted only for a title the registry doesn't
 * already anchor.
 *
 * Idempotent / re-runnable: slice records are re-keyed from the provider id
 * carried INSIDE each record (`anime.id`, `entry.mal_id`, `entry.anilist_id`),
 * not from the current top-level key, so a second run over already-canonical
 * keys yields the identical mapping.
 *
 * Collision policy: a provider id claimed by two+ canonical ids corrupts the
 * spine. The script REPORTS every such collision and REFUSES to write (exit 1)
 * unless `--allow-collisions` is passed. Nothing is written until resolution is
 * proven clean.
 *
 * Usage:
 *   node scripts/migrate-canonical.js <dataPath> [--dry-run] [--allow-collisions]
 *   DATA_PATH=/path node scripts/migrate-canonical.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── args ──
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const DRY_RUN = flags.has('--dry-run');
const ALLOW_COLLISIONS = flags.has('--allow-collisions');

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
  console.error('Usage: node scripts/migrate-canonical.js <dataPath> [--dry-run] [--allow-collisions]');
  process.exit(1);
}

console.log(`Migrating store to canonical ids in: ${DATA_PATH}${DRY_RUN ? '  (dry run)' : ''}`);

const file = name => path.join(DATA_PATH, name);
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
function writeJson(name, data) {
  if (DRY_RUN) return;
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2), 'utf-8');
}

// ── registry + resolver (faithful port of resolveCanonicalIds in src/lib/store.ts) ──
const registry = readJson('animes_registry.json', {});

function toNum(v) {
  if (typeof v === 'number') return Number.isNaN(v) ? undefined : v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}
function buildIndex(key) {
  const index = new Map();
  for (const [canonicalId, ids] of Object.entries(registry)) {
    const v = toNum(ids[key]);
    if (v !== undefined && !index.has(v)) index.set(v, canonicalId);
  }
  return index;
}
const malIndex = buildIndex('mal');
const anilistIndex = buildIndex('anilist');
const simklIndex = buildIndex('simkl');
let counter = 0;
for (const id of Object.keys(registry)) {
  const m = /^a_(\d+)$/.exec(id);
  if (m) counter = Math.max(counter, parseInt(m[1], 10));
}

let minted = 0;
/** Resolve a provider-id crosswalk to a canonical id (mal → anilist → simkl), minting if new. */
function resolve(crosswalk) {
  const malId = toNum(crosswalk.mal);
  const anilistId = toNum(crosswalk.anilist);
  const simklId = toNum(crosswalk.simkl);

  let canonicalId =
    (malId !== undefined ? malIndex.get(malId) : undefined) ||
    (anilistId !== undefined ? anilistIndex.get(anilistId) : undefined) ||
    (simklId !== undefined ? simklIndex.get(simklId) : undefined);

  if (!canonicalId) {
    counter += 1;
    canonicalId = `a_${counter}`;
    registry[canonicalId] = {};
    minted += 1;
  }
  const entry = registry[canonicalId];
  for (const [k, v] of Object.entries(crosswalk)) {
    if (v === undefined) continue;
    if (entry[k] !== v) entry[k] = v;
  }
  if (malId !== undefined && !malIndex.has(malId)) malIndex.set(malId, canonicalId);
  if (anilistId !== undefined && !anilistIndex.has(anilistId)) anilistIndex.set(anilistId, canonicalId);
  if (simklId !== undefined && !simklIndex.has(simklId)) simklIndex.set(simklId, canonicalId);
  return canonicalId;
}

// All re-keying resolves into in-memory buffers FIRST; nothing is written until
// the collision scan proves the mapping clean. Writing inline would leave the
// slices re-keyed but the registry un-written (inconsistent store) whenever the
// scan halts. `pendingWrites` collects { name, data } to flush atomically at the end.
const pendingWrites = [];

// Output-key collisions: two source records that resolve to the SAME canonical
// id. One would silently overwrite the other (data loss). This is the concrete
// shape a MAL-split-vs-SIMKL-merge takes — two MAL ids sharing one simkl_id, both
// resolving through that simkl_id to one canonical (verified against live data).
// Collected across every slice, reported and halted like a registry collision.
const outputCollisions = [];

// ── re-key a { providerId → record } map by the provider id carried in each record ──
function rekeyRecordMap(name, deriveCrosswalk) {
  const src = readJson(name, null);
  if (src === null) return { name, present: false };
  const out = {};
  const claimants = new Map(); // canonicalId → [source keys], to describe a collision
  let count = 0;
  let orphaned = 0;
  for (const [key, record] of Object.entries(src)) {
    const crosswalk = deriveCrosswalk(record, key);
    if (!crosswalk) {
      orphaned += 1;
      continue;
    }
    const canonicalId = resolve(crosswalk);
    if (out[canonicalId] !== undefined) {
      claimants.get(canonicalId).push(key);
    } else {
      claimants.set(canonicalId, [key]);
      count += 1;
    }
    out[canonicalId] = record; // last-writer-wins (only reached on a flagged collision)
  }
  for (const [canonicalId, keys] of claimants) {
    if (keys.length > 1) outputCollisions.push({ name, canonicalId, keys });
  }
  pendingWrites.push({ name, data: out });
  return { name, present: true, count, orphaned };
}

// animes_mal.json — resolve from the MAL record's own id.
const malResult = rekeyRecordMap('animes_mal.json', anime => {
  const mal = toNum(anime && anime.id);
  return mal !== undefined ? { mal } : null;
});

// animes_simkl.json — resolve from mal_id, carry the rich `ids` crosswalk too.
const simklResult = rekeyRecordMap('animes_simkl.json', entry => {
  if (!entry) return null;
  const mal = toNum(entry.mal_id);
  const crosswalk = { ...(entry.ids || {}) };
  if (mal !== undefined) crosswalk.mal = mal;
  if (toNum(entry.simkl_id) !== undefined) crosswalk.simkl = toNum(entry.simkl_id);
  return mal !== undefined || crosswalk.simkl !== undefined ? crosswalk : null;
});

// animes_anilist_meta.json — resolve from mal_id, carry anilist_id.
const anilistMetaResult = rekeyRecordMap('animes_anilist_meta.json', entry => {
  if (!entry) return null;
  const mal = toNum(entry.mal_id);
  const anilist = toNum(entry.anilist_id);
  if (mal === undefined && anilist === undefined) return null;
  const crosswalk = {};
  if (mal !== undefined) crosswalk.mal = mal;
  if (anilist !== undefined) crosswalk.anilist = anilist;
  return crosswalk;
});

// animes_anilist_personal.json — resolve from anilist_id (the entry has no mal_id;
// the store keys it by mal externally, so the crosswalk must come from anilist_id).
const anilistPersonalResult = rekeyRecordMap('animes_anilist_personal.json', (entry, key) => {
  if (!entry) return null;
  const anilist = toNum(entry.anilist_id);
  const mal = toNum(key); // external key was the mal id
  if (anilist === undefined && mal === undefined) return null;
  const crosswalk = {};
  if (mal !== undefined) crosswalk.mal = mal;
  if (anilist !== undefined) crosswalk.anilist = anilist;
  return crosswalk;
});

// animes_hidden.json + recommendations_feedback.json are deliberately NOT
// re-keyed here — they stay MAL-keyed until Phase D (see the header). The
// Phase B runtime reads them by MAL id.

// ── collision scan on the FINAL registry ──
// ONLY the per-title resolution keys can corrupt the spine: `resolve()` keys on
// mal → anilist → simkl, so a two-claimant state on one of those makes identity
// ambiguous. The other crosswalk ids SIMKL carries (`slug`/`imdb`/`tvdbslug`/
// `tmdb`) are FRANCHISE- or series-level — one `slug` legitimately spans every
// season of a show, each its own title — so they are expected to repeat and are
// not identity collisions. Scanning them would false-positive on every multi-cour
// franchise (verified against live data).
const RESOLUTION_KEYS = ['mal', 'anilist', 'simkl'];
const claims = new Map();
for (const [canonicalId, ids] of Object.entries(registry)) {
  for (const key of RESOLUTION_KEYS) {
    const value = toNum(ids[key]);
    if (value === undefined) continue;
    const claimKey = `${key}:${value}`;
    if (!claims.has(claimKey)) claims.set(claimKey, []);
    claims.get(claimKey).push(canonicalId);
  }
}
const registryCollisions = [...claims.entries()].filter(([, ids]) => ids.length > 1);

// ── report ──
console.log('\nRe-keyed:');
for (const r of [malResult, simklResult, anilistMetaResult, anilistPersonalResult]) {
  if (!r.present) {
    console.log(`  ${r.name.padEnd(32)} (absent, skipped)`);
  } else {
    console.log(`  ${r.name.padEnd(32)} ${r.count} entries${r.orphaned ? ` (${r.orphaned} orphaned, no id)` : ''}`);
  }
}
console.log(`\nRegistry: ${Object.keys(registry).length} canonical ids (${minted} newly minted this run).`);

const hasCollisions = registryCollisions.length > 0 || outputCollisions.length > 0;

if (outputCollisions.length > 0) {
  console.warn(`\n${outputCollisions.length} output-key collision(s) — 2+ source records resolve to one canonical id (one would overwrite the other):`);
  for (const c of outputCollisions.slice(0, 50)) {
    console.warn(`  ${c.name}: keys [${c.keys.join(', ')}] → ${c.canonicalId}`);
  }
  if (outputCollisions.length > 50) console.warn(`  … and ${outputCollisions.length - 50} more`);
}

if (registryCollisions.length > 0) {
  console.warn(`\n${registryCollisions.length} registry collision(s) — same resolution id claimed by multiple canonical ids:`);
  for (const [claimKey, ids] of registryCollisions.slice(0, 50)) {
    console.warn(`  ${claimKey}  ->  ${ids.join(', ')}`);
  }
  if (registryCollisions.length > 50) console.warn(`  … and ${registryCollisions.length - 50} more`);
}

if (hasCollisions) {
  if (!ALLOW_COLLISIONS) {
    console.error('\nRefusing to write a corrupted identity spine. Resolve the collisions or re-run with --allow-collisions.');
    process.exit(1);
  }
  console.warn('\n--allow-collisions set: writing anyway (last-writer-wins per collided canonical id).');
}

if (DRY_RUN) {
  console.log('\nDry run — no files written.');
} else {
  // Atomic-ish flush: slices proven clean (or explicitly forced), then the
  // registry last, so a re-keyed slice never lands without its registry.
  for (const { name, data } of pendingWrites) writeJson(name, data);
  writeJson('animes_registry.json', registry);
  console.log('\nMigration complete. Registry + re-keyed slices written.');
}
