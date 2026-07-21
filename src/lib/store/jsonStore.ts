import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/store/bootstrap';

/**
 * The JSON-file store that stands in for a database. Every persisted file lives
 * under `DATA_PATH` and is read/written through the helpers below, so the
 * "does the directory exist / is the file missing / is it corrupt" handling
 * lives in exactly one place.
 *
 * `DATA_PATH` comes from the Tier-0 bootstrap resolver (env → OS-config file →
 * out-of-checkout default), resolved once here at import time — so changing the
 * data folder at runtime requires a restart. See bootstrap.ts / docs/SETUP-AND-CONFIG.md.
 *
 * Server-only: this module uses `fs` and must never reach the client bundle.
 */
export const DATA_PATH = resolveDataPath();

/**
 * Absolute path of a data file, e.g. `dataFile('catalog/mal.json')`. Names are
 * role-folder-relative since the layout migration (docs/DATA-LAYOUT.md);
 * `path.join` handles the separator on both platforms.
 */
export function dataFile(name: string): string {
  return path.join(DATA_PATH, name);
}

/**
 * Creates the directory a data file lives in — the file's OWN parent, not just
 * `DATA_PATH`, because the layout nests one folder deep (`catalog/`, `personal/`,
 * …) and the first write to a fresh install would otherwise `ENOENT`.
 */
export function ensureDataDirectory(filePath?: string): void {
  const dir = filePath ? path.dirname(filePath) : DATA_PATH;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

/**
 * Refuse to run on a pre-layout store (docs/DATA-LAYOUT.md §5.2). The migration
 * script and the deploy are ordered but not interlocked, so a store that still
 * has flat `animes_*.json` and no `catalog/` means step 3 was skipped or died
 * half-way. Falling through would render first-run onboarding on top of a full
 * store — indistinguishable, at a glance, from data loss. So: throw, and name
 * what was found.
 *
 * A genuinely empty store has neither, and passes.
 *
 * Lazy, on the first read/write rather than at import — same reasoning as the H1
 * guard in store.ts: there is no central process-boot hook, and a check at import
 * time would run during `next build`'s page-data collection, failing the BUILD on
 * a dev machine whose own store happens to be pre-layout. The check is a single
 * `readdir` and runs once per process.
 */
// Latched only once the check PASSES — never before the throw. A one-shot flag
// set upfront would make just the first read of each bundle fail and every later
// one succeed, which is worse than not checking: the page would fall through to
// first-run onboarding on a full store, the exact outcome this guards against.
let layoutChecked = false;

function assertMigratedLayout(): void {
  if (layoutChecked) return;
  let flat: string[];
  try {
    flat = fs.readdirSync(DATA_PATH).filter(n => n.startsWith('animes_') && n.endsWith('.json'));
  } catch {
    layoutChecked = true; // no data folder yet — a fresh install, nothing to migrate
    return;
  }
  if (flat.length === 0 || fs.existsSync(path.join(DATA_PATH, 'catalog'))) {
    layoutChecked = true;
    return;
  }
  throw new Error(
    `Pre-layout data store detected at ${DATA_PATH}: found ${flat.length} flat ` +
      `file(s) (${flat.slice(0, 3).join(', ')}${flat.length > 3 ? ', …' : ''}) and no catalog/ folder.\n` +
      `This build reads the folder layout of docs/DATA-LAYOUT.md. Stop the app, back up the ` +
      `data folder, then run:\n` +
      `  node scripts/migrate-layout.js "${DATA_PATH}" --dry-run\n` +
      `  node scripts/migrate-layout.js "${DATA_PATH}" --sweep-orphans`
  );
}

// ── Parse cache ──────────────────────────────────────────────────────────────
//
// Parsing the big slice files (catalog/mal.json ≈ 40MB, catalog/anilist.json
// ≈ 26MB) dominates every cold read path, so parsed values are cached per file,
// keyed on `mtimeMs + size`. A stat call per read keeps the cache honest across
// bundles: in a production Next build the api and page bundles each hold their
// own module instance, but a write from either one bumps the file's mtime, so
// the other bundle's next read re-parses. (Same-bundle writes also delete the
// entry directly in `writeJsonFile`, which covers the theoretical case of two
// same-size writes landing within one mtime tick — from the writing bundle's
// own perspective.)
//
// SHARED-REFERENCE CONTRACT: every caller of `readJsonFile` may now receive the
// same parsed object as other callers. Mutate-then-write is safe (the write
// evicts the entry); mutating a read result WITHOUT writing it back would leak
// the mutation into every later read, so don't.
//
// `mtimeMs: -1` marks a missing file; the entry then pins the first caller's
// `defaultValue` so repeat reads of an absent file return a stable reference
// (callers compare slice identities to decide cache validity — see store.ts).
interface ParseCacheEntry {
  mtimeMs: number;
  size: number;
  value: unknown;
}
const parseCache = new Map<string, ParseCacheEntry>();

/** Reads a JSON file, falling back to `defaultValue` when missing or unparseable. */
export function readJsonFile<T>(filePath: string, defaultValue: T): T {
  assertMigratedLayout();
  try {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      // Missing file — pin (and reuse) a stable default reference.
      const cached = parseCache.get(filePath);
      if (cached && cached.mtimeMs === -1) return cached.value as T;
      parseCache.set(filePath, { mtimeMs: -1, size: -1, value: defaultValue });
      return defaultValue;
    }
    const cached = parseCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.value as T;
    }
    const value = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    parseCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
    return value;
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return defaultValue;
  }
}

/** Writes a JSON file, creating the data directory if needed. Throws on failure. */
export function writeJsonFile<T>(filePath: string, data: T): void {
  assertMigratedLayout();
  try {
    ensureDataDirectory(filePath);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    // Evict rather than store `data`: callers may keep mutating the object they
    // just wrote; the next read re-parses what's actually on disk.
    parseCache.delete(filePath);
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    throw error;
  }
}
