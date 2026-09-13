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
 *  - **`--rank` is what a profile does to a box's ranking** — through
 *    `previewProfile` (`reco/profilePreview.ts`), the engine behind
 *    `POST /api/anime/profiles/preview`, so it cannot rank differently from the
 *    route. `--weights` is the slider state, sanitized as the store would
 *    sanitize it; nothing is attached. Printed beside the same box under
 *    `Défaut` (no weights).
 *      `--pool catalog` (default) — the unseen catalog, the mark's own
 *        eligibility (DESIGN §7): where a craft slider actually reaches.
 *      `--pool statused` — `rankBoxCandidates` as is: the MCP's fill loop.
 *      `--pool anchored` — the box's recos tab (`computeAnchored` over its crowd
 *        edges), seen titles IN like the tab (`--unseen` drops them). ⚠️ The one
 *        that REACHES THE NETWORK — one MAL request per anchor (skipped without a
 *        valid token) and one AniList request for all of them.
 *
 * Read-only: nothing is written.
 */

const fs = require('fs');

require('./lib/ts-loader.js');

function parseArgs(argv) {
  const out = { stats: false, box: null, rank: false, weights: {}, pool: 'catalog', limit: 15, unseen: false };
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
  if (!['catalog', 'statused', 'anchored'].includes(out.pool)) {
    console.error(`--pool must be catalog, statused or anchored, not ${out.pool}`);
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
 * `--rank`: the box under `Défaut` (no weights), then under the synthetic
 * profile, through `previewProfile` — the preview route's engine — on the
 * chosen pool.
 */
async function rankMode(args, ctx) {
  const { box } = ctx;
  const { previewProfile } = require('@/lib/reco/profilePreview');
  const { sanitizeProfileWeights } = require('@/lib/reco/profileWeights');
  const { isStaffFamily } = require('@/lib/reco/staffFields');

  // Through the store's own sanitizer, so the probe cannot rank with a value an
  // attached profile could never hold (unknown keys dropped, bounds clamped).
  const profile = sanitizeProfileWeights(args.weights);
  const input = {
    box, pool: args.pool, limit: args.limit, lang: 'fr', titleLang: 'romaji',
    ...(args.pool === 'anchored' ? { includeSeen: !args.unseen } : {}),
  };
  const t0 = Date.now();
  const before = await previewProfile({ ...input, weights: {} });
  const t1 = Date.now();
  const after = await previewProfile({ ...input, weights: profile });
  const t2 = Date.now();

  const fam = Object.entries(after.families).filter(([, v]) => v !== 0).map(([k, v]) => `${k} ${v}`);
  console.log('='.repeat(78));
  console.log(`${box.name}  — pool ${args.pool} | profile ${JSON.stringify(profile)}`);
  console.log(`   families: ${fam.join(', ') || 'none'}${after.staffZeroed ? '   (anilistStaff zeroed)' : ''}`);
  console.log(`   Défaut ${t1 - t0}ms | profile ${t2 - t1}ms`);
  if (after.coverage) {
    console.log(`   pool: ${after.coverage.eligible} eligible of ${after.coverage.unseen} unseen (the rest carry no AniList metadata, or are premature sequels)`);
  }
  if (after.anchors.asked) console.log(`   ${after.anchors.asked.length} anchors asked (one per unit)`);
  if (after.sources) {
    console.log(`   sources: MAL ${after.sources.mal.ok ? 'ok' : `FAILED (${after.sources.mal.error})`}` +
      ` | AniList ${after.sources.anilist.ok ? 'ok' : `FAILED (${after.sources.anilist.error})`}`);
  }

  const titles = new Map([...before.items, ...after.items].map(i => [i.row.id, i.row.title]));
  const name = id => titles.get(id) ?? id;
  printSideBySide(before.items.map(i => i.row.id), after.items.map(i => i.row.id), name, args.limit, ['DÉFAUT', 'PROFILE']);
  console.log('   PROFILE, with what earned each row (* = a staff family):');
  for (const [i, item] of after.items.entries()) {
    const extra = item.franchise ? `  (+${item.franchise} in franchise)` : '';
    const seen = item.row.status ? `  (${item.row.status}${item.row.score ? ` ${item.row.score}` : ''})` : '';
    console.log(`   ${String(i + 1).padStart(2)}. ${item.score.toFixed(3)}  ${item.row.title}${extra}${seen}`);
    for (const m of item.matched ?? []) {
      console.log(`         ${(isStaffFamily(m.field) ? `*${m.field}` : m.field).padEnd(17)} ${m.values.join(' · ')}`);
    }
    for (const row of (item.breakdown ?? []).slice(0, 4)) {
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
    // The diagnostic is the engine's — `reco/profileDiagnostic.ts`, what the
    // preview route ships — so this script reads it rather than re-deriving it.
    // Three unit readings of the same titles: every entry alone (the inflation),
    // the DECLARED units (what the ranker weights by), and the §2 proxy.
    const { diagnoseFamilies } = require('@/lib/reco/profileDiagnostic');

    for (const box of selected) {
      const present = box.members.filter(id => byId.has(id));
      const declared = resolveBoxUnits(box, groups);
      const toRecords = ids => ids.map(id => byId.get(id)).filter(Boolean);
      // The §2 proxy, printed beside the real collapse so the gap is visible.
      const proxyOf = id => (direct.get(id) || [{ id }])[0].id;
      const proxyUnits = new Map();
      for (const id of present) {
        const key = proxyOf(id);
        if (!proxyUnits.has(key)) proxyUnits.set(key, []);
        proxyUnits.get(key).push(id);
      }

      const byUnit = diagnoseFamilies(declared.units.map(u => toRecords(u.members)));
      const byEntry = diagnoseFamilies(present.map(id => [byId.get(id)]));
      const byProxy = diagnoseFamilies([...proxyUnits.values()].map(toRecords));

      console.log('='.repeat(78));
      console.log(
        `${box.name}  — ${present.length} entries | ${declared.units.length} declared units` +
        ` | ${proxyUnits.size} direct-franchise components (the design's proxy)`
      );

      byUnit.families.forEach((f, i) => {
        // The sentence the profile page must be able to print (DESIGN §8).
        const verdict = f.verdict === 'empty' ? 'no credits'
          : f.verdict === 'retrieval' ? `retrieval knob — ${f.people} people, none shared by two units`
            : `axis — ${f.recurring} of ${f.people} people shared across units`;
        console.log(
          `   ${f.family.padEnd(17)} people ${String(f.people).padStart(3)}  recur: entries ${String(byEntry.families[i].recurring).padStart(2)}` +
          ` → units ${String(f.recurring).padStart(2)} (proxy ${String(byProxy.families[i].recurring).padStart(2)})   ${verdict}`
        );
        if (f.shared.length) console.log(`   ${''.padEnd(17)} shared: ${f.shared.map(p => `${p.name} ×${p.units}`).join(' · ')}`);
      });
      console.log();
    }
  }
}

main().catch(error => { console.error(error); process.exit(1); });
