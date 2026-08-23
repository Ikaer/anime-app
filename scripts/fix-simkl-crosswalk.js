/**
 * One-shot repair for SIMKL crosswalk contamination.
 *
 * ## What went wrong
 *
 * SIMKL routinely files a chibi/short companion series' MAL id on the MAIN
 * show's record. Live-measured on this store, three cases, all the same shape:
 *
 *   simkl 1670325 "Youjo Senki II"   → ids.mal 64577 (*Youjo Shenki 2*, chibi)
 *                                      ids.anilist 135865 (the main show)
 *   simkl 2743422 "Re:Zero … S4"     → ids.mal 63830 (*Break Time 4th*, chibi)
 *   simkl 2334518 "Akuyaku Reijou …" → ids.mal 61049 (*… Mini*, the short)
 *
 * The payload contradicts ITSELF — `ids.mal` names one title and `ids.anilist`
 * another — so one of the two is provably wrong and SIMKL will not say which.
 * `resolveCanonicalIds` looks up mal → anilist → simkl, first hit wins, so the
 * main show's watch state landed on the chibi's canonical record, and the merge
 * loop then copied SIMKL's whole `ids` block onto it (simkl, slug, imdb, kitsu,
 * anidb, tvdb, tmdb, trakt* — and on one record `anilist` too).
 *
 * Two lasting effects, both user-visible:
 *   - the chibi shows as watched with the main show's score, and the AniList
 *     push sweep recreates it on AniList every cron tick;
 *   - the chibi's SIMKL / AniDB / Kitsu links point at the main show.
 *
 * ## What this script does
 *
 * Finds every provider id (`simkl`, `anilist`, `mal`) bound to MORE THAN ONE
 * canonical record — the unambiguous corruption signal, since a provider id
 * names exactly one title by definition. For each, it keeps the binding on the
 * **native** record and strips the contaminated block from the other:
 *
 *   - `mal` is settled by `catalog/mal.json`, which stores each title's own
 *     MAL id — authoritative and local.
 *   - `anilist` is settled the same way against `catalog/anilist.json`'s
 *     `idMal` (AniList declaring its own crosswalk), falling back to the record
 *     that holds it as a NUMBER: the sweeps write numbers, SIMKL mirrors
 *     strings, so a string copy is the imported one.
 *   - `simkl` has no local authority, so it is settled by SIMKL's own
 *     `ids.anilist` in `personal/simkl.json` — the second axis of the same
 *     payload, which in all three measured cases names the main show.
 *
 * The loser loses the contested id AND every foreign id that arrived with it in
 * the same SIMKL block (they describe the winner, not the loser), plus its
 * `personal/simkl.json` entry, which is the duplicate watch state.
 *
 * A record's OWN native ids are never touched: the chibi keeps its own `mal`
 * and its own `anilist`.
 *
 * Idempotent — a second run finds no duplicates and reports nothing.
 *
 * Pair with the code fix in `store/slices.ts` (`simklCrosswalkFor`: SIMKL's own
 * id anchors the item, contested foreign ids are discarded) and
 * `providers/simkl/sync.ts` (`dropOrphanedEntries`). Without those, the next
 * sync re-creates exactly what this removes.
 *
 * Usage:
 *   node scripts/fix-simkl-crosswalk.js <dataPath> [--dry-run]
 *   DATA_PATH=/path node scripts/fix-simkl-crosswalk.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const DRY_RUN = flags.has('--dry-run');

const KNOWN_FLAGS = new Set(['--dry-run']);
for (const flag of flags) {
  if (!KNOWN_FLAGS.has(flag)) {
    console.error(`Unknown flag: ${flag}`);
    console.error('Usage: node scripts/fix-simkl-crosswalk.js <dataPath> [--dry-run]');
    process.exit(1);
  }
}

const DATA_PATH = positional[0] || process.env.DATA_PATH;
if (!DATA_PATH || !fs.existsSync(DATA_PATH)) {
  console.error(`Data path does not exist: ${DATA_PATH || '(unset)'}`);
  console.error('Usage: node scripts/fix-simkl-crosswalk.js <dataPath> [--dry-run]');
  process.exit(1);
}

const abs = name => path.join(DATA_PATH, name);
const readJson = (name, fallback) => {
  const file = abs(name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const writeJson = (name, value) => {
  if (DRY_RUN) return;
  fs.writeFileSync(abs(name), JSON.stringify(value, null, 2), 'utf8');
};

const toNum = v => {
  if (typeof v === 'number') return Number.isNaN(v) ? undefined : v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
};

const registry = readJson('registry.json', {});
const malCatalog = readJson('catalog/mal.json', {});
const anilistCatalog = readJson('catalog/anilist.json', {});
const simklPersonal = readJson('personal/simkl.json', {});

const titleOf = id => (malCatalog[id] && malCatalog[id].title) || '(no MAL catalog entry)';

// Every foreign id SIMKL ships in its `ids` block. When a record is the LOSER of
// a contested id, these arrived from the winner's payload and describe it, not
// the loser — so they go too. `mal` and `anilist` are handled separately: those
// two are settled per-field above, because a record legitimately owns its own.
const SIMKL_BLOCK_FIELDS = [
  'simkl', 'slug', 'imdb', 'kitsu', 'anidb', 'tmdb', 'tvdb', 'tvdbslug',
  'traktslug', 'trakttvslug', 'traktmslug', 'letterboxd', 'letterslug',
];

/** canonicalIds holding `field` = `value`, for every duplicated value. */
function duplicatesOf(field) {
  const byValue = new Map();
  for (const [canonicalId, ids] of Object.entries(registry)) {
    const n = toNum(ids[field]);
    if (n === undefined) continue;
    if (!byValue.has(n)) byValue.set(n, []);
    byValue.get(n).push(canonicalId);
  }
  return [...byValue.entries()].filter(([, holders]) => holders.length > 1);
}

/** The record a MAL id natively belongs to, per the MAL catalog slice. */
function nativeMalHolder(malId, holders) {
  return holders.find(id => malCatalog[id] && malCatalog[id].id === malId);
}

/**
 * The record an AniList id natively belongs to. AniList's own `idMal` is the
 * strongest signal; a numeric (vs SIMKL-mirrored string) value is the fallback.
 */
function nativeAnilistHolder(anilistId, holders) {
  for (const id of holders) {
    const meta = anilistCatalog[id];
    const idMal = meta && toNum(meta.idMal);
    if (idMal !== undefined && malCatalog[id] && malCatalog[id].id === idMal) return id;
  }
  return holders.find(id => typeof registry[id].anilist === 'number');
}

/**
 * The record a SIMKL id natively belongs to. No local authority exists, so use
 * the other axis of SIMKL's own payload: whichever holder its `ids.anilist`
 * names. Falls back to the earliest-minted holder (the one it was filed under
 * before the drift).
 */
function nativeSimklHolder(simklId, holders) {
  for (const key of Object.keys(simklPersonal)) {
    const entry = simklPersonal[key];
    if (!entry || entry.simkl_id !== simklId) continue;
    const anilistId = toNum(entry.ids && entry.ids.anilist);
    if (anilistId === undefined) continue;
    const named = holders.find(id => toNum(registry[id].anilist) === anilistId);
    if (named) return named;
  }
  const counter = id => parseInt(/^a_(\d+)$/.exec(id)[1], 10);
  return [...holders].sort((a, b) => counter(a) - counter(b))[0];
}

const SETTLERS = { mal: nativeMalHolder, anilist: nativeAnilistHolder, simkl: nativeSimklHolder };

console.log(`Repairing SIMKL crosswalk contamination in: ${DATA_PATH}${DRY_RUN ? '  (dry run)' : ''}`);
console.log(`  ${Object.keys(registry).length} registry entries, ${Object.keys(simklPersonal).length} SIMKL personal entries\n`);

let strippedFields = 0;
let strippedEntries = 0;
const losers = new Set();

for (const field of ['mal', 'anilist', 'simkl']) {
  for (const [value, holders] of duplicatesOf(field)) {
    const winner = SETTLERS[field](value, holders);
    if (!winner) {
      console.log(`! ${field} ${value} held by ${holders.join(', ')} — cannot settle, skipped`);
      continue;
    }
    console.log(`${field} ${value}`);
    console.log(`  keep  ${winner}  ${titleOf(winner)}`);
    for (const loser of holders.filter(id => id !== winner)) {
      losers.add(loser);
      const removed = [];
      // The contested id itself, plus the SIMKL block that rode in with it.
      for (const key of [field, ...SIMKL_BLOCK_FIELDS]) {
        if (key === 'mal' || key === 'anilist') continue; // settled per-field, never blanket-stripped
        if (registry[loser][key] === undefined) continue;
        // Only strip a block field that actually duplicates the winner's — a
        // value the loser holds alone is its own and stays.
        if (key !== field && registry[winner][key] !== registry[loser][key]) continue;
        removed.push(`${key}=${registry[loser][key]}`);
        delete registry[loser][key];
      }
      if (field !== 'simkl' && registry[loser][field] !== undefined) {
        removed.push(`${field}=${registry[loser][field]}`);
        delete registry[loser][field];
      }
      strippedFields += removed.length;
      console.log(`  strip ${loser}  ${titleOf(loser)}`);
      console.log(`        ${removed.length ? removed.join(', ') : '(nothing)'}`);
    }
    console.log('');
  }
}

// The duplicate watch state: a SIMKL personal entry on a record that just lost
// the SIMKL id it was filed under.
for (const loser of losers) {
  if (!simklPersonal[loser]) continue;
  const e = simklPersonal[loser];
  console.log(`drop personal/simkl.json[${loser}]  ${titleOf(loser)}  (simkl ${e.simkl_id}, ${e.status}, score ${e.score ?? '—'}, ${e.num_episodes_watched ?? '?'} ep)`);
  delete simklPersonal[loser];
  strippedEntries++;
}

if (strippedFields === 0 && strippedEntries === 0) {
  console.log('Nothing to repair — no provider id is bound to more than one canonical record.');
  process.exit(0);
}

writeJson('registry.json', registry);
writeJson('personal/simkl.json', simklPersonal);

console.log(`\n${DRY_RUN ? 'Would strip' : 'Stripped'} ${strippedFields} crosswalk field(s) and ${strippedEntries} SIMKL personal entr(y|ies).`);
if (DRY_RUN) console.log('Dry run — nothing written. Re-run without --dry-run to apply.');
