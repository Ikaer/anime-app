import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import os from 'os';
import { monitorEventLoopDelay, PerformanceObserver, constants as perfConstants } from 'perf_hooks';
import { resolveLogsPath } from '@/lib/store/bootstrap';

/**
 * Where a slow request's time went — the store's performance ledger.
 *
 * Written to diagnose "the boxes pages are fine for five minutes, then one load
 * takes ~10s". Every candidate cause leaves a different trace, and the point of
 * this module is that one log line tells them apart:
 *
 *  - **a cold row rebuild** — `rows: 'rebuild'`, with `changed` naming the slice
 *    whose mtime moved (and a `parse` line saying who got re-read);
 *  - **a sleeping data disk** — rows hit, parse zero, but `statMs` in the
 *    seconds: every read `stat`s its file even when the parse cache is warm;
 *  - **a blocked event loop** — handler fast, `lagMaxMs` large, and a `stall`
 *    line at the moment it happened;
 *  - **GC pressure** — `gc` lines and `gcMs` on the request;
 *  - **a restart** — a new `boot` line, `up` back near zero;
 *  - **nothing server-side at all** — the client's `client` line reports a slow
 *    load while the server's `req` line for it is fast (browser queueing,
 *    network, render).
 *
 * Output is JSON lines in `LOGS_PATH/perf.log` (the folder has had no writer
 * since the connection log moved into the store), mirrored to the console so
 * `docker logs` shows it too. Appends are ASYNC and never on a request's path:
 * the log sits on the same volume as the data, and if that disk is asleep a
 * synchronous append would add the very spin-up it is trying to measure.
 *
 * Accounting (the counters) always runs — it is a few `performance.now()` calls
 * per read. The file, the watchers and the console only switch on inside the Next
 * server (`NEXT_RUNTIME`), so a `node scripts/*.js` run that imports the store
 * neither writes lines nor installs observers.
 *
 * Per module instance: in a production build the API routes share one instance
 * and the SSR pages another (measured), so each keeps its own counters and tags
 * its lines with `inst`. The process-wide watchers install once, on `globalThis`.
 */

const ENABLED = process.env.NEXT_RUNTIME === 'nodejs' && process.env.PERF_LOG !== '0';

/** Distinguishes this module instance (API bundle vs page bundle) in the log. */
const INST = Math.random().toString(36).slice(2, 6);

const LOG_FILE = path.join(resolveLogsPath(), 'perf.log');
/** Rotated to `perf.log.1` past this size — a few weeks of lines, at the rates seen. */
const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** A single `stat` slower than this is logged on its own — the sleeping-disk signature. */
const SLOW_STAT_MS = 200;
/** A parse is logged when the file is at least this big, or took at least `PARSE_LOG_MS`. */
const PARSE_LOG_BYTES = 1_000_000;
const PARSE_LOG_MS = 50;
/** GC pauses at least this long are logged individually. */
const SLOW_GC_MS = 100;
/** A watchdog tick arriving this late means the event loop was blocked. */
const STALL_MS = 1000;
const WATCHDOG_TICK_MS = 500;

const round = (ms: number) => Math.round(ms * 10) / 10;
const mb = (bytes: number) => Math.round(bytes / 1e6);

// ── The log file ─────────────────────────────────────────────────────────────

let chain: Promise<void> = Promise.resolve();
let loggedBytes = -1;

async function append(line: string): Promise<void> {
  if (loggedBytes < 0) {
    try { loggedBytes = (await fs.promises.stat(LOG_FILE)).size; } catch { loggedBytes = 0; }
  }
  if (loggedBytes > MAX_LOG_BYTES) {
    try { await fs.promises.rename(LOG_FILE, `${LOG_FILE}.1`); } catch { /* best effort */ }
    loggedBytes = 0;
  }
  await fs.promises.appendFile(LOG_FILE, line, 'utf-8');
  loggedBytes += Buffer.byteLength(line);
}

/** One event → one JSON line. Never throws, never blocks. */
export function perfLog(event: string, fields: Record<string, unknown> = {}): void {
  if (!ENABLED) return;
  installWatchers();
  const line = JSON.stringify({
    t: new Date().toISOString(),
    ev: event,
    pid: process.pid,
    inst: INST,
    up: Math.round(process.uptime()),
    ...fields,
  });
  console.log(`[perf] ${line}`);
  chain = chain.then(() => append(line + '\n')).catch(() => { /* a log must never take a request down */ });
}

// ── Process-wide watchers (boot, GC, event-loop stalls) ──────────────────────

interface ProcessPerf {
  gcCount: number;
  gcTotalMs: number;
  gcMaxMs: number;
}

const GLOBAL_KEY = Symbol.for('anime-app.perf');
type GlobalWithPerf = typeof globalThis & { [GLOBAL_KEY]?: ProcessPerf };

function processPerf(): ProcessPerf | undefined {
  return (globalThis as GlobalWithPerf)[GLOBAL_KEY];
}

/**
 * Installed on the first event rather than at import, for `jsonStore`'s reason:
 * `next build` evaluates modules while collecting page data, and a boot line or
 * an interval started there would describe the build, not the server.
 */
function installWatchers(): void {
  const g = globalThis as GlobalWithPerf;
  if (g[GLOBAL_KEY]) return;
  const state: ProcessPerf = { gcCount: 0, gcTotalMs: 0, gcMaxMs: 0 };
  g[GLOBAL_KEY] = state;

  perfLog('boot', {
    node: process.version,
    heapLimitMB: mb(v8.getHeapStatistics().heap_size_limit),
    totalMemMB: mb(os.totalmem()),
    freeMemMB: mb(os.freemem()),
    cpus: os.cpus().length,
    logFile: LOG_FILE,
  });

  try {
    const kinds: Record<number, string> = {
      [perfConstants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
      [perfConstants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
      [perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
      [perfConstants.NODE_PERFORMANCE_GC_WEAKCB]: 'weakcb',
    };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        state.gcCount++;
        state.gcTotalMs += entry.duration;
        state.gcMaxMs = Math.max(state.gcMaxMs, entry.duration);
        if (entry.duration >= SLOW_GC_MS) {
          const kind = (entry as unknown as { detail?: { kind?: number } }).detail?.kind;
          perfLog('gc', { ms: round(entry.duration), kind: kind !== undefined ? kinds[kind] ?? kind : undefined, heapMB: mb(process.memoryUsage().heapUsed) });
        }
      }
    }).observe({ entryTypes: ['gc'] });
  } catch { /* gc entries unsupported — the request lines still carry heap */ }

  let last = performance.now();
  const watchdog = setInterval(() => {
    const now = performance.now();
    const late = now - last - WATCHDOG_TICK_MS;
    last = now;
    if (late >= STALL_MS) perfLog('stall', { ms: Math.round(late), heapMB: mb(process.memoryUsage().heapUsed) });
  }, WATCHDOG_TICK_MS);
  watchdog.unref();
}

// ── Store read accounting (fed by jsonStore) ─────────────────────────────────

interface StoreCounters {
  statMs: number;
  readMs: number;
  parseMs: number;
  stats: number;
  parses: number;
  /** The slowest single stat since the counters were read — which file the disk stalled on. */
  slowestStat: { file: string; ms: number } | null;
}

const counters: StoreCounters = { statMs: 0, readMs: 0, parseMs: 0, stats: 0, parses: 0, slowestStat: null };

/** `jsonStore.readJsonFile`'s report: a stat always, a read + parse on a cache miss. */
export function recordStoreRead(file: string, statMs: number, parsed?: { bytes: number; readMs: number; parseMs: number }): void {
  counters.stats++;
  counters.statMs += statMs;
  if (!counters.slowestStat || statMs > counters.slowestStat.ms) counters.slowestStat = { file, ms: round(statMs) };
  if (statMs >= SLOW_STAT_MS) perfLog('stat-slow', { file, ms: round(statMs) });
  if (parsed) {
    counters.parses++;
    counters.readMs += parsed.readMs;
    counters.parseMs += parsed.parseMs;
    // Small files are re-read after every write (`user/boxes.json` on each
    // filing click), so only the ones that can cost anything get a line.
    if (parsed.bytes >= PARSE_LOG_BYTES || parsed.readMs + parsed.parseMs >= PARSE_LOG_MS) perfLog('parse', { file, MB: Math.round(parsed.bytes / 1e5) / 10, readMs: round(parsed.readMs), parseMs: round(parsed.parseMs) });
  }
}

type CounterSnapshot = Pick<StoreCounters, 'statMs' | 'readMs' | 'parseMs' | 'stats' | 'parses'>;

function snapshot(): CounterSnapshot {
  return { statMs: counters.statMs, readMs: counters.readMs, parseMs: counters.parseMs, stats: counters.stats, parses: counters.parses };
}

function since(before: CounterSnapshot) {
  return {
    statMs: round(counters.statMs - before.statMs),
    readMs: round(counters.readMs - before.readMs),
    parseMs: round(counters.parseMs - before.parseMs),
    stats: counters.stats - before.stats,
    parses: counters.parses - before.parses,
  };
}

// ── Row-cache accounting (fed by record.ts) ──────────────────────────────────

export interface RowsCall {
  seq: number;
  hit: boolean;
  totalMs: number;
  statMs: number;
  readMs: number;
  parseMs: number;
  assembleMs: number;
  /** Which cache inputs moved — the WHY of a rebuild. `['cold']` on this instance's first build. */
  changed?: string[];
  rows: number;
}

let rowsSeq = 0;
let lastRows: RowsCall | null = null;
let lastRebuild: RowsCall | null = null;

/** Opens a `getAnimeForDisplay` measurement; the returned closer records it. */
export function beginRowsCall() {
  const t0 = performance.now();
  const before = snapshot();
  return (hit: boolean, rows: number, assembleMs = 0, changed?: string[]): void => {
    const d = since(before);
    const call: RowsCall = {
      seq: ++rowsSeq,
      hit,
      totalMs: round(performance.now() - t0),
      statMs: d.statMs,
      readMs: d.readMs,
      parseMs: d.parseMs,
      assembleMs: round(assembleMs),
      ...(changed ? { changed } : {}),
      rows,
    };
    lastRows = call;
    if (!hit) {
      lastRebuild = call;
      perfLog('rebuild', { ...call });
    }
  };
}

// ── Per-request timing (the two box routes) ──────────────────────────────────

let loopDelay: ReturnType<typeof monitorEventLoopDelay> | null = null;

/**
 * Start timing one request. Call `finish(res)` BEFORE sending the body — it sets
 * the `Server-Timing` header (visible in the browser's network panel, and read
 * back by the client probe) and writes the `req` line.
 *
 * `lagMaxMs` is the worst event-loop delay since this instance's previous
 * request line: a request that arrived while the loop was blocked starts late,
 * so its handler time alone would look innocent.
 */
export function beginRequest(route: string) {
  if (ENABLED && !loopDelay) {
    loopDelay = monitorEventLoopDelay({ resolution: 20 });
    loopDelay.enable();
  }
  const t0 = performance.now();
  const before = snapshot();
  const seqBefore = rowsSeq;
  counters.slowestStat = null;
  const gcBefore = processPerf() ? { ...processPerf()! } : null;

  return {
    finish(res: { setHeader(name: string, value: string): unknown }, extra: Record<string, unknown> = {}): void {
      const totalMs = round(performance.now() - t0);
      const d = since(before);
      const rows = lastRows && lastRows.seq > seqBefore ? lastRows : null;
      const assembleMs = rows?.assembleMs ?? 0;

      res.setHeader('Server-Timing', [
        `stat;dur=${d.statMs}`,
        `read;dur=${d.readMs}`,
        `parse;dur=${d.parseMs}`,
        `assemble;dur=${assembleMs}`,
        `rows;desc="${rows ? (rows.hit ? 'hit' : 'rebuild') : 'none'}"`,
        `total;dur=${totalMs}`,
      ].join(', '));

      if (!ENABLED) return;
      const lagMaxMs = loopDelay ? Math.round(loopDelay.max / 1e6) : undefined;
      loopDelay?.reset();
      const gcNow = processPerf();
      const mem = process.memoryUsage();
      perfLog('req', {
        route,
        ms: totalMs,
        rows: rows ? (rows.hit ? 'hit' : 'rebuild') : 'none',
        ...(rows && !rows.hit ? { changed: rows.changed } : {}),
        statMs: d.statMs,
        stats: d.stats,
        ...(counters.slowestStat && counters.slowestStat.ms >= 20 ? { slowestStat: counters.slowestStat } : {}),
        readMs: d.readMs,
        parseMs: d.parseMs,
        assembleMs,
        lagMaxMs,
        ...(gcNow && gcBefore ? { gcMs: round(gcNow.gcTotalMs - gcBefore.gcTotalMs) } : {}),
        heapMB: mb(mem.heapUsed),
        rssMB: mb(mem.rss),
        ...extra,
      });
    },
  };
}

/** What `GET /api/anime/perf` returns — enough to answer "did it restart, and what did the last rebuild cost". */
export function perfSnapshot() {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    inst: INST,
    uptimeSec: Math.round(process.uptime()),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    heapMB: mb(mem.heapUsed),
    rssMB: mb(mem.rss),
    heapLimitMB: mb(v8.getHeapStatistics().heap_size_limit),
    totalMemMB: mb(os.totalmem()),
    freeMemMB: mb(os.freemem()),
    gc: processPerf() ?? null,
    lastRows,
    lastRebuild,
    logFile: ENABLED ? LOG_FILE : null,
  };
}
