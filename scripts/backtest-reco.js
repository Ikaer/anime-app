/**
 * Backtest the "Pour toi" ranking against titles the owner actually went on to
 * love — the falsifiability the engine has never had.
 *
 * `affinityScore` is a hand-weighted sum, so until now every knob was tuned by
 * eyeballing the feed: a change could be argued about but not measured. This
 * script turns the question into a number by replaying history.
 *
 *   node scripts/backtest-reco.js --cutoff 2026-01-01
 *   node scripts/backtest-reco.js --cutoff 2026-01-01 --weights popularity=-0.4
 *
 * ## How it works
 *
 * `personal/simkl.json`'s `watched_at` is the clock (650/691 coverage, and a
 * REAL watch date — Evangelion aired 1995 and is stamped 2026-05). MAL's
 * `updated_at` is not usable for this: 463 of 712 entries carry the same
 * 2026-07 bulk-sync timestamp, which flattens the timeline into one day.
 *
 * Given a cutoff T, the script materializes a temp store that looks like the
 * real one did before T — every personal entry watched on or after T is
 * stripped from all four slices — then runs the REAL `computeFeed` against it
 * and asks where the stripped titles landed. A title the owner completed and
 * scored >= 8 after T is a held-out positive: the feed SHOULD have been
 * ranking it highly beforehand.
 *
 * **The reco cache is pruned the same way**, and that is the load-bearing part.
 * `cache/recommendations.json` was fetched using today's seeds, so a post-T
 * favourite sits in the candidate pool partly BECAUSE it is now a seed itself.
 * Dropping every seed the owner had not yet watched removes that leakage, at
 * the cost of a smaller pool than a true point-in-time refresh would have had.
 * The surviving edges are still today's crowd graph rather than T's — crowd
 * edges move on a scale of months, so this stays approximate, and it is why
 * these numbers are comparable only to EACH OTHER, run to run, never read as an
 * absolute quality score.
 *
 * ## What to read
 *
 * `reachable` is the ceiling: held-out positives that are in the candidate pool
 * at all. No ranking change can recover the rest — those need a wider fetch,
 * not better scoring. `recall@k` and MRR over the reachable set are the
 * comparison metric: change a knob, re-run, see which way they move.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

require('./lib/ts-loader.js');

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { cutoff: '2026-01-01', ks: [10, 25, 50, 100, 250], weights: {}, minScore: 8, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--cutoff') out.cutoff = argv[++i];
    else if (arg === '--min-score') out.minScore = Number(argv[++i]);
    else if (arg === '--keep') out.keep = true;
    else if (arg === '--weights') {
      for (const pair of argv[++i].split(',')) {
        const [key, value] = pair.split('=');
        out.weights[key.trim()] = Number(value);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The "as of T" store
// ---------------------------------------------------------------------------

const PERSONAL_SLICES = [
  'personal/simkl.json',
  'personal/mal.json',
  'personal/anilist.json',
  'personal/local.json',
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Canonical ids whose SIMKL entry was watched on or after the cutoff. */
function futureIds(dataPath, cutoff) {
  const simkl = readJson(path.join(dataPath, 'personal/simkl.json'), {});
  const ids = new Set();
  let undated = 0;
  for (const [id, entry] of Object.entries(simkl)) {
    if (!entry.watched_at) {
      undated++;
      continue;
    }
    if (entry.watched_at.slice(0, 10) >= cutoff) ids.add(id);
  }
  return { ids, undated };
}

/**
 * A copy of the store with the post-cutoff personal entries and their reco
 * seeds removed. Copied rather than edited in place: the personal slices are
 * durable user data, and a measurement harness must never be the thing that
 * eats them.
 */
function materializePastStore(dataPath, future) {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'reco-backtest-'));
  fs.cpSync(dataPath, dest, { recursive: true });

  for (const slice of PERSONAL_SLICES) {
    const file = path.join(dest, slice);
    if (!fs.existsSync(file)) continue;
    const data = readJson(file, {});
    for (const id of future) delete data[id];
    fs.writeFileSync(file, JSON.stringify(data));
  }

  // Prune the leak: edges contributed by a seed the owner had not watched yet.
  const cacheFile = path.join(dest, 'cache/recommendations.json');
  const cache = readJson(cacheFile, null);
  if (cache) {
    for (const key of ['seeds', 'anilistSeeds']) {
      if (!cache[key]) continue;
      for (const seedId of Object.keys(cache[key])) {
        if (future.has(seedId)) delete cache[key][seedId];
      }
    }
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  }
  return dest;
}

/**
 * The owner's real score per title, read from the untouched store before
 * DATA_PATH is repointed. SIMKL first, matching personal precedence.
 */
function realScores(dataPath) {
  const scores = new Map();
  for (const slice of PERSONAL_SLICES) {
    const data = readJson(path.join(dataPath, slice), {});
    for (const [id, entry] of Object.entries(data)) {
      if (!scores.has(id) && entry.status === 'completed' && entry.score > 0) {
        scores.set(id, entry.score);
      }
    }
  }
  return scores;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataPath = process.env.DATA_PATH;
  if (!dataPath || !fs.existsSync(dataPath)) {
    console.error(`DATA_PATH is not set or does not exist: ${dataPath}`);
    process.exit(1);
  }

  const { ids: future, undated } = futureIds(dataPath, args.cutoff);
  console.log(
    `Cutoff ${args.cutoff} — ${future.size} titles watched on/after it ` +
    `(${undated} SIMKL entries carry no date and stay in the past).`
  );
  if (future.size === 0) {
    console.error('Nothing after the cutoff; pick an earlier one.');
    process.exit(1);
  }

  const scores = realScores(dataPath);
  const positives = new Set([...future].filter(id => (scores.get(id) ?? 0) >= args.minScore));
  console.log(`Held-out positives (completed, score >= ${args.minScore}): ${positives.size}`);

  const pastStore = materializePastStore(dataPath, future);
  process.env.DATA_PATH = pastStore;

  // Required only now: `jsonStore` resolves DATA_PATH once, at import time.
  const { computeFeed } = require('@/lib/reco/feed');
  const { getAnimeForDisplay } = require('@/lib/store');
  const { getPrimaryTitle } = require('@/lib/domain/animeUtils');

  const titleOf = new Map(getAnimeForDisplay().map(a => [a.id, getPrimaryTitle(a)]));
  const started = Date.now();
  const items = computeFeed({ nicheMode: false, weights: args.weights });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const ranks = [];
  items.forEach((item, index) => {
    if (positives.has(item.id)) ranks.push({ rank: index + 1, id: item.id });
  });
  ranks.sort((a, b) => a.rank - b.rank);
  const reachable = ranks.length;

  console.log(`\nPool ${items.length} candidates, ranked in ${elapsed}s.`);
  console.log(
    `Reachable: ${reachable}/${positives.size} positives are in the pool ` +
    `(${(100 * reachable / positives.size).toFixed(1)}%) — the ceiling for any ranking change.\n`
  );
  if (reachable === 0) {
    console.log('Nothing to score.');
    if (!args.keep) fs.rmSync(pastStore, { recursive: true, force: true });
    return;
  }

  console.log('    k    hits   recall@k (all)   recall@k (reachable)');
  for (const k of args.ks) {
    const hits = ranks.filter(r => r.rank <= k).length;
    console.log(
      `  ${String(k).padStart(3)}    ${String(hits).padStart(4)}   ` +
      `${(100 * hits / positives.size).toFixed(1).padStart(13)}%   ` +
      `${(100 * hits / reachable).toFixed(1).padStart(18)}%`
    );
  }

  const mrr = ranks.reduce((sum, r) => sum + 1 / r.rank, 0) / reachable;
  const meanRank = ranks.reduce((sum, r) => sum + r.rank, 0) / reachable;
  const medianRank = ranks[Math.floor((reachable - 1) / 2)].rank;
  console.log(
    `\n  MRR ${mrr.toFixed(4)}   median rank ${medianRank}   mean rank ${meanRank.toFixed(1)}`
  );

  console.log('\n  Best-placed held-out favourites:');
  for (const r of ranks.slice(0, 10)) {
    console.log(`    #${String(r.rank).padStart(4)}  ${titleOf.get(r.id) ?? r.id}`);
  }

  if (args.keep) console.log(`\nPast store kept at ${pastStore}`);
  else fs.rmSync(pastStore, { recursive: true, force: true });
}

main();
