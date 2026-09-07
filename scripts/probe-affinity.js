/**
 * Backtest the « Recommandé » mark: would it have marked the titles the owner
 * went on to love, at the moment their season started?
 *
 *   set DATA_PATH=E:\Workspace\local\AnimeTracker\data
 *   node scripts/probe-affinity.js --season 2024-fall
 *   node scripts/probe-affinity.js --season 2024-fall --thin
 *   node scripts/probe-affinity.js --season 2024-fall --weights anilistStaff=1,anilistTags=0.4
 *
 * `buildAffinityIndex` is a hand-weighted sum with no ground truth, exactly the
 * shape `scripts/backtest-reco.js` exists to keep honest — so the mark gets the
 * same treatment. It MEASURES rather than asserts: do not convert it into a
 * pass/fail test, and read the DIRECTION of a change rather than the magnitude.
 *
 * ## How it works
 *
 * Given a season, the cutoff is that season's first day. The script copies the
 * store, strips every personal entry whose SIMKL `watched_at` falls on or after
 * the cutoff (the only usable clock — MAL's `updated_at` collapses 463 of 712
 * entries onto one bulk-sync day), and runs the REAL `buildAffinityIndex`
 * against the result. A title the owner later completed and scored >= 8 is a
 * held-out positive: the mark SHOULD have been on it.
 *
 * Unlike the feed's harness this one needs no cache pruning — the ranker never
 * reads `cache/recommendations.json`, so there is no seed leaking back in.
 *
 * ## ⚠️ Two leaks that are NOT fixed, and must be read into every number
 *
 *  - **AniList tags are today's.** They accumulate by user vote as a show airs,
 *    so a 2024 season is scored with metadata that did not exist at its cutoff:
 *    median 12 tags against the next season's 4. `--thin` truncates candidates
 *    to the measured season-start density (top 4 tags, 8 staff) and is the more
 *    honest number; the default is the ceiling.
 *  - **Popularity cannot be probed at all.** `num_list_users` is a present-day
 *    snapshot, so a past hit carries the members it earned BY being a hit
 *    (Dandadan: 23× its season's median today). That is why anticipation is
 *    displayed beside the mark and never scored inside it — see `affinity.ts`.
 *
 * ## What to read
 *
 * `favourites caught` at each threshold against `badged`: the mark is worth
 * having when it concentrates the favourites into a small share of the season.
 * The reachable set is 4-9 positives per season, so ONE season moves on noise —
 * run several, the same rule as the feed's cutoffs.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

require('./lib/ts-loader.js');

const SEASON_START = { winter: '01-01', spring: '04-01', summer: '07-01', fall: '10-01' };
const PERSONAL_SLICES = [
  'personal/simkl.json',
  'personal/mal.json',
  'personal/anilist.json',
  'personal/local.json',
];

function parseArgs(argv) {
  const out = { season: '2024-fall', mediaTypes: ['tv'], top: 12, thin: false, weights: null, minScore: 8 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--season') out.season = argv[++i];
    else if (arg === '--top') out.top = Number(argv[++i]);
    else if (arg === '--thin') out.thin = true;
    else if (arg === '--min-score') out.minScore = Number(argv[++i]);
    else if (arg === '--media') out.mediaTypes = argv[++i].split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--weights') {
      out.weights = {};
      for (const pair of argv[++i].split(',')) {
        const [key, value] = pair.split('=');
        out.weights[key.trim()] = Number(value);
      }
    }
  }
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** A copy of the store as it stood before the cutoff. Never edits the real one. */
function materializePastStore(dataPath, future) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'affinity-probe-'));
  fs.cpSync(dataPath, dest, { recursive: true });
  for (const slice of PERSONAL_SLICES) {
    const file = path.join(dest, slice);
    if (!fs.existsSync(file)) continue;
    const data = readJson(file, {});
    for (const id of future) delete data[id];
    fs.writeFileSync(file, JSON.stringify(data));
  }
  return dest;
}

/**
 * Season-start metadata density, emulated on the CANDIDATE side only — the
 * profile still comes from the owner's own well-tagged watched titles, which is
 * how it works live too. Measured on the store: the next season carries a
 * median of 4 tags and 8 staff credits.
 */
function thinRecord(anime) {
  const src = anime.sources.anilist;
  if (!src) return anime;
  return {
    ...anime,
    sources: {
      ...anime.sources,
      anilist: {
        ...src,
        tags: [...(src.tags || [])].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, 4),
        staff: (src.staff || []).slice(0, 8),
      },
    },
  };
}

function main() {
  const args = parseArgs(process.argv);
  const [yearStr, seasonName] = args.season.split('-');
  if (!SEASON_START[seasonName]) {
    console.error(`Bad --season '${args.season}'. Expected YYYY-winter|spring|summer|fall.`);
    process.exit(1);
  }
  const cutoff = `${yearStr}-${SEASON_START[seasonName]}`;

  const dataPath = process.env.DATA_PATH;
  if (!dataPath || !fs.existsSync(dataPath)) {
    console.error(`DATA_PATH is not set or does not exist: ${dataPath}`);
    console.error('Run `npm run data:copy` (or data:copy-salon) first, then set DATA_PATH to it.');
    process.exit(1);
  }

  const simkl = readJson(path.join(dataPath, 'personal/simkl.json'), {});
  const future = new Set();
  for (const [id, entry] of Object.entries(simkl)) {
    if (entry.watched_at && entry.watched_at.slice(0, 10) >= cutoff) future.add(id);
  }
  if (future.size === 0) {
    console.error(`Nothing watched on/after ${cutoff}; pick an earlier season.`);
    process.exit(1);
  }

  // The owner's real scores, read before DATA_PATH is repointed.
  const scores = new Map();
  for (const slice of PERSONAL_SLICES) {
    for (const [id, entry] of Object.entries(readJson(path.join(dataPath, slice), {}))) {
      if (!scores.has(id) && entry.status === 'completed' && entry.score > 0) scores.set(id, entry.score);
    }
  }

  const pastStore = materializePastStore(dataPath, future);
  process.env.DATA_PATH = pastStore;

  // Required only now: `jsonStore` resolves DATA_PATH once, at import time.
  const { buildAffinityIndex, AFFINITY_WEIGHTS } = require('@/lib/reco/affinity');
  const { getAnimeForDisplay } = require('@/lib/store');
  const { getPrimaryTitle } = require('@/lib/domain/animeUtils');

  const real = getAnimeForDisplay();
  const all = args.thin ? real.map(thinRecord) : real;
  const options = {};
  if (args.weights) options.weights = { ...AFFINITY_WEIGHTS, ...args.weights };

  const started = Date.now();
  const index = buildAffinityIndex(all, options);
  const elapsed = Date.now() - started;

  const ranked = [...index.scores.entries()].sort((a, b) => b[1] - a[1]);
  const byId = new Map(all.map(a => [a.id, a]));
  const inSeason = ranked
    .filter(([id]) => {
      const anime = byId.get(id);
      const season = anime.catalog.startSeason;
      if (!season || season.year !== Number(yearStr) || season.season !== seasonName) return false;
      return args.mediaTypes.length === 0 || args.mediaTypes.includes(anime.catalog.mediaType);
    })
    .map(([id, score], rank) => ({ id, score, rank, anime: byId.get(id), owner: scores.get(id) }));

  const positives = inSeason.filter(r => (r.owner ?? 0) >= args.minScore);

  console.log(
    `\n=== ${args.season}  cutoff ${cutoff}${args.thin ? '  [--thin: season-start metadata density]' : ''}\n` +
    `store ${all.length} records, ${future.size} titles hidden as future, ${index.seedCount} seeds\n` +
    `unseen ${index.coverage.unseen}, scoreable ${index.coverage.scoreable} ` +
    `(${(100 * index.coverage.scoreable / Math.max(index.coverage.unseen, 1)).toFixed(0)}% — the rest have no AniList entry)\n` +
    `scored in ${elapsed}ms; tiers cut at strong ${index.thresholds.strong.toFixed(3)} / notable ${index.thresholds.notable.toFixed(3)}\n` +
    `season: ${inSeason.length} scoreable unseen titles, ${positives.length} eventually scored >= ${args.minScore}`
  );

  if (args.top > 0) {
    console.log(`\ntop ${args.top} of the season by affinity:`);
    inSeason.slice(0, args.top).forEach((row, i) => {
      const mark = index.marks.get(row.id);
      const badge = mark ? (mark.tier === 'strong' ? '★' : '☆') : ' ';
      const outcome = row.owner ? (row.owner >= args.minScore ? `  <-- LOVED ${row.owner}` : `  (watched, ${row.owner})`) : '';
      console.log(
        `  ${String(i + 1).padStart(2)}. ${badge} ${row.score.toFixed(3)}  ` +
        `${getPrimaryTitle(row.anime, 'romaji').slice(0, 52)}${outcome}`
      );
    });
  }

  console.log('\nwhere the held-out favourites landed:');
  if (positives.length === 0) console.log('  (none in this season)');
  for (const row of positives) {
    const mark = index.marks.get(row.id);
    const seasonRank = inSeason.indexOf(row) + 1;
    console.log(
      `  score ${row.owner}  season-rank ${seasonRank}/${inSeason.length}  affinity ${row.score.toFixed(3)}  ` +
      `${mark ? (mark.tier === 'strong' ? 'MARKED ★' : 'MARKED ☆') : 'not marked'}  ` +
      getPrimaryTitle(row.anime, 'romaji').slice(0, 50)
    );
  }

  // The shipped tiers, plus two looser cuts for comparison. Percentiles are over
  // the whole scoreable unseen catalog, which is what the live badge uses — a
  // cut taken inside the season would badge a fixed share of every season.
  const catalogScores = ranked.map(([, score]) => score);
  console.log('\nthresholds (percentile of the scoreable unseen catalog):');
  for (const p of [0.99, 0.97, 0.95, 0.9, 0.85]) {
    const cut = catalogScores[Math.min(catalogScores.length - 1, Math.floor(catalogScores.length * (1 - p)))];
    const badged = inSeason.filter(r => r.score >= cut);
    const caught = badged.filter(r => (r.owner ?? 0) >= args.minScore).length;
    const watched = badged.filter(r => r.owner != null).length;
    const shipped = p === 0.97 ? '  <- ★' : p === 0.9 ? '  <- ☆' : '';
    console.log(
      `  p${String(Math.round(p * 100)).padStart(2)} cut=${cut.toFixed(3)}  ` +
      `badged ${String(badged.length).padStart(3)}/${inSeason.length}  ` +
      `favourites ${caught}/${positives.length}  ` +
      `of badged, eventually watched ${watched}${shipped}`
    );
  }

  fs.rmSync(pastStore, { recursive: true, force: true });
}

main();
