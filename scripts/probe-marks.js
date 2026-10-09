/**
 * Bilan of the mark history: what the « Recommandé » mark said about a title
 * before the owner judged it, held against the score they gave in the end.
 *
 *   set DATA_PATH=E:\Workspace\local\AnimeTracker\data
 *   node scripts/probe-marks.js
 *   node scripts/probe-marks.js --min-score 8 --list
 *
 * Reads `history/affinity_marks.json` (written by the cron, see
 * `src/lib/reco/markHistory.ts`) and the owner's CURRENT personal state. Unlike
 * `probe-affinity.js` it replays nothing: every point was recorded on the day,
 * with the metadata that existed that day — which is the whole reason it exists.
 *
 * It MEASURES, it does not assert. Two readings to keep in mind:
 *
 *  - **The mark steers what gets watched.** A ★ title is more likely to be
 *    started, so "★ titles scored higher" is partly the owner choosing well
 *    among what the mark showed. Read precision (of the ★ you watched, how many
 *    you loved) and recall (of what you loved, how much was marked) together,
 *    and look at the ★ nobody started.
 *  - **The history starts empty.** A point needs a title to air and then be
 *    watched and scored, so the first useful numbers are a season or two out.
 */

const fs = require('fs');
const path = require('path');

require('./lib/ts-loader.js');

function parseArgs(argv) {
  const out = { minScore: 8, list: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--min-score') out.minScore = Number(argv[++i]);
    else if (argv[i] === '--list') out.list = true;
  }
  return out;
}

const SEEN = new Set(['watching', 'completed', 'on_hold', 'dropped']);

function badge(p) {
  if (!p) return 'absent';
  if (p.score == null) return 'unscoreable';
  if (p.shown) return p.tier === 'strong' ? '★ shown' : '☆ shown';
  return 'no badge';
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Spearman rank correlation, average ranks on ties. */
function spearman(pairs) {
  if (pairs.length < 3) return null;
  const rank = xs => {
    const order = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(xs.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const a = rank(pairs.map(p => p[0]));
  const b = rank(pairs.map(p => p[1]));
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : null;
}

function main() {
  const args = parseArgs(process.argv);
  const dataPath = process.env.DATA_PATH;
  if (!dataPath || !fs.existsSync(dataPath)) {
    console.error(`DATA_PATH is not set or does not exist: ${dataPath}`);
    console.error('Run `npm run data:copy` (or data:copy-salon) first, then set DATA_PATH to it.');
    process.exit(1);
  }
  const file = path.join(dataPath, 'history/affinity_marks.json');
  if (!fs.existsSync(file)) {
    console.log(`No mark history yet at ${file} — the cron writes it on its next tick.`);
    return;
  }
  const history = JSON.parse(fs.readFileSync(file, 'utf8'));

  const { getAnimeForDisplay } = require('@/lib/store');
  const { getEffectiveStatus, getEffectiveScore, getPrimaryTitle } = require('@/lib/domain/animeUtils');
  const byId = new Map(getAnimeForDisplay().map(a => [a.id, a]));

  const rows = Object.entries(history).map(([id, entry]) => {
    const anime = byId.get(id);
    return {
      id,
      entry,
      title: anime ? getPrimaryTitle(anime, 'romaji') : id,
      status: anime ? getEffectiveStatus(anime) : undefined,
      score: anime ? getEffectiveScore(anime) : undefined,
    };
  });

  const count = key => rows.filter(r => r.entry[key]).length;
  const datedNoEp3 = rows.filter(r => !r.entry.ep3 && r.entry.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(r.entry.startDate)).length;
  console.log(
    `\n${rows.length} titles tracked — first ${count('first')}, preAir ${count('preAir')}, ep3 ${count('ep3')}` +
    `  (${datedNoEp3} with an imprecise start date: no J+21 possible)`
  );

  const firstTags = rows.filter(r => r.entry.first && r.entry.preAir);
  if (firstTags.length) {
    console.log(
      `metadata at first sight → at air (median): tags ${median(firstTags.map(r => r.entry.first.tags))} → ` +
      `${median(firstTags.map(r => r.entry.preAir.tags))}, staff ${median(firstTags.map(r => r.entry.first.staff))} → ` +
      `${median(firstTags.map(r => r.entry.preAir.staff))}`
    );
  }

  for (const key of ['first', 'preAir', 'ep3']) {
    const withPoint = rows.filter(r => r.entry[key]);
    if (!withPoint.length) continue;
    console.log(`\n== ${key}`);
    const groups = new Map();
    for (const r of withPoint) {
      const b = badge(r.entry[key]);
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b).push(r);
    }
    for (const b of ['★ shown', '☆ shown', 'no badge', 'unscoreable']) {
      const g = groups.get(b) || [];
      if (!g.length) continue;
      const seen = g.filter(r => r.status && SEEN.has(r.status));
      const scored = seen.filter(r => r.score);
      const loved = scored.filter(r => r.score >= args.minScore);
      const avg = scored.length ? (scored.reduce((s, r) => s + r.score, 0) / scored.length).toFixed(2) : '—';
      console.log(
        `  ${b.padEnd(12)} ${String(g.length).padStart(4)} titles · started ${String(seen.length).padStart(3)} · ` +
        `scored ${String(scored.length).padStart(3)} · mean ${avg} · >= ${args.minScore}: ${loved.length}`
      );
    }
    const loved = withPoint.filter(r => r.score && r.score >= args.minScore);
    const marked = loved.filter(r => r.entry[key].shown);
    console.log(`  recall: ${marked.length}/${loved.length} of the titles you scored >= ${args.minScore} carried a badge`);

    if (key === 'ep3') {
      const scored = withPoint.filter(r => r.score && r.entry.ep3.pct != null);
      const rhoMark = spearman(scored.map(r => [r.entry.ep3.pct, r.score]));
      const withMean = withPoint.filter(r => r.score && r.entry.ep3.malMean);
      const rhoMean = spearman(withMean.map(r => [r.entry.ep3.malMean, r.score]));
      console.log(
        `  your score vs affinity percentile at J+21: rho ${rhoMark == null ? '—' : rhoMark.toFixed(2)} (n=${scored.length})\n` +
        `  your score vs MAL mean at J+21:            rho ${rhoMean == null ? '—' : rhoMean.toFixed(2)} (n=${withMean.length})`
      );
    }
  }

  const ignored = rows.filter(r => r.entry.preAir?.shown && r.entry.preAir.tier === 'strong' && !(r.status && SEEN.has(r.status)) && r.entry.ep3);
  if (ignored.length) {
    console.log(`\n★ at air, aired since, never started: ${ignored.length}`);
    if (args.list) ignored.forEach(r => console.log(`  ${r.title}`));
  }

  if (args.list) {
    console.log('\nscored titles with a pre-air point:');
    rows
      .filter(r => r.score && r.entry.preAir)
      .sort((a, b) => b.score - a.score)
      .forEach(r => console.log(
        `  ${String(r.score).padStart(2)}  air ${badge(r.entry.preAir).padEnd(11)}  ep3 ${badge(r.entry.ep3).padEnd(11)}  ${r.title.slice(0, 50)}`
      ));
  }
}

main();
