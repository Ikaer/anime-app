/**
 * Probe the « boîtes » grow ranker against the real store, without a UI.
 *
 *   set DATA_PATH=D:\Workspaces\local\AnimeTracker\data
 *   node scripts/probe-box.js
 *   node scripts/probe-box.js --members a_3213,a_791,a_801 --limit 20
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
  const out = { limit: 15, members: null, weights: null, tagMinRank: undefined };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit') out.limit = Number(argv[++i]);
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

function main() {
  const args = parseArgs(process.argv);

  const dataPath = process.env.DATA_PATH;
  if (!dataPath || !fs.existsSync(dataPath)) {
    console.error(`DATA_PATH is not set or does not exist: ${dataPath}`);
    console.error('Run `npm run data:copy-salon` (or data:copy) first, then set DATA_PATH to it.');
    process.exit(1);
  }

  const { rankBoxCandidates, BOX_WEIGHTS } = require('@/lib/reco/boxes');
  const { getAnimeForDisplay } = require('@/lib/store');
  const { getPrimaryTitle } = require('@/lib/domain/animeUtils');

  const all = getAnimeForDisplay();
  const byId = new Map(all.map(a => [a.id, a]));
  console.log(`store: ${all.length} records\n`);

  const boxes = args.members
    ? [{ id: 'adhoc', name: 'Ad-hoc', members: args.members, createdAt: new Date().toISOString() }]
    : FIXTURES.map(f => ({ ...f, createdAt: new Date().toISOString() }));

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
