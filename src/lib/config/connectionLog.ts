import fs from 'fs';
import path from 'path';
import { resolveLogsPath } from '@/lib/store/bootstrap';
import { dataFile, ensureDataDirectory } from '@/lib/store/jsonStore';

/**
 * The connection log is **app data, not diagnostics**:
 * it is the progress feed the Connections panel and the first-run onboarding
 * poll — there is no SSE for meta-sync, the cast sweep or the catalog crawl, so
 * this log *is* the transport. It therefore lives at a fixed path under
 * `DATA_PATH`, not under `LOGS_PATH`, which stays reserved for real diagnostics.
 */
const LOG_FILE = dataFile('logs/connection_log.json');

/**
 * The pre-layout location, under `LOGS_PATH` (which itself falls back to the
 * data root, so older installs resolve through the same expression). Read once
 * when the current location is still empty, so an install that set `LOGS_PATH`
 * outside the data folder — beyond the migration script's reach — does not blank
 * its panel on deploy. The next `appendLog` rewrites to `LOG_FILE`.
 */
const LEGACY_LOG_FILE = path.join(resolveLogsPath(), 'connection_log.json');

const MAX_ENTRIES = 500;
const DEFAULT_PAGE_SIZE = 200;

/**
 * Log channels, one per sync/auth flow. Source-specific channels carry their
 * source's prefix; `cron-sync` and `refresh` have none because they genuinely
 * span every source.
 */
export type LogSource =
  | 'mal-auth'
  | 'mal-sync'
  | 'mal-big-sync'
  | 'mal-historical-crawl'
  | 'simkl-auth'
  | 'simkl-sync'
  | 'anilist-auth'
  | 'anilist-meta-sync'
  | 'anilist-catalog-crawl'
  | 'anilist-cast'
  | 'anilist-cast-sweep'
  | 'anilist-personal-import'
  | 'anilist-personal-push'
  | 'anilist-rating'
  | 'cron-sync'
  | 'refresh';

export type LogLevel = 'info' | 'success' | 'error';

export interface LogEntry {
  id: number;
  timestamp: number;
  source: LogSource;
  level: LogLevel;
  message: string;
  detail?: Record<string, unknown>;
}

interface LogStore {
  counter: number;
  entries: LogEntry[];
}

function readStore(): LogStore {
  try {
    const file = fs.existsSync(LOG_FILE) ? LOG_FILE : LEGACY_LOG_FILE;
    if (!fs.existsSync(file)) {
      return { counter: 0, entries: [] };
    }
    const content = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(content);
    return {
      counter: typeof parsed.counter === 'number' ? parsed.counter : 0,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch (error) {
    console.error('Error reading connection log:', error);
    return { counter: 0, entries: [] };
  }
}

function writeStore(store: LogStore): void {
  ensureDataDirectory(LOG_FILE);
  fs.writeFileSync(LOG_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/** Best-effort append: never throws, so it can never break a sync/auth flow. */
export function appendLog(
  source: LogSource,
  level: LogLevel,
  message: string,
  detail?: Record<string, unknown>
): void {
  try {
    const store = readStore();
    const id = store.counter + 1;
    store.counter = id;
    store.entries.push({ id, timestamp: Date.now(), source, level, message, detail });
    if (store.entries.length > MAX_ENTRIES) {
      store.entries = store.entries.slice(-MAX_ENTRIES);
    }
    writeStore(store);
  } catch (error) {
    console.error('Error appending to connection log:', error);
  }
}

/** Entries with id > afterId, or the most recent page if afterId is omitted/invalid. */
export function getLogEntries(afterId?: number): LogEntry[] {
  const store = readStore();
  if (typeof afterId === 'number' && Number.isFinite(afterId) && afterId >= 0) {
    return store.entries.filter(e => e.id > afterId);
  }
  return store.entries.slice(-DEFAULT_PAGE_SIZE);
}
