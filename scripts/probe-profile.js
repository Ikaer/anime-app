/**
 * Probe the reco-profile staff families against the real store, without a UI
 * (docs/recoProfiles/DESIGN.md §3, §4, §8, §11).
 *
 *   set DATA_PATH=E:\Workspace\local\AnimeTracker\data
 *   node scripts/probe-profile.js --stats            # the §3 / §4 tables, re-measured
 *   node scripts/probe-profile.js --box all          # the §8 diagnostic, per box
 *   node scripts/probe-profile.js --box absolute-cinema
 *   node scripts/probe-profile.js --rank --box bancal-et-je-l-assume --weights staffDirector=1
 *   node scripts/probe-profile.js --rank --box laugh --weights staffMusic=1 --pool anchored
 *
 * It MEASURES rather than asserts, like `probe-box.js` and `backtest-reco.js` —
 * do not convert it into pass/fail. There is no right answer for a family's
 * coverage; there is only whether the design's numbers still describe the store
 * the scale corrections were derived from.
 *
 * Two things it is for:
 *
 *  - **`--stats` re-derives the scale table.** `PROFILE_DENOM` is a set of
 *    divisors chosen so that 1.0 on the director slider and 1.0 on the tags
 *    slider contribute comparably. Those divisors are claims about today's role
 *    strings and today's boxes; the "corrected" column is the check — every
 *    family should land within reach of the tags reference, and `staffAnimation`
 *    / `staffArt` should be the two still sitting low (DESIGN §4's inversion).
 *  - **`--box` is the §8 diagnostic, read through DECLARED units.** The design's
 *    §2 table was built on `getFranchiseIndex(all, 'direct')` as a proxy, because
 *    no group had been declared when it was written. The owner's groups now exist,
 *    so this reads `resolveBoxUnits(box, getGroups())` — the collapse the ranker
 *    actually weights by — and prints the proxy beside it so the difference is
 *    visible. A family whose people recur across no two UNITS is a retrieval
 *    knob on that box, not a learned axis; that is the sentence the profile page
 *    must be able to print.
 *
 *  - **`--rank` is what a profile does to a box's ranking**, through the REAL
 *    rankers — never a JS copy of them. `--weights` builds a synthetic
 *    `ProfileWeights` and hands it in AS THE PROFILE, so the real resolver runs
 *    (including the `anilistStaff` zeroing) exactly as it would for an attached
 *    one; nothing is attached. Printed beside the same box under `Défaut`.
 *      `--pool statused` (default) — `rankBoxCandidates`, the MCP's fill loop:
 *        the owner's own statused list, grouped by direct franchise.
 *      `--pool anchored` — the box's recos tab: `boxAnchorIds` + `loadMixEdges`
 *        + `computeAnchored`, i.e. `/api/anime/recommendations/mix?box=`, with
 *        seen titles IN (the tab's default; `--unseen` drops them). ⚠️ This one
 *        REACHES THE NETWORK — one MAL request per anchor (skipped without a
 *        valid token) and one AniList request for all of them.
 *    The catalog-wide preview pool is phase 5's (DESIGN §7), not this.
 *
 * Read-only: nothing is written.
 */

const fs = require('fs');

require('./lib/ts-loader.js');

function parseArgs(argv) {
  const out = { stats: false, box: null, rank: false, weights: {}, pool: 'statused', limit: 15, unseen: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--stats') out.stats = true;
    else if (argv[i] === '--box') out.box = argv[++i];
    else if (argv[i] === '--rank') out.rank = true;
    else if (argv[i] === '--pool') out.pool = argv[++i];
    else if (argv[i] === '--limit') out.limit = Number(argv[++i]);
    else if (argv[i] === '--unseen') out.unseen = true;
    else if (argv[i] === '--weights') {
      // `staffDirector=1,anilistTags=0.5` — any ProfileField, family or source.
      for (const pair of argv[++i].split(',')) {
        const [k, v] = pair.split('=');
        out.weights[k.trim()] = Number(v);
      }
    }
  }
  if (!['statused', 'anchored'].includes(out.pool)) {
    console.error(`--pool must be statused or anchored, not ${out.pool}`);
    process.exit(1);
  }
  if (out.rank && !out.box) {
    console.error('--rank needs --box <id>');
    process.exit(1);
  }
  if (!out.stats && !out.box) out.stats = true;
  return out;
}

/** Two rankings side by side, with the top-N churn — `probe-box.js --diff`'s layout. */
function printSideBySide(beforeIds, afterIds, name, limit, labels) {
  const shown = Math.min(limit, Math.max(beforeIds.length, afterIds.length));
  const topBefore = beforeIds.slice(0, shown);
  const churn = afterIds.slice(0, shown).filter(id => !topBefore.includes(id)).length;
  console.log(`   top ${shown}: ${churn}/${shown} changed\n`);
  const width = 46;
  const trunc = t => (t.length > width ? t.slice(0, width - 1) + '~' : t).padEnd(width);
  console.log(`   ${labels[0].padEnd(width)}     ${labels[1]}`);
  for (let i = 0; i < shown; i++) {
    const b = beforeIds[i], a = afterIds[i];
    const mark = a && !topBefore.includes(a) ? ' NEW ' : '     ';
    console.log(`   ${trunc(b ? name(b) : '')}${mark}${a ? name(a) : ''}`);
  }
  console.log();
}

/**
 * `--rank`: the box under `Défaut`, then under the synthetic profile, through
 * the real ranker of the chosen pool.
 */
async function rankMode(args, ctx) {
  const { all, byId, box, groups } = ctx;
  const { getPrimaryTitle } = require('@/lib/domain/animeUtils');
  const { resolveProfile, resolveProfileOver, sanitizeProfileWeights } = require('@/lib/reco/profileWeights');
  const { BOX_WEIGHTS, ANCHORED_WEIGHTS } = require('@/lib/reco/weights');
  const { isStaffFamily } = require('@/lib/reco/staffFields');

  // Through the store's own sanitizer, so the probe cannot rank with a value an
  // attached profile could never hold (unknown keys dropped, bounds clamped).
  const profile = sanitizeProfileWeights(args.weights);
  const name = id => { const a = byId.get(id); return a ? getPrimaryTitle(a, 'romaji') : id; };
  const base = args.pool === 'statused' ? BOX_WEIGHTS : ANCHORED_WEIGHTS;
  const resolved = resolveProfile(base, profile);
  const fam = Object.entries(resolved.families).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v}`);

  console.log('='.repeat(78));
  console.log(`${box.name}  — pool ${args.pool} | profile ${JSON.stringify(profile)}`);
  console.log(`   families: ${fam.join(', ') || 'none'}${resolved.staffZeroed ? '   (anilistStaff zeroed)' : ''}`);

  if (args.pool === 'statused') {
    const { rankBoxCandidates } = require('@/lib/reco/boxes');
    const opts = { limit: args.limit, groups };
    const t0 = Date.now();
    const before = rankBoxCandidates(box, all, opts);
    const t1 = Date.now();
    const after = rankBoxCandidates(box, all, { ...opts, profile });
    const t2 = Date.now();
    console.log(`   Défaut ${t1 - t0}ms | profile ${t2 - t1}ms`);
    printSideBySide(before.map(g => g.id), after.map(g => g.id), name, args.limit, ['DÉFAUT', 'PROFILE']);
    console.log('   PROFILE, with what earned each row:');
    for (const [i, g] of after.entries()) {
      const extra = g.members.length > 1 ? `  (+${g.members.length - 1} in franchise)` : '';
      console.log(`   ${String(i + 1).padStart(2)}. ${g.score.toFixed(3)}  ${name(g.id)}${extra}`);
      for (const m of g.matched) {
        console.log(`         ${(isStaffFamily(m.field) ? `*${m.field}` : m.field).padEnd(17)} ${m.values.join(' · ')}`);
      }
    }
    console.log();
    return;
  }

  const { computeAnchored } = require('@/lib/reco/anchored');
  const { boxAnchorIds, loadMixEdges } = require('@/lib/reco/mixFetch');
  const present = box.members.filter(id => byId.has(id));
  const anchorIds = boxAnchorIds(box, present, byId, groups);
  console.log(`   ${anchorIds.length} anchors (one per unit): ${anchorIds.map(name).join(' | ')}`);
  const { sources, malEdges, anilistEdges } = await loadMixEdges(anchorIds);
  console.log(`   edges: MAL ${sources.mal.ok ? malEdges.length : `FAILED (${sources.mal.error})`}` +
    ` | AniList ${sources.anilist.ok ? anilistEdges.length : `FAILED (${sources.anilist.error})`}`);

  const rank = p => {
    const r = resolveProfileOver(ANCHORED_WEIGHTS, p, {});
    return computeAnchored(anchorIds, malEdges, anilistEdges, {
      weights: r.weights,
      families: r.families,
      excludeSeen: args.unseen,
      excludeIds: new Set([...box.members, ...(box.excluded ?? [])]),
      lang: 'fr',
      titleLang: 'romaji',
    });
  };
  const before = rank(undefined);
  const after = rank(profile);
  console.log(`   pool: ${after.length} candidates`);
  printSideBySide(before.map(x => x.anime.id), after.map(x => x.anime.id), name, args.limit, ['DÉFAUT', 'PROFILE']);
  console.log('   PROFILE, top contributions (* = a staff family):');
  for (const [i, item] of after.slice(0, args.limit).entries()) {
    console.log(`   ${String(i + 1).padStart(2)}. ${item.score.toFixed(3)}  ${name(item.anime.id)}${item.seen ? '  (vu)' : ''}`);
    for (const row of item.breakdown.slice(0, 4)) {
      const label = isStaffFamily(row.source) ? `*${row.source}` : row.source;
      console.log(`         ${label.padEnd(17)} ${row.contribution >= 0 ? '+' : ''}${row.contribution.toFixed(3)}  ${row.detail ?? ''}`);
    }
  }
  console.log();
}

const quantile = (sorted, q) =>
  sorted.length === 0 ? NaN : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const median = values => quantile([...values].sort((a, b) => a - b), 0.5);
const pct = (n, d) => (d === 0 ? '  -  ' : `${((n / d) * 100).toFixed(1)}%`.padStart(6));
const num = v => (Number.isFinite(v) ? v.toFixed(3) : '  -  ');

async function main() {
  const args = parseArgs(process.argv);

  const dataPath = process.env.DATA_PATH;
  if (!dataPath || !fs.existsSync(dataPath)) {
    console.error(`DATA_PATH is not set or does not exist: ${dataPath}`);
    console.error('Run `npm run data:copy` (or data:copy-salon) first, then set DATA_PATH to it.');
    process.exit(1);
  }

  // Required after the DATA_PATH check: `store` reads it at module init.
  const { getAnimeForDisplay } = require('@/lib/store');
  const { getBoxes } = require('@/lib/reco/boxes');
  const { getGroups } = require('@/lib/reco/groups');
  const { getEffectiveStatus } = require('@/lib/domain/animeUtils');
  const { getFranchiseIndex } = require('@/lib/domain/franchise');
  const { resolveBoxUnits, unitWeightFn } = require('@/lib/domain/boxUnits');
  const {
    STAFF_FAMILIES, STAFF_FAMILY_EXTRACTORS, PROFILE_DENOM, denomFor, staffFamilyIdf,
  } = require('@/lib/reco/staffFields');
  const {
    FIELD_EXTRACTORS, computeIdf, buildFieldProfile, flooredFieldMatch, MATCH_DENOM_FLOOR,
  } = require('@/lib/reco/scoring');

  const all = getAnimeForDisplay();
  const byId = new Map(all.map(a => [a.id, a]));
  const statused = all.filter(a => getEffectiveStatus(a));
  const withStaff = statused.filter(a => (a.sources.anilist?.staff || []).length > 0);
  console.log(`store: ${all.length} records | statused ${statused.length} | with AniList staff ${withStaff.length}\n`);

  const t0 = Date.now();
  const familyIdf = staffFamilyIdf(all);
  const idfMs = Date.now() - t0;

  // The two reference rows. Tags at the box ranker's rank floor, since that is
  // the extractor a profile's tags slider will actually drive.
  const tagsExtract = a => (a.sources.anilist?.tags || []).filter(t => (t.rank ?? 0) >= 60).map(t => t.name);
  const fields = [
    ...STAFF_FAMILIES.map(f => ({ key: f, extract: STAFF_FAMILY_EXTRACTORS[f], idf: familyIdf[f] })),
    { key: 'anilistTags', ref: true, extract: tagsExtract, idf: computeIdf(all, tagsExtract) },
    { key: 'anilistStaff', ref: true, extract: FIELD_EXTRACTORS.anilistStaff, idf: computeIdf(all, FIELD_EXTRACTORS.anilistStaff) },
  ];

  const boxes = getBoxes();
  const groups = getGroups();

  if (args.rank) {
    const box = boxes.find(b => b.id === args.box);
    if (!box) {
      console.error(`no such box: ${args.box}. Known: ${boxes.map(b => b.id).join(', ')}`);
      process.exit(1);
    }
    await rankMode(args, { all, byId, box, groups });
    return;
  }

  if (args.stats) {
    // The pooled match median, DESIGN §3's column: the boxes with >=5 members,
    // each profiling its OWN members (unit-weighted, as the ranker does) against
    // every statused non-member. Raw = floor 1, the field's natural scale;
    // corrected = through `denomFor`, the scale a slider will actually see.
    const measured = boxes.filter(b => b.members.filter(id => byId.has(id)).length >= 5);
    const pooled = new Map(fields.map(f => [f.key, { raw: [], corrected: [], hits: 0 }]));
    for (const box of measured) {
      const members = box.members.map(id => byId.get(id)).filter(Boolean);
      const weightOf = unitWeightFn(resolveBoxUnits(box, groups));
      const memberSet = new Set(box.members);
      for (const f of fields) {
        const profile = buildFieldProfile(members, weightOf, f.extract, f.idf);
        const bucket = pooled.get(f.key);
        const corrected = f.key === 'anilistTags' ? MATCH_DENOM_FLOOR.anilistTags : f.key === 'anilistStaff' ? MATCH_DENOM_FLOOR.anilistStaff : denomFor(f.key);
        for (const cand of statused) {
          if (memberSet.has(cand.id)) continue;
          const raw = flooredFieldMatch(cand, profile, 1).score;
          if (raw <= 0) continue;
          bucket.raw.push(raw);
          bucket.corrected.push(flooredFieldMatch(cand, profile, corrected).score);
          bucket.hits++;
        }
      }
    }

    console.log(`§3 — measured over the statused list; match medians pooled over ${measured.length} boxes with >=5 members`);
    console.log(`     family IDF, all eight families: ${idfMs}ms over ${all.length} records\n`);
    console.log(
      `   ${'field'.padEnd(17)}${'cov'.padStart(7)}  ${'med/p75/p90'.padEnd(12)}${'people'.padStart(7)}` +
      `${'hits'.padStart(7)}${'raw'.padStart(8)}${'denom'.padStart(7)}${'corrected'.padStart(11)}${'binds'.padStart(8)}`
    );
    for (const f of fields) {
      const counts = withStaff.map(a => f.extract(a).length).filter(n => n > 0).sort((a, b) => a - b);
      const covered = withStaff.filter(a => f.extract(a).length > 0).length;
      const denom = f.key === 'anilistTags' ? MATCH_DENOM_FLOOR.anilistTags
        : f.key === 'anilistStaff' ? MATCH_DENOM_FLOOR.anilistStaff : PROFILE_DENOM[f.key];
      // DESIGN §4: the share of field-carrying titles whose count is at or below
      // the divisor — ~100% means the "floor" is a uniform rescale, not a floor.
      const binds = counts.filter(n => n <= denom).length;
      const p = pooled.get(f.key);
      console.log(
        `   ${(f.ref ? `ref ${f.key}` : f.key).padEnd(17)}${pct(covered, withStaff.length)}  ` +
        `${`${quantile(counts, 0.5)}/${quantile(counts, 0.75)}/${quantile(counts, 0.9)}`.padEnd(12)}` +
        `${String(f.idf.size).padStart(7)}${String(p.hits).padStart(7)}` +
        `${num(median(p.raw)).padStart(8)}${String(denom).padStart(7)}${num(median(p.corrected)).padStart(11)}` +
        `${pct(binds, counts.length).padStart(8)}`
      );
    }
    console.log('\n   people = distinct values catalog-wide (the IDF map\'s size); binds = counts <= denom');
    console.log();
  }

  if (args.box) {
    const selected = args.box === 'all'
      ? boxes.filter(b => b.members.length > 0)
      : boxes.filter(b => b.id === args.box);
    if (selected.length === 0) {
      console.error(`no such box: ${args.box}. Known: ${boxes.map(b => b.id).join(', ')}`);
      process.exit(1);
    }
    const direct = getFranchiseIndex(all, 'direct');

    for (const box of selected) {
      const present = box.members.filter(id => byId.has(id));
      const declared = resolveBoxUnits(box, groups);
      const unitOf = new Map();
      declared.units.forEach((u, i) => u.members.forEach(id => unitOf.set(id, i)));
      // The §2 proxy, printed beside the real collapse so the gap is visible.
      const proxyOf = id => (direct.get(id) || [{ id }])[0].id;
      const proxyUnits = new Set(present.map(proxyOf)).size;

      console.log('='.repeat(78));
      console.log(
        `${box.name}  — ${present.length} entries | ${declared.units.length} declared units` +
        ` | ${proxyUnits} direct-franchise components (the design's proxy)`
      );

      for (const family of STAFF_FAMILIES) {
        /** person -> the set of units (and of entries) crediting them */
        const byPerson = new Map();
        for (const id of present) {
          for (const person of STAFF_FAMILY_EXTRACTORS[family](byId.get(id))) {
            let e = byPerson.get(person);
            if (!e) { e = { entries: new Set(), units: new Set(), proxy: new Set() }; byPerson.set(person, e); }
            e.entries.add(id);
            e.units.add(unitOf.get(id));
            e.proxy.add(proxyOf(id));
          }
        }
        const people = byPerson.size;
        const acrossEntries = [...byPerson.values()].filter(e => e.entries.size >= 2).length;
        const acrossUnits = [...byPerson.values()].filter(e => e.units.size >= 2).length;
        const acrossProxy = [...byPerson.values()].filter(e => e.proxy.size >= 2).length;
        // The sentence the profile page must be able to print (DESIGN §8).
        const verdict = people === 0 ? 'no credits'
          : acrossUnits === 0 ? `retrieval knob — ${people} people, none shared by two units`
            : `axis — ${acrossUnits} of ${people} people shared across units`;
        console.log(
          `   ${family.padEnd(17)} people ${String(people).padStart(3)}  recur: entries ${String(acrossEntries).padStart(2)}` +
          ` → units ${String(acrossUnits).padStart(2)} (proxy ${String(acrossProxy).padStart(2)})   ${verdict}`
        );
      }
      console.log();
    }
  }
}

main().catch(error => { console.error(error); process.exit(1); });
