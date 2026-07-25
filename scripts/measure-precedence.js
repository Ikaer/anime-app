#!/usr/bin/env node
/**
 * Measure catalog-precedence coverage: which provider actually holds a value for
 * each overlapping field, over the population precedence order decides.
 *
 * Written for docs/FULL Precedence/ — the folder's numbers were computed ad-hoc
 * in earlier sessions, which makes a before/after delta unreadable. Gate 2
 * (studio-id-namespace.md: "full coverage ⇒ the flip is safe, materially partial
 * ⇒ option E stops being deferrable") turns on exactly such a delta, so the
 * measurement has to be reproducible rather than re-derived.
 *
 *   node scripts/measure-precedence.js [dataPath]
 *
 * Defaults to DATA_PATH, then the office local store. Prints markdown tables
 * ready to paste into docs/FULL Precedence/README.md.
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = process.argv[2] || process.env.DATA_PATH || 'E:\\Workspace\\local\\AnimeTracker\\data';

function readJson(rel) {
  const file = path.join(DATA_PATH, rel);
  if (!fs.existsSync(file)) {
    console.error(`missing: ${file}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Present = defined, non-null, and (for arrays) non-empty. An empty array is
 *  "no value" for coverage purposes — which is also exactly the distinction the
 *  precedence merge gets wrong today if `[]` is stored instead of `undefined`. */
function present(v) {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

const registry = readJson('registry.json');
const mal = readJson('catalog/mal.json');
const anilist = readJson('catalog/anilist.json');

const registryIds = Object.keys(registry);
const metaIds = Object.keys(anilist);
const withCatalog = metaIds.filter(id => anilist[id] && anilist[id].catalog !== undefined);

// Field pairs: [label, malGetter, anilistCatalogGetter]
const FIELDS = [
  ['mean', m => m.mean, c => c.mean],
  ['genres', m => m.genres, c => c.genres],
  ['studios', m => m.studios, c => c.studios],
  ['synopsis', m => m.synopsis, c => c.synopsis],
  ['numEpisodes', m => m.num_episodes, c => c.numEpisodes],
];

console.log(`\nStore: ${DATA_PATH}\n`);
console.log('| Fact | Value |');
console.log('|---|---|');
console.log(`| MAL catalog records | ${Object.keys(mal).length.toLocaleString()} |`);
console.log(`| Registry entries | ${registryIds.length.toLocaleString()} |`);
console.log(`| …with an AniList id in the crosswalk | ${registryIds.filter(id => registry[id] && registry[id].anilist !== undefined).length.toLocaleString()} |`);
console.log(`| AniList meta entries | ${metaIds.length.toLocaleString()} |`);
console.log(`| AniList entries carrying a **\`catalog\`** block | **${withCatalog.length.toLocaleString()}** |`);

// ── Per-field both-present coverage, over the titles that HAVE an AniList
// catalog block (the population precedence actually decides between). ──
console.log('\n| Field | Both present | MAL only | AniList only | Neither |');
console.log('|---|---|---|---|---|');
for (const [label, fromMal, fromAni] of FIELDS) {
  let both = 0, malOnly = 0, aniOnly = 0, neither = 0;
  for (const id of withCatalog) {
    const m = mal[id];
    const c = anilist[id].catalog;
    const hasMal = m ? present(fromMal(m)) : false;
    const hasAni = present(fromAni(c));
    if (hasMal && hasAni) both++;
    else if (hasMal) malOnly++;
    else if (hasAni) aniOnly++;
    else neither++;
  }
  console.log(`| \`${label}\` | ${both.toLocaleString()} | ${malOnly.toLocaleString()} | ${aniOnly.toLocaleString()} | ${neither.toLocaleString()} |`);
}

// ── Gate 2: the studio id-namespace question. ──
//
// Under a hypothetical `studios: ['anilist','mal']` precedence, a title whose
// AniList catalog block has no studios falls through to MAL — and carries
// MAL-namespace studio ids while its neighbours carry AniList's. That mixing
// rate, NOT the flip itself, is what fragments the reco studio IDF profile
// (studio-id-namespace.md hazard 1).
let anilistWins = 0, malFallthrough = 0, noStudiosAnywhere = 0;
for (const id of registryIds) {
  const c = anilist[id] && anilist[id].catalog;
  const m = mal[id];
  const hasAni = c ? present(c.studios) : false;
  const hasMal = m ? present(m.studios) : false;
  if (hasAni) anilistWins++;
  else if (hasMal) malFallthrough++;
  else noStudiosAnywhere++;
}
const withStudios = anilistWins + malFallthrough;
const mixRate = withStudios > 0 ? (malFallthrough / withStudios) * 100 : 0;
console.log('\n**Gate 2 — studio id-namespace mixing under a hypothetical `studios: [anilist, mal]` flip**\n');
console.log('| Outcome | Titles |');
console.log('|---|---|');
console.log(`| AniList studios win (AniList-namespace ids) | ${anilistWins.toLocaleString()} |`);
console.log(`| **Fall through to MAL (MAL-namespace ids)** | **${malFallthrough.toLocaleString()}** |`);
console.log(`| No studios from either provider | ${noStudiosAnywhere.toLocaleString()} |`);
console.log(`\nPermanent id-namespace mixing rate: **${mixRate.toFixed(1)}%** of titles that have studios at all.`);

// ── Hazard 2: producer contamination, measured as list bloat. ──
//
// AniList's `studios` connection holds animation studios AND producers; the
// pre-fix sweep used `nodes` (no `isMain` filter) and imported both. MAL's
// `studios` is animation studios only, so the mean list length on both-present
// titles is a direct read on how contaminated the AniList lists are. After the
// `edges { isMain node }` fix this should land near MAL's figure.
let malStudioTotal = 0, aniStudioTotal = 0, bothStudioTitles = 0;
let aniBiggerThanMal = 0;
for (const id of withCatalog) {
  const c = anilist[id].catalog;
  const m = mal[id];
  if (!m || !present(m.studios) || !present(c.studios)) continue;
  bothStudioTitles++;
  malStudioTotal += m.studios.length;
  aniStudioTotal += c.studios.length;
  if (c.studios.length > m.studios.length) aniBiggerThanMal++;
}
console.log('\n**Hazard 2 — producer contamination in AniList `studios`**\n');
console.log('| Metric | Value |');
console.log('|---|---|');
console.log(`| Titles with studios from both | ${bothStudioTitles.toLocaleString()} |`);
console.log(`| Mean studios/title — MAL | ${(malStudioTotal / bothStudioTitles).toFixed(2)} |`);
console.log(`| Mean studios/title — AniList | ${(aniStudioTotal / bothStudioTitles).toFixed(2)} |`);
console.log(`| AniList list longer than MAL's | ${aniBiggerThanMal.toLocaleString()} (${((aniBiggerThanMal / bothStudioTitles) * 100).toFixed(1)}%) |`);

// ── Catalog-block schema versions (the re-sweep's progress read). ──
const versions = {};
for (const id of withCatalog) {
  const v = anilist[id].catalog.v === undefined ? 'unversioned (pre-isMain)' : `v${anilist[id].catalog.v}`;
  versions[v] = (versions[v] || 0) + 1;
}
console.log('\n**Catalog-block schema versions**\n');
console.log('| Version | Entries |');
console.log('|---|---|');
for (const [v, n] of Object.entries(versions).sort((a, b) => b[1] - a[1])) {
  console.log(`| ${v} | ${n.toLocaleString()} |`);
}
console.log('');
