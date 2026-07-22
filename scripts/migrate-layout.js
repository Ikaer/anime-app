/**
 * Data-layout migration (docs/DATA-LAYOUT.md): move the flat store into role
 * folders. **No data shapes and no keys change** — every file keeps its contents
 * and its canonical-id keying. Only paths change, plus the optional deletion of
 * files nothing reads.
 *
 *   animes_mal.json               → catalog/mal.json
 *   animes_mal_personal.json      → personal/mal.json
 *   animes_hidden.json            → user/hidden.json
 *   mal_auth.json                 → auth/mal.json
 *   … (the full table is MOVES below; it mirrors docs/DATA-LAYOUT.md §3.1)
 *
 * Two files stay at the root on purpose: `settings.json` (tier-1 config, read
 * before the store exists) and `registry.json` (the identity spine every other
 * file's keys resolve through — it belongs to no role because it is what the
 * roles hang off; it is renamed from `animes_registry.json` but not moved).
 *
 * Why a script and not a startup migration: matches the canonical-id / H1
 * precedent — a migration that runs inside the NAS container is one whose output
 * nobody reads, and this one has a delete step. The new app code REFUSES TO
 * START against a pre-layout store (flat `animes_*.json` present, no `catalog/`
 * — see assertMigratedLayout in src/lib/jsonStore.ts), so this must run against
 * the stopped app, before the new image is deployed.
 *
 * Order of operations, per file (write-verify-remove): write the new path →
 * read it back and verify it is byte-identical and parses → unlink the old. A
 * crash mid-run therefore leaves BOTH copies, never neither.
 *
 * Idempotency:
 *   - new exists, old does not  → no-op (already migrated)
 *   - neither exists            → skip (simply absent on this install)
 *   - BOTH exist                → REFUSE and report; never last-writer-wins.
 *     It means an interrupted run, or the app wrote to the old path after a
 *     partial migration — either way a human has to say which one is real.
 * Nothing is written until every file has been classified, so a refusal leaves
 * the store exactly as it was.
 *
 * Unknown files are reported and left alone: either something this document
 * missed or something the user put there. Both deserve a human.
 *
 * The orphan sweep (--sweep-orphans) is opt-in and separate from the move, so
 * the layout change can ship without touching anything's contents. It deletes;
 * that is safe because of the runbook (stopped app, minutes-old backup) rather
 * than because of the grep. It always lists what it will remove.
 *
 * Usage:
 *   node scripts/migrate-layout.js <dataPath> [--dry-run] [--sweep-orphans]
 *   DATA_PATH=/path node scripts/migrate-layout.js [--dry-run]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── args ──
const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));
const DRY_RUN = flags.has('--dry-run');
const SWEEP_ORPHANS = flags.has('--sweep-orphans');

const KNOWN_FLAGS = new Set(['--dry-run', '--sweep-orphans']);
for (const flag of flags) {
  if (!KNOWN_FLAGS.has(flag)) {
    console.error(`Unknown flag: ${flag}`);
    console.error('Usage: node scripts/migrate-layout.js <dataPath> [--dry-run] [--sweep-orphans]');
    process.exit(1);
  }
}

function defaultDataPath() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'anime-app', 'data');
  }
  return path.join(os.homedir(), '.anime-app', 'data');
}

const DATA_PATH = positional[0] || process.env.DATA_PATH || defaultDataPath();

if (!fs.existsSync(DATA_PATH)) {
  console.error(`Data path does not exist: ${DATA_PATH}`);
  console.error('Usage: node scripts/migrate-layout.js <dataPath> [--dry-run] [--sweep-orphans]');
  process.exit(1);
}

// ── the mapping (docs/DATA-LAYOUT.md §3.1) ──
// `settings.json` is absent from this table on purpose: it does not move.
const MOVES = [
  ['animes_registry.json', 'registry.json'],

  ['animes_mal.json', 'catalog/mal.json'],
  ['animes_anilist_meta.json', 'catalog/anilist.json'],
  ['animes_anilist_cast.json', 'catalog/anilist_cast.json'],

  ['animes_mal_personal.json', 'personal/mal.json'],
  ['animes_simkl.json', 'personal/simkl.json'],
  ['animes_anilist_personal.json', 'personal/anilist.json'],
  ['animes_local_personal.json', 'personal/local.json'],

  ['animes_hidden.json', 'user/hidden.json'],
  ['recommendations_feedback.json', 'user/reco_feedback.json'],
  ['recommendations_dismissed.json', 'user/reco_dismissed.json'],

  ['mal_auth.json', 'auth/mal.json'],
  ['simkl_auth.json', 'auth/simkl.json'],
  ['anilist_auth.json', 'auth/anilist.json'],
  // The three CSRF-state files stay separate rather than merging into one
  // `auth/oauth_state.json` (§3.1 marks the merge optional): three modules
  // read-modify-write these independently, and a shared file would turn that
  // into a clobber race for no gain on transient 10-minute data.
  ['oauth_state.json', 'auth/oauth_state_mal.json'],
  ['simkl_oauth_state.json', 'auth/oauth_state_simkl.json'],
  ['anilist_oauth_state.json', 'auth/oauth_state_anilist.json'],

  ['mal_season_checkpoint.json', 'sync/mal_seasons.json'],
  ['simkl_sync_checkpoint.json', 'sync/simkl_checkpoint.json'],
  ['anilist_personal_config.json', 'sync/anilist_import.json'],

  ['recommendations.json', 'cache/recommendations.json'],

  // App data despite the name — the progress feed the Connections panel and the
  // onboarding poll (docs/DATA-LAYOUT.md §3.2). An install with LOGS_PATH set
  // outside the data folder keeps its copy there, out of this script's reach;
  // connectionLog.ts still reads that location once as a fallback.
  ['connection_log.json', 'logs/connection_log.json'],
];

// ── files nothing reads (docs/DATA-LAYOUT.md §4) ──
const ORPHANS = [
  ['ratings.json', 'saved-ratings feature, removed in d40c3d4'],
  ['rating_criteria.json', 'same removal'],
  ['animes_extensions.json', 'documented orphan — read by nothing'],
  ['user_preferences.json', "superseded by settings.json's preferences block"],
  ['animes_simkl.json.bak', 'stale canonical-id-migration backup'],
  ['animes_simkl.json.bak-premigrate', 'stale canonical-id-migration backup'],
];

// Files that legitimately sit at the root and are neither moved nor swept.
const ROOT_KEEP = new Set(['settings.json']);

const abs = name => path.join(DATA_PATH, name);

console.log(`Migrating store layout in: ${DATA_PATH}${DRY_RUN ? '  (dry run)' : ''}`);

// ── classify every mapped file; nothing is written in this pass ──
const pending = [];   // { from, to }
const done = [];      // already at the new path
const absent = [];    // present at neither path
const conflicts = []; // present at BOTH paths

for (const [from, to] of MOVES) {
  const oldExists = fs.existsSync(abs(from));
  const newExists = fs.existsSync(abs(to));
  if (oldExists && newExists) conflicts.push({ from, to });
  else if (oldExists) pending.push({ from, to });
  else if (newExists) done.push({ from, to });
  else absent.push({ from, to });
}

// ── unknown files at the data root ──
const expected = new Set([
  ...ROOT_KEEP,
  ...MOVES.map(([from]) => from),
  ...MOVES.map(([, to]) => to).filter(to => !to.includes('/')),
  ...ORPHANS.map(([name]) => name),
]);
const roleDirs = new Set(
  MOVES.filter(([, to]) => to.includes('/')).map(([, to]) => to.split('/')[0])
);
const unknown = fs
  .readdirSync(DATA_PATH, { withFileTypes: true })
  .filter(e => (e.isDirectory() ? !roleDirs.has(e.name) : !expected.has(e.name)))
  .map(e => (e.isDirectory() ? `${e.name}/` : e.name));

// ── report the plan ──
console.log(`\nTo move: ${pending.length}`);
for (const { from, to } of pending) console.log(`  ${from.padEnd(32)} → ${to}`);
if (done.length > 0) {
  console.log(`\nAlready migrated: ${done.length}`);
  for (const { to } of done) console.log(`  ${to}`);
}
if (absent.length > 0) {
  console.log(`\nAbsent on this install (skipped): ${absent.map(a => a.from).join(', ')}`);
}
if (unknown.length > 0) {
  console.log(`\nUnknown entries — left untouched, please review: ${unknown.join(', ')}`);
}

if (conflicts.length > 0) {
  console.error(
    `\nREFUSING: ${conflicts.length} file(s) exist at BOTH the old and the new path. ` +
      `That means an interrupted run, or the app wrote to the old path after a partial ` +
      `migration. Decide which copy is real (the new one is normally the migrated data), ` +
      `remove the other, and re-run. Nothing has been written.`
  );
  for (const { from, to } of conflicts) console.error(`  ${from}  AND  ${to}`);
  process.exit(1);
}

// ── the orphan sweep ──
const orphansPresent = ORPHANS.filter(([name]) => fs.existsSync(abs(name)));
if (orphansPresent.length > 0) {
  if (SWEEP_ORPHANS) {
    console.log(`\nOrphan sweep — will DELETE ${orphansPresent.length} file(s):`);
  } else {
    console.log(`\n${orphansPresent.length} orphan(s) present (pass --sweep-orphans to delete):`);
  }
  for (const [name, why] of orphansPresent) {
    const kb = Math.round(fs.statSync(abs(name)).size / 1024);
    console.log(`  ${name.padEnd(32)} ${String(kb).padStart(7)} KB   ${why}`);
  }
}

if (DRY_RUN) {
  console.log('\nDry run — nothing written, nothing deleted.');
  process.exit(0);
}

// ── move: write new → verify → unlink old ──
let moved = 0;
for (const { from, to } of pending) {
  const src = abs(from);
  const dest = abs(to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  const content = fs.readFileSync(src);
  fs.writeFileSync(dest, content);

  // Verify before removing the only other copy: byte-identical AND still parses.
  const readBack = fs.readFileSync(dest);
  if (!readBack.equals(content)) {
    console.error(`\nVerification failed: ${to} is not byte-identical to ${from}. ${from} left in place.`);
    process.exit(1);
  }
  try {
    JSON.parse(readBack.toString('utf-8'));
  } catch (e) {
    console.error(`\nVerification failed: ${to} does not parse as JSON (${e.message}). ${from} left in place.`);
    process.exit(1);
  }

  fs.unlinkSync(src);
  moved += 1;
  console.log(`  moved ${from} → ${to}`);
}

// ── sweep ──
let swept = 0;
if (SWEEP_ORPHANS) {
  for (const [name] of orphansPresent) {
    fs.unlinkSync(abs(name));
    swept += 1;
    console.log(`  deleted ${name}`);
  }
}

console.log(
  `\nMigration complete. ${moved} file(s) moved` +
    (SWEEP_ORPHANS ? `, ${swept} orphan(s) deleted` : '') +
    `. Deploy the new image and start the app.`
);
