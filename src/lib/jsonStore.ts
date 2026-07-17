import fs from 'fs';
import path from 'path';
import { resolveDataPath } from '@/lib/bootstrap';

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

/** Absolute path of a data file, e.g. `dataFile('animes_mal.json')`. */
export function dataFile(name: string): string {
  return path.join(DATA_PATH, name);
}

export function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true, mode: 0o755 });
  }
}

// ── Parse cache ──────────────────────────────────────────────────────────────
//
// Parsing the big slice files (animes_mal.json ≈ 40MB, animes_anilist_meta.json
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
  try {
    ensureDataDirectory();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    // Evict rather than store `data`: callers may keep mutating the object they
    // just wrote; the next read re-parses what's actually on disk.
    parseCache.delete(filePath);
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    throw error;
  }
}
