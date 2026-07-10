import fs from 'fs';
import path from 'path';

const LOGS_PATH = process.env.LOGS_PATH || process.env.DATA_PATH || '/app/data';
const LOG_FILE = path.join(LOGS_PATH, 'connection_log.json');
const MAX_ENTRIES = 500;
const DEFAULT_PAGE_SIZE = 200;

export type LogSource =
  | 'mal-auth'
  | 'simkl-auth'
  | 'sync'
  | 'big-sync'
  | 'historical-crawl'
  | 'simkl-sync'
  | 'cron-sync'
  | 'anilist-tags-sync'
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

function ensureLogsDirectory(): void {
  if (!fs.existsSync(LOGS_PATH)) {
    fs.mkdirSync(LOGS_PATH, { recursive: true, mode: 0o755 });
  }
}

function readStore(): LogStore {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return { counter: 0, entries: [] };
    }
    const content = fs.readFileSync(LOG_FILE, 'utf-8');
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
  ensureLogsDirectory();
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
