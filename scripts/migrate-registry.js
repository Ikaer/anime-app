/**
 * Phase 1 migration (docs/PROVIDER-FREE.md): seeds animes_registry.json with
 * one canonical id per known MAL id, crosswalk assembled from animes_mal.json
 * + animes_simkl.json + animes_anilist_meta.json.
 *
 * Idempotent — safe to re-run. Only mints ids for MAL ids not already
 * anchored, and reports (never resolves) any provider id claimed by more than
 * one canonical id.
 *
 * The app self-heals the same registry on every read (see getAnimeForDisplay
 * in src/lib/store.ts), so running this script is a convenience — an explicit,
 * offline seed + collision report before the app does it implicitly.
 *
 * Usage: DATA_PATH=/path/to/data node scripts/migrate-registry.js
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = process.env.DATA_PATH || '/app/data';
const file = name => path.join(DATA_PATH, name);

function readJson(name, fallback) {
  const p = file(name);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function assembleCrosswalk(malId, simkl, meta) {
  const crosswalk = { ...(simkl && simkl.ids ? simkl.ids : {}), mal: malId };
  if (simkl && simkl.simkl_id) crosswalk.simkl = simkl.simkl_id;
  if (meta && meta.anilist_id) crosswalk.anilist = meta.anilist_id;
  return crosswalk;
}

const malAnime = readJson('animes_mal.json', {});
const simklEntries = readJson('animes_simkl.json', {});
const anilistMeta = readJson('animes_anilist_meta.json', {});
const registry = readJson('animes_registry.json', {});

let maxCounter = 0;
for (const id of Object.keys(registry)) {
  const m = /^a_(\d+)$/.exec(id);
  if (m) maxCounter = Math.max(maxCounter, parseInt(m[1], 10));
}

const malIndex = new Map();
for (const [canonicalId, ids] of Object.entries(registry)) {
  const mal = typeof ids.mal === 'string' ? parseInt(ids.mal, 10) : ids.mal;
  if (typeof mal === 'number' && !Number.isNaN(mal) && !malIndex.has(mal)) {
    malIndex.set(mal, canonicalId);
  }
}

let minted = 0;
let updated = 0;

for (const anime of Object.values(malAnime)) {
  const malId = anime.id;
  const simkl = simklEntries[malId.toString()];
  const meta = anilistMeta[malId.toString()];
  const crosswalk = assembleCrosswalk(malId, simkl, meta);

  let canonicalId = malIndex.get(malId);
  if (!canonicalId) {
    maxCounter += 1;
    canonicalId = `a_${maxCounter}`;
    registry[canonicalId] = {};
    malIndex.set(malId, canonicalId);
    minted += 1;
  }

  const entry = registry[canonicalId];
  let changedThisEntry = false;
  for (const [key, value] of Object.entries(crosswalk)) {
    if (value === undefined || entry[key] === value) continue;
    entry[key] = value;
    changedThisEntry = true;
  }
  if (changedThisEntry) updated += 1;
}

// Collision report: any non-mal provider id claimed by 2+ canonical ids.
const claims = new Map();
for (const [canonicalId, ids] of Object.entries(registry)) {
  for (const [key, value] of Object.entries(ids)) {
    if (key === 'mal' || value === undefined) continue;
    const claimKey = `${key}:${value}`;
    if (!claims.has(claimKey)) claims.set(claimKey, []);
    claims.get(claimKey).push(canonicalId);
  }
}
const collisions = [...claims.entries()].filter(([, ids]) => ids.length > 1);

fs.writeFileSync(file('animes_registry.json'), JSON.stringify(registry, null, 2), 'utf-8');

console.log(
  `Registry: ${Object.keys(registry).length} canonical ids (${minted} newly minted, ${updated} crosswalks created/updated).`
);
if (collisions.length > 0) {
  console.warn(`\n${collisions.length} provider-id collision(s) — same provider id claimed by multiple canonical ids:`);
  for (const [claimKey, ids] of collisions) {
    console.warn(`  ${claimKey}  ->  ${ids.join(', ')}`);
  }
  console.warn('\nNo automatic resolution — collision policy is an open question (see docs/PROVIDER-FREE.md).');
} else {
  console.log('No provider-id collisions detected.');
}
