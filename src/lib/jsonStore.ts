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

/** Reads a JSON file, falling back to `defaultValue` when missing or unparseable. */
export function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    throw error;
  }
}
