/**
 * Bilan of « Vu grâce à la reco »: what the recommendation feed actually
 * brought, as opposed to what it merely ranked highly.
 *
 *   set DATA_PATH=E:\Workspace\local\AnimeTracker\data
 *   node scripts/probe-reco-credit.js
 *   node scripts/probe-reco-credit.js --list
 *
 * Reads `user/reco_credit.json` (written by the owner, see
 * `src/lib/reco/recoCredit.ts`) against their CURRENT personal state. It is the
 * one question `backtest-reco.js` structurally cannot answer: that harness
 * grades the engine on "titles the owner went on to complete and score >= 8",
 * which scores a lucky ranking exactly like a causal one.
 *
 * It MEASURES, it does not assert — and three readings keep it honest:
 *
 *  - **The control is contaminated, in the feed's disfavour.** The "autrement"
 *    column is titles found alone PLUS every pick the owner forgot to flag. A
 *    forgotten pick drags the control UP, so the gap is a LOWER bound on what
 *    the feed is worth, never an upper one. Do not read an absent flag as
 *    "found alone".
 *  - **« Jamais lancé » is the number not to look away from.** It only exists
 *    because the flag can be filed before watching; measuring the feed on the
 *    titles it succeeded with is survivorship bias, and makes it look perfect.
 *  - **It starts empty.** A row needs a pick, then weeks of watching, then a
 *    score — the first useful numbers are a season or two out.
 */

const fs = require('fs');
const path = require('path');

require('./lib/ts-loader.js');

function parseArgs(argv) {
  const out = { list: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--list') out.list = true;
  }
  return out;
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function fmt(n, digits = 2) {
  return n == null ? '  —  ' : n.toFixed(digits);
}

function describe(label, xs) {
  const hi = xs.filter(s => s >= 8).length;
  const share = xs.length ? ((hi / xs.length) * 100).toFixed(0) + '%' : '—';
  console.log(
    `  ${label.padEnd(22)} n=${String(xs.length).padStart(4)}` +
    `  médiane ${fmt(median(xs), 1)}  moyenne ${fmt(mean(xs))}  >=8 : ${String(hi).padStart(3)} (${share})`
  );
}

function main() {
  const args = parseArgs(process.argv);
  const dataPath = process.env.DATA_PATH;
  if (!dataPath || !fs.existsSync(dataPath)) {
    console.error(`DATA_PATH is not set or does not exist: ${dataPath}`);
    console.error('Run `npm run data:copy` (or data:copy-salon) first, then set DATA_PATH to it.');
    process.exit(1);
  }
  const file = path.join(dataPath, 'user/reco_credit.json');
  if (!fs.existsSync(file)) {
    console.log(`Aucun crédit enregistré (${file}).`);
    console.log('Le bouton « Grâce à la reco » est sur les cartes de /recommendations et sur la page de détail.');
    return;
  }
  const credits = JSON.parse(fs.readFileSync(file, 'utf8'));

  const { getAnimeForDisplay } = require('@/lib/store');
  const { getEffectiveStatus, getEffectiveScore, getPrimaryTitle } = require('@/lib/domain/animeUtils');
  const { summarizeRecoCredit } = require('@/lib/reco/recoCredit');

  const all = getAnimeForDisplay();
  const s = summarizeRecoCredit(all, credits);

  console.log(`\n« Vu grâce à la reco » — ${s.credited} titre(s) crédité(s)` +
    (s.unresolved ? `, ${s.unresolved} id(s) sans fiche (ignorés)` : ''));

  const days = Object.values(credits).map(c => c.at).filter(Boolean).sort();
  if (days.length) console.log(`  fenêtre : ${days[0]} -> ${days[days.length - 1]}`);

  const o = s.outcome;
  const started = o.watching + o.onHold + o.dropped + o.completed;
  console.log('\nCe que les picks sont devenus');
  console.log(`  jamais lancé      ${String(o.notStarted).padStart(4)}`);
  console.log(`  en cours          ${String(o.watching).padStart(4)}`);
  console.log(`  en pause          ${String(o.onHold).padStart(4)}`);
  console.log(`  abandonné         ${String(o.dropped).padStart(4)}`);
  console.log(`  terminé           ${String(o.completed).padStart(4)}`);
  if (s.credited) {
    console.log(`  -> lancés : ${started}/${s.credited}` +
      ` (${((started / s.credited) * 100).toFixed(0)}%)` +
      `, terminés : ${o.completed}/${s.credited} (${((o.completed / s.credited) * 100).toFixed(0)}%)`);
  }

  console.log('\nNotes des titres TERMINÉS et notés');
  describe('grâce à la reco', s.scored.credited);
  describe('autrement', s.scored.other);
  if (s.scored.credited.length && s.scored.other.length) {
    const d = mean(s.scored.credited) - mean(s.scored.other);
    console.log(`  écart : ${d >= 0 ? '+' : ''}${d.toFixed(2)} — borne BASSE :`
      + ' « autrement » contient les picks oubliés, qui le tirent vers le haut.');
  }
  if (s.scored.credited.length < 10) {
    console.log('  ⚠️ trop peu de lignes pour que cet écart veuille dire quoi que ce soit.');
  }

  if (args.list) {
    console.log('\nDétail');
    const byId = new Map(all.map(a => [a.id, a]));
    const rows = Object.entries(credits).map(([id, c]) => {
      const a = byId.get(id);
      return {
        at: c.at,
        title: a ? getPrimaryTitle(a, 'romaji') : id,
        status: a ? (getEffectiveStatus(a) || 'jamais lancé') : 'fiche absente',
        score: a ? getEffectiveScore(a) : null,
      };
    }).sort((x, y) => String(x.at).localeCompare(String(y.at)));
    for (const r of rows) {
      console.log(`  ${r.at}  ${String(r.status).padEnd(14)} ${r.score ? '★' + r.score : '   '}  ${r.title}`);
    }
  }
  console.log('');
}

main();
