/**
 * Probe the « boîtes » grow ranker against the real store, without a UI.
 *
 *   set DATA_PATH=D:\Workspaces\local\AnimeTracker\data
 *   node scripts/probe-box.js
 *   node scripts/probe-box.js --members a_3213,a_791,a_801 --limit 20
 *   node scripts/probe-box.js --box all --diff        # measure the group collapse
 *
 * ⚠️ **`--diff` is the only way to measure the group collapse (§7.1 of
 * docs/boxesV2/DESIGN.md), because the collapse is INERT by default.**
 * `rankBoxCandidates` weights members `1 / componentSize` over the box's
 * DECLARED groups, and a live box declares none — so a plain run before and
 * after that change prints identical output, which reads as "the fix does
 * nothing" rather than "nothing has been declared yet". `--diff` synthesizes the
 * declaration the blade would produce (one group per direct-relation component
 * actually present in the box, the same seeding and the same `direct` scope the
 * rest of the feature uses) and ranks the box both ways.
 *
 * The whole feature rests on one claim: given a handful of titles the owner
 * hand-picked as "the same kind of thing", the metadata affinity in
 * `rankBoxCandidates` proposes more of them from the owner's OWN watched list,
 * well enough that filling a box is faster than scrolling 467 franchise groups.
 * That claim is cheap to falsify and expensive to discover late, so it gets
 * checked here before a single component is written.
 *
 * Two fixtures, chosen during design because they measured OPPOSITE:
 *
 *  - `exotic-adventure` (Nadia, Laputa, Last Exile, Made in Abyss, Nausicaä,
 *    Kino) sits in a well-populated corner of AniList's tag space — the raw tag
 *    probe shared `Steampunk` 5/6, `Lost Civilization` 5/6, `Aviation` 4/6 and
 *    its neighbours were Patema Inverted, Agito, Patapata Hikousen and Mirai
 *    Shounen Conan. This one SHOULD come out coherent.
 *  - `weird-concept` (Kaiba, Uchouten Kazoku, Mind Game, Tenshi no Tamago,
 *    Lain, Mononoke, Dennou Coil, Shinsekai yori) does not: only `Philosophy`
 *    held across all eight, exactly ONE T1 person recurred, and the raw probe
 *    drifted to Evangelion and Fire Force. Weirdness is a property of form, and
 *    no catalog field encodes form.
 *
 * So a thin, drifting `weird-concept` is the EXPECTED result, not a bug — it is
 * the measured reason the box's payoff is the crowd-anchored feed
 * (`computeAnchored`) rather than this ranker. What would be a real failure is
 * `exotic-adventure` coming out incoherent: that would mean the ranker lost
 * something the raw tag math already had.
 *
 * Read-only: it never writes `user/boxes.json`, and the fixtures are passed to
 * `rankBoxCandidates` as synthetic `Box` objects.
 */

const fs = require('fs');

require('./lib/ts-loader.js');

/** The two design fixtures, as canonical ids on the live store. */
const FIXTURES = [
  {
    id: 'exotic-adventure',
    name: 'Aventure exotique',
    members: ['a_1140', 'a_481', 'a_77', 'a_11318', 'a_538', 'a_457'],
  },
  {
    id: 'weird-concept',
    name: 'Concept bizarre',
    members: ['a_3213', 'a_7416', 'a_791', 'a_801', 'a_316', 'a_2054', 'a_1978', 'a_6602'],
  },
];

function parseArgs(argv) {
  const out = { limit: 15, members: null, weights: null, tagMinRank: undefined, box: null, diff: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit') out.limit = Number(argv[++i]);
    else if (argv[i] === '--box') out.box = argv[++i];
    else if (argv[i] === '--diff') out.diff = true;
    else if (argv[i] === '--members') out.members = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--tagrank') out.tagMinRank = Number(argv[++i]);
    else if (argv[i] === '--weights') {
      // `--weights anilistTags=1,studio=0` — sweeps the box weighting without
      // editing the constant, so a tuning run leaves no trace in the source.
      out.weights = {};
      for (const pair of argv[++i].split(',')) {
        const [k, v] = pair.split('=');
        out.weights[k.trim()] = Number(v);
      }
    }
  }
  return out;
}

/**
 * The declaration the blade would produce for a box: one group per direct-relation
 * component with 2+ of its entries actually filed here, seeded from the provider
 * graph exactly as §4 describes, and DECLARED on the box.
 *
 * Synthesized rather than read from `user/groups.json` because the whole point of
 * `--diff` is to measure the collapse before anyone has drawn a single group.
 */
function synthesizeGroups(box, all) {
  // Required here rather than at module scope: `main()` validates DATA_PATH
  // before any app module is loaded, and `store` reads it at module init.
  const { getFranchiseIndex } = require('@/lib/domain/franchise');
  const index = getFranchiseIndex(all, 'direct');
  const memberSet = new Set(box.members);
  const byComponent = new Map();
  for (const id of box.members) {
    const component = index.get(id);
    const key = component ? component[0].id : id;
    const bucket = byComponent.get(key);
    if (bucket) bucket.push(id);
    else byComponent.set(key, [id]);
  }
  const groups = [];
  for (const [key, filed] of byComponent) {
    if (filed.length < 2) continue;               // nothing to collapse
    const component = index.get(filed[0]);
    groups.push({
      id: `syn-${key}`,
      name: `syn-${key}`,
      // The blade seeds from the whole component; only what is FILED collapses.
      members: component ? component.map(a => a.id) : filed.filter(id => memberSet.has(id)),
      createdAt: new Date().toISOString(),
    });
  }
  return groups;
}

function main() {
  const args = parseArgs(process.argv);

  const dataPath = process.env.DATA_PATH;
  if (!dataPath || !fs.existsSync(dataPath)) {
    console.error(`DATA_PATH is not set or does not exist: ${dataPath}`);
    console.error('Run `npm run data:copy-salon` (or data:copy) first, then set DATA_PATH to it.');
    process.exit(1);
  }

  const { rankBoxCandidates } = require('@/lib/reco/boxes');
  const { BOX_WEIGHTS } = require('@/lib/reco/weights');
  const { getAnimeForDisplay } = require('@/lib/store');
  const { getPrimaryTitle } = require('@/lib/domain/animeUtils');
  const { getFranchiseIndex } = require('@/lib/domain/franchise');
  const { resolveBoxUnits } = require('@/lib/domain/boxUnits');
  const { getBoxProfile } = require('@/lib/reco/profiles');

  const all = getAnimeForDisplay();
  const byId = new Map(all.map(a => [a.id, a]));
  console.log(`store: ${all.length} records\n`);

  let boxes;
  if (args.box) {
    // The REAL boxes, so the §1 table is reproducible rather than described.
    const live = require('@/lib/reco/boxes').getBoxes();
    boxes = args.box === 'all' ? live.filter(b => b.members.length > 0) : live.filter(b => b.id === args.box);
    if (boxes.length === 0) {
      console.error(`no such box: ${args.box}. Known: ${live.map(b => b.id).join(', ')}`);
      process.exit(1);
    }
  } else if (args.members) {
    boxes = [{ id: 'adhoc', name: 'Ad-hoc', members: args.members, createdAt: new Date().toISOString() }];
  } else {
    boxes = FIXTURES.map(f => ({ ...f, createdAt: new Date().toISOString() }));
  }

  for (const box of boxes) {
    const present = box.members.filter(id => byId.has(id));
    console.log('='.repeat(72));
    console.log(`${box.name}  [${present.length}/${box.members.length} members resolved]`);
    for (const id of box.members) {
      const a = byId.get(id);
      console.log(`   seed ${id.padEnd(9)} ${a ? getPrimaryTitle(a, 'romaji') : '*** NOT IN STORE ***'}`);
    }

    const opts = { limit: args.limit };
    if (args.tagMinRank !== undefined) opts.tagMinRank = args.tagMinRank;
    if (args.weights) opts.weights = { ...BOX_WEIGHTS, ...args.weights };
    // A live box ranks with its attached reco profile, exactly as the MCP box
    // tools do (docs/recoProfiles/). Fixtures and --members have none. To sweep
    // a profile's weights without attaching one, use probe-profile.js --rank.
    const profile = getBoxProfile(box);
    if (profile) {
      opts.profile = profile.weights;
      console.log(`   profile: ${profile.name} ${JSON.stringify(profile.weights)}`);
    }

    if (args.diff) {
      // §7.1, measured: the same box ranked with every entry voting, then with
      // one vote per unit. `declared` is what makes the second run differ at all.
      const synth = synthesizeGroups(box, all);
      const declared = { ...box, groups: synth.map(g => g.id) };
      const units = resolveBoxUnits(declared, synth);

      const before = rankBoxCandidates({ ...box, groups: [] }, all, { ...opts, groups: [] });
      const after = rankBoxCandidates(declared, all, { ...opts, groups: synth });

      // The honest count the landing card will show, and §1's inflation.
      const biggest = Math.max(...units.units.map(u => u.members.length));
      console.log(
        `\n   ${units.units.length} units | ${present.length} entries` +
        `  — biggest unit ${biggest}` +
        `  (${((biggest / present.length) * 100).toFixed(0)}% of the vote before,` +
        ` ${((1 / units.units.length) * 100).toFixed(0)}% after)`
      );

      const beforeIds = before.map(g => g.id);
      const afterIds = after.map(g => g.id);
      const shown = Math.min(args.limit, afterIds.length);
      const churn = afterIds.slice(0, shown).filter(id => !beforeIds.slice(0, shown).includes(id)).length;
      console.log(`   top ${shown}: ${churn}/${shown} proposals changed\n`);

      const name = id => { const a = byId.get(id); return a ? getPrimaryTitle(a, 'romaji') : id; };
      const width = 44;
      const trunc = t => (t.length > width ? t.slice(0, width - 1) + '~' : t).padEnd(width);
      console.log(`   ${'BEFORE (one vote per entry)'.padEnd(width)}     AFTER (one vote per unit)`);
      for (let i = 0; i < shown; i++) {
        const b = beforeIds[i], a = afterIds[i];
        if (!b && !a) break;
        const mark = a && !beforeIds.slice(0, shown).includes(a) ? ' NEW ' : '     ';
        console.log(`   ${trunc(b ? name(b) : '')}${mark}${a ? name(a) : ''}`);
      }
      console.log();
      continue;
    }
    const t0 = Date.now();
    const groups = rankBoxCandidates(box, all, opts);
    const ms = Date.now() - t0;
    console.log(`\n   ${groups.length} proposals in ${ms}ms:\n`);

    for (const [i, g] of groups.entries()) {
      const anime = byId.get(g.id);
      const extra = g.members.length > 1 ? `  (+${g.members.length - 1} in franchise)` : '';
      console.log(
        `   ${String(i + 1).padStart(2)}. ${g.score.toFixed(3)}  ` +
        `${getPrimaryTitle(anime, 'romaji')}${extra}`
      );
      for (const m of g.matched) {
        console.log(`         ${m.field.padEnd(13)} ${m.values.join(' · ')}`);
      }
    }
    console.log();
  }
}

main();
