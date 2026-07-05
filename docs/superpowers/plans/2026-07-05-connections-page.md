# Connections & Sync Log Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/connections` page that consolidates MAL/SIMKL account and sync controls plus a persistent, polling-based log window showing every connection/sync event (including invisible cron-sync runs), without removing the existing controls from the main `/` page sidebar.

**Architecture:** A new server-only `connectionLog.ts` module persists a capped, monotonically-IDed JSON log to `DATA_PATH/connection_log.json`. Every auth/sync code path gets an additive `appendLog(...)` call (no logic changes). A read-only `GET /api/anime/connection-log?afterId=<n>` endpoint serves entries to a polling React component, `ConnectionLogPanel`. All MAL/SIMKL auth + sync state and handlers currently local to `index.tsx` are extracted into a shared `useConnections()` hook, consumed by both `index.tsx` (unchanged UI/behavior) and the new `connections.tsx` page.

**Tech Stack:** Next.js 14 Pages Router, TypeScript, React hooks, CSS Modules (`typed-css-modules`), Node `fs`/`path` for JSON storage under `DATA_PATH`.

## Global Constraints

- No test suite exists in this project (per `CLAUDE.md`) — every task's "verify" step is a manual check against the running dev server (`npm run dev`), not an automated test.
- Run `npm run css:types` after creating/editing any `.module.css` file.
- `appendLog` calls must never throw or block the operation they instrument — the module itself is try/catch wrapped internally, so call sites just call it plainly.
- Client components must never import `@/lib/anime` or `@/lib/connectionLog` at runtime (both use Node `fs`) — only `import type` if a type is needed.
- Existing sidebar sections (`AccountSection`, `DataSyncSection`, `SimklSection`) keep identical props/behavior; only their state *source* changes when `index.tsx` is refactored (Task 13).
- Storage location: `DATA_PATH` (not `LOGS_PATH`, which is unused elsewhere in the codebase).

---

### Task 1: Connection log storage module + read API

**Files:**
- Create: `src/lib/connectionLog.ts`
- Create: `src/pages/api/anime/connection-log.ts`

**Interfaces:**
- Produces: `appendLog(source: LogSource, level: LogLevel, message: string, detail?: Record<string, unknown>): void` and `getLogEntries(afterId?: number): LogEntry[]`, both exported from `@/lib/connectionLog`. `LogSource = 'mal-auth' | 'simkl-auth' | 'sync' | 'big-sync' | 'historical-crawl' | 'simkl-sync' | 'cron-sync'`. `LogLevel = 'info' | 'success' | 'error'`. `LogEntry = { id: number; timestamp: number; source: LogSource; level: LogLevel; message: string; detail?: Record<string, unknown> }`. Every later task (2–8) calls `appendLog`; the panel (Task 9) calls the API endpoint this task creates.

- [ ] **Step 1: Create `src/lib/connectionLog.ts`**

```ts
import fs from 'fs';
import path from 'path';

const DATA_PATH = process.env.DATA_PATH || '/app/data';
const LOG_FILE = path.join(DATA_PATH, 'connection_log.json');
const MAX_ENTRIES = 500;
const DEFAULT_PAGE_SIZE = 200;

export type LogSource =
  | 'mal-auth'
  | 'simkl-auth'
  | 'sync'
  | 'big-sync'
  | 'historical-crawl'
  | 'simkl-sync'
  | 'cron-sync';

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

function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true, mode: 0o755 });
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
  ensureDataDirectory();
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
```

- [ ] **Step 2: Create `src/pages/api/anime/connection-log.ts`**

```ts
import { NextApiRequest, NextApiResponse } from 'next';
import { getLogEntries } from '@/lib/connectionLog';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const afterIdParam = req.query.afterId;
    const afterId =
      typeof afterIdParam === 'string' && afterIdParam !== '' ? parseInt(afterIdParam, 10) : undefined;
    const entries = getLogEntries(afterId);
    res.status(200).json({ entries });
  } catch (error) {
    console.error('Error reading connection log:', error);
    res.status(500).json({ error: 'Failed to read connection log' });
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run dev`, then in another terminal:
```bash
curl http://localhost:3000/api/anime/connection-log
```
Expected: `{"entries":[]}` (no writes have happened yet). Confirm `DATA_PATH` did not previously contain `connection_log.json` — no file is created on a read-only GET, since `getLogEntries` never calls `writeStore`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/connectionLog.ts src/pages/api/anime/connection-log.ts
git commit -m "Add connection/sync log storage module and read API"
```

---

### Task 2: Instrument MAL auth (`auth.ts`)

**Files:**
- Modify: `src/pages/api/anime/auth.ts`

**Interfaces:**
- Consumes: `appendLog` from `@/lib/connectionLog` (Task 1).

- [ ] **Step 1: Import `appendLog`**

In `src/pages/api/anime/auth.ts`, add to the top imports:

```ts
import { appendLog } from '@/lib/connectionLog';
```

- [ ] **Step 2: Log login initiation**

In `initiateOAuthFlow`, after the existing `console.log('Generated auth URL:', authUrl.toString());` line (line 204) and before `res.json({ authUrl: authUrl.toString() });`:

```ts
  appendLog('mal-auth', 'info', 'MAL login initiated');

  res.json({ authUrl: authUrl.toString() });
```

- [ ] **Step 3: Log OAuth callback outcomes**

In `handleOAuthCallback`, replace the early-return invalid-state block:

```ts
  const codeVerifier = getCodeVerifier(state);
  if (!codeVerifier) {
    console.error('Invalid or expired state parameter:', state);
    res.status(400).json({ error: 'Invalid or expired state parameter' });
    return;
  }
```

with:

```ts
  const codeVerifier = getCodeVerifier(state);
  if (!codeVerifier) {
    console.error('Invalid or expired state parameter:', state);
    appendLog('mal-auth', 'error', 'MAL OAuth callback failed: invalid or expired state');
    res.status(400).json({ error: 'Invalid or expired state parameter' });
    return;
  }
```

Then replace the success path:

```ts
    // Save auth data
    saveMALAuthData(userData, tokenData);

    // Redirect to anime page
    res.redirect('/?auth=success');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/?auth=error');
  }
```

with:

```ts
    // Save auth data
    saveMALAuthData(userData, tokenData);

    appendLog('mal-auth', 'success', `MAL OAuth callback succeeded for user ${userData.name}`, {
      user: userData.name,
    });

    // Redirect to anime page
    res.redirect('/?auth=success');
  } catch (error) {
    console.error('OAuth callback error:', error);
    appendLog('mal-auth', 'error', 'MAL OAuth callback failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.redirect('/?auth=error');
  }
```

- [ ] **Step 4: Log logout**

Replace:

```ts
async function logout(req: NextApiRequest, res: NextApiResponse) {
  clearMALAuthData();
  res.json({ success: true });
}
```

with:

```ts
async function logout(req: NextApiRequest, res: NextApiResponse) {
  clearMALAuthData();
  appendLog('mal-auth', 'info', 'MAL account disconnected');
  res.json({ success: true });
}
```

- [ ] **Step 5: Verify**

Run: `npm run dev`. In the browser, connect to MAL (or disconnect if already connected), completing the OAuth round trip. Then:
```bash
curl "http://localhost:3000/api/anime/connection-log?afterId=0"
```
Expected: entries array containing at least a `mal-auth` `info` "MAL login initiated" entry and either a `success` OAuth-callback entry or an `info` "MAL account disconnected" entry, matching whichever action you performed.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/anime/auth.ts
git commit -m "Log MAL auth events to connection log"
```

---

### Task 3: Instrument SIMKL auth (`simkl/auth.ts`)

**Files:**
- Modify: `src/pages/api/anime/simkl/auth.ts`

**Interfaces:**
- Consumes: `appendLog` from `@/lib/connectionLog` (Task 1).

- [ ] **Step 1: Import `appendLog`**

Add to the top imports of `src/pages/api/anime/simkl/auth.ts`:

```ts
import { appendLog } from '@/lib/connectionLog';
```

- [ ] **Step 2: Log login initiation**

In `initiateOAuthFlow`, before the final `res.json({ authUrl: authUrl.toString() });`:

```ts
  appendLog('simkl-auth', 'info', 'SIMKL login initiated');

  res.json({ authUrl: authUrl.toString() });
```

- [ ] **Step 3: Log OAuth callback outcomes**

Replace the invalid-state early return:

```ts
async function handleOAuthCallback(res: NextApiResponse, code: string, state: string) {
  if (!consumeOAuthState(state)) {
    res.status(400).json({ error: 'Invalid or expired state parameter' });
    return;
  }
```

with:

```ts
async function handleOAuthCallback(res: NextApiResponse, code: string, state: string) {
  if (!consumeOAuthState(state)) {
    appendLog('simkl-auth', 'error', 'SIMKL OAuth callback failed: invalid or expired state');
    res.status(400).json({ error: 'Invalid or expired state parameter' });
    return;
  }
```

Replace the success/error tail:

```ts
    saveSimklAuthData(userData, tokenData);

    res.redirect('/?simkl_auth=success');
  } catch (error) {
    console.error('Simkl OAuth callback error:', error);
    res.redirect('/?simkl_auth=error');
  }
```

with:

```ts
    saveSimklAuthData(userData, tokenData);

    appendLog('simkl-auth', 'success', `SIMKL OAuth callback succeeded for user ${userData.user?.name ?? 'unknown'}`, {
      user: userData.user?.name,
    });

    res.redirect('/?simkl_auth=success');
  } catch (error) {
    console.error('Simkl OAuth callback error:', error);
    appendLog('simkl-auth', 'error', 'SIMKL OAuth callback failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.redirect('/?simkl_auth=error');
  }
```

- [ ] **Step 4: Log logout**

Replace:

```ts
async function logout(res: NextApiResponse) {
  clearSimklAuthData();
  res.json({ success: true });
}
```

with:

```ts
async function logout(res: NextApiResponse) {
  clearSimklAuthData();
  appendLog('simkl-auth', 'info', 'SIMKL account disconnected');
  res.json({ success: true });
}
```

- [ ] **Step 5: Verify**

Run: `npm run dev`. Connect or disconnect SIMKL from the main page. Then:
```bash
curl "http://localhost:3000/api/anime/connection-log?afterId=0"
```
Expected: a `simkl-auth` entry matching the action performed, alongside any `mal-auth` entries from Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/anime/simkl/auth.ts
git commit -m "Log SIMKL auth events to connection log"
```

---

### Task 4: Instrument lightweight sync (`sync.ts`)

**Files:**
- Modify: `src/pages/api/anime/sync.ts`

**Interfaces:**
- Consumes: `appendLog` from `@/lib/connectionLog` (Task 1).

- [ ] **Step 1: Import `appendLog`**

Add to the top imports of `src/pages/api/anime/sync.ts`:

```ts
import { appendLog } from '@/lib/connectionLog';
```

- [ ] **Step 2: Log sync start**

After the existing season-log lines (around line 57, right after `console.log(\`Syncing anime for next season: ${nextYear} ${nextSeason}\`);`):

```ts
    console.log(`Syncing anime for next season: ${nextYear} ${nextSeason}`);

    appendLog('sync', 'info', 'Sync started', {
      currentSeason: { year: currentYear, season: currentSeason },
      previousSeason: { year: prevYear, season: prevSeason },
      nextSeason: { year: nextYear, season: nextSeason },
    });
```

- [ ] **Step 3: Log seasonal + personal sync summary**

Replace:

```ts
    // Upsert all anime data
    upsertMALAnime(allAnime);

    console.log(`Successfully synced ${allAnime.length} seasonal anime`);

    // Personal status sync
    console.log(`Syncing personal anime list for user: ${user.name}`);
    const personalAnimeList = await fetchUserAnimelist(token.access_token, user.name);
    console.log(`Fetched ${personalAnimeList.length} anime from personal list`);

    const personalStatusUpdates = personalAnimeList.map(item => ({
      animeId: item.animeId,
      listStatus: item.listStatus
    }));

    const personalSyncStats = updatePersonalStatusBatch(personalStatusUpdates);
    console.log(
      `Personal status sync: ${personalSyncStats.updated} updated, ${personalSyncStats.skipped} skipped, ${personalSyncStats.failed} failed`
    );
```

with:

```ts
    // Upsert all anime data
    upsertMALAnime(allAnime);

    console.log(`Successfully synced ${allAnime.length} seasonal anime`);
    appendLog('sync', 'info', `Synced ${allAnime.length} seasonal anime`, { syncedCount: allAnime.length });

    // Personal status sync
    console.log(`Syncing personal anime list for user: ${user.name}`);
    const personalAnimeList = await fetchUserAnimelist(token.access_token, user.name);
    console.log(`Fetched ${personalAnimeList.length} anime from personal list`);

    const personalStatusUpdates = personalAnimeList.map(item => ({
      animeId: item.animeId,
      listStatus: item.listStatus
    }));

    const personalSyncStats = updatePersonalStatusBatch(personalStatusUpdates);
    console.log(
      `Personal status sync: ${personalSyncStats.updated} updated, ${personalSyncStats.skipped} skipped, ${personalSyncStats.failed} failed`
    );
    appendLog('sync', 'success', 'Sync completed', {
      seasonalSyncedCount: allAnime.length,
      personalUpdated: personalSyncStats.updated,
      personalSkipped: personalSyncStats.skipped,
      personalFailed: personalSyncStats.failed,
    });
```

- [ ] **Step 4: Log sync failure**

Replace the catch block:

```ts
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ 
      error: 'Failed to sync anime data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
```

with:

```ts
  } catch (error) {
    console.error('Sync error:', error);
    appendLog('sync', 'error', 'Sync failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ 
      error: 'Failed to sync anime data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
```

- [ ] **Step 5: Verify**

Run: `npm run dev`, trigger "Sync Data" from the main page (requires MAL auth). Then:
```bash
curl "http://localhost:3000/api/anime/connection-log?afterId=0"
```
Expected: `sync` entries for start and completion (or failure), in addition to earlier auth entries.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/anime/sync.ts
git commit -m "Log lightweight sync events to connection log"
```

---

### Task 5: Instrument big sync (`big-sync.ts`)

**Files:**
- Modify: `src/pages/api/anime/big-sync.ts`

**Interfaces:**
- Consumes: `appendLog` from `@/lib/connectionLog` (Task 1), `BigSyncProgress` type already imported from `@/lib/anime`.

- [ ] **Step 1: Import `appendLog`**

Add to the top imports of `src/pages/api/anime/big-sync.ts`:

```ts
import { appendLog } from '@/lib/connectionLog';
```

- [ ] **Step 2: Map every SSE progress event into a log entry**

Replace `performBigSyncAsync`:

```ts
async function performBigSyncAsync(accessToken: string, syncId: string) {
  const addProgress = (progress: BigSyncProgress) => {
    const syncProcess = syncProcesses.get(syncId);
    if (syncProcess) {
      syncProcess.progress.push(progress);
      // Keep only the last 100 progress updates to prevent memory leaks
      if (syncProcess.progress.length > 100) {
        syncProcess.progress = syncProcess.progress.slice(-50);
      }
    }
  };

  try {
    await performBigSync(accessToken, addProgress);
  } catch (error) {
    console.error(`Big sync ${syncId} error:`, error);
    addProgress({
      type: 'error',
      error: 'Failed to perform big sync',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    const syncProcess = syncProcesses.get(syncId);
    if (syncProcess) {
      syncProcess.isRunning = false;
    }
  }
}
```

with:

```ts
function progressToLogLevel(progress: BigSyncProgress): 'info' | 'success' | 'error' {
  if (progress.type === 'error' || progress.type === 'season_error') return 'error';
  if (progress.type === 'complete') return 'success';
  return 'info';
}

function progressToLogMessage(progress: BigSyncProgress): string {
  return progress.message || progress.details || progress.error || `Big sync ${progress.type}`;
}

async function performBigSyncAsync(accessToken: string, syncId: string) {
  const addProgress = (progress: BigSyncProgress) => {
    const syncProcess = syncProcesses.get(syncId);
    if (syncProcess) {
      syncProcess.progress.push(progress);
      // Keep only the last 100 progress updates to prevent memory leaks
      if (syncProcess.progress.length > 100) {
        syncProcess.progress = syncProcess.progress.slice(-50);
      }
    }
    appendLog('big-sync', progressToLogLevel(progress), progressToLogMessage(progress), {
      type: progress.type,
      year: progress.year,
      season: progress.season,
      totalSeasons: progress.totalSeasons,
      currentSeason: progress.currentSeason,
      syncedCount: progress.syncedCount,
    });
  };

  try {
    await performBigSync(accessToken, addProgress);
  } catch (error) {
    console.error(`Big sync ${syncId} error:`, error);
    addProgress({
      type: 'error',
      error: 'Failed to perform big sync',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    const syncProcess = syncProcesses.get(syncId);
    if (syncProcess) {
      syncProcess.isRunning = false;
    }
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run dev`, trigger "Big Sync" from the main page. Since big sync takes a while, poll the log endpoint a few times while it runs:
```bash
curl "http://localhost:3000/api/anime/connection-log?afterId=0"
```
Expected: a growing stream of `big-sync` entries (`start`, repeated `fetch_progress`/`season` events, then `complete`), matching the console output already visible in the terminal running `npm run dev`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/anime/big-sync.ts
git commit -m "Log big sync progress events to connection log"
```

---

### Task 6: Instrument SIMKL sync (`simkl/sync.ts`)

**Files:**
- Modify: `src/pages/api/anime/simkl/sync.ts`

**Interfaces:**
- Consumes: `appendLog` from `@/lib/connectionLog` (Task 1), `SimklSyncResult` shape (`ok`, `phase`, `added`, `removed`, `orphansSkipped`, `error?`) returned by `performSimklSync` from `@/lib/simklSync`.

- [ ] **Step 1: Replace the handler**

Replace the full contents of `src/pages/api/anime/simkl/sync.ts`:

```ts
import { NextApiRequest, NextApiResponse } from 'next';
import { performSimklSync } from '@/lib/simklSync';
import { appendLog } from '@/lib/connectionLog';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    return;
  }
  const result = await performSimklSync();

  if (result.ok) {
    appendLog('simkl-sync', 'success', `SIMKL sync (${result.phase}) completed`, {
      phase: result.phase,
      added: result.added,
      removed: result.removed,
      orphansSkipped: result.orphansSkipped,
    });
  } else {
    appendLog('simkl-sync', 'error', 'SIMKL sync failed', { error: result.error });
  }

  res.status(result.ok ? 200 : 500).json(result);
}
```

- [ ] **Step 2: Verify**

Run: `npm run dev`, trigger "Sync SIMKL" from the main page (requires SIMKL auth). Then:
```bash
curl "http://localhost:3000/api/anime/connection-log?afterId=0"
```
Expected: a `simkl-sync` entry with `phase`/`added`/`removed`/`orphansSkipped` in `detail`, matching the `simklSyncMessage` shown in the UI.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/anime/simkl/sync.ts
git commit -m "Log SIMKL sync events to connection log"
```

---

### Task 7: Instrument historical crawl (`lib/anime.ts` `performHistoricalCrawl`)

**Files:**
- Modify: `src/lib/anime.ts:410-473` (`performHistoricalCrawl`)

**Interfaces:**
- Consumes: `appendLog` from `@/lib/connectionLog` (Task 1).

- [ ] **Step 1: Import `appendLog`**

In `src/lib/anime.ts`, add to the top imports (after the existing `@/lib/simklCompare` import):

```ts
import { appendLog } from '@/lib/connectionLog';
```

- [ ] **Step 2: Log crawl outcomes**

Replace `performHistoricalCrawl`:

```ts
export async function performHistoricalCrawl(
  accessToken: string,
  batchSize: number = HISTORICAL_CRAWL_BATCH_SIZE
): Promise<HistoricalCrawlResult> {
  if (isHistoricalCrawlRunning) {
    return { success: false, alreadyRunning: true, syncedCount: 0, processedSeasons: 0, stats: getHistoricalCrawlStats() };
  }

  isHistoricalCrawlRunning = true;
  try {
    const batch = getNextHistoricalBatch(batchSize);
    if (batch.length === 0) {
      return { success: true, alreadyRunning: false, syncedCount: 0, processedSeasons: 0, stats: getHistoricalCrawlStats() };
    }

    const allAnime: MALAnime[] = [];
    const syncedKeys: string[] = [];
    let consecutiveEmpty = 0;

    for (const { year, season } of batch) {
      const anime = await fetchSeasonalAnime(accessToken, year, season);
      if (anime.length === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
        allAnime.push(...anime);
      }
      // Always mark as synced even if empty (empty = no anime that season on MAL)
      syncedKeys.push(`${year}-${season}`);

      if (consecutiveEmpty >= HISTORICAL_CRAWL_CONSECUTIVE_EMPTY_STOP) {
        // Mark remaining batch items synced too so we skip past the dead zone
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (allAnime.length > 0) {
      upsertMALAnime(allAnime);
    }
    markSeasonsSynced(syncedKeys);

    return {
      success: true,
      alreadyRunning: false,
      syncedCount: allAnime.length,
      processedSeasons: syncedKeys.length,
      stats: getHistoricalCrawlStats(),
    };
  } catch (error) {
    console.error('Historical crawl error:', error);
    return {
      success: false,
      alreadyRunning: false,
      syncedCount: 0,
      processedSeasons: 0,
      stats: getHistoricalCrawlStats(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    isHistoricalCrawlRunning = false;
  }
}
```

with:

```ts
export async function performHistoricalCrawl(
  accessToken: string,
  batchSize: number = HISTORICAL_CRAWL_BATCH_SIZE
): Promise<HistoricalCrawlResult> {
  if (isHistoricalCrawlRunning) {
    appendLog('historical-crawl', 'info', 'Historical crawl skipped: already running');
    return { success: false, alreadyRunning: true, syncedCount: 0, processedSeasons: 0, stats: getHistoricalCrawlStats() };
  }

  isHistoricalCrawlRunning = true;
  try {
    const batch = getNextHistoricalBatch(batchSize);
    if (batch.length === 0) {
      appendLog('historical-crawl', 'success', 'Historical crawl already complete: no remaining seasons');
      return { success: true, alreadyRunning: false, syncedCount: 0, processedSeasons: 0, stats: getHistoricalCrawlStats() };
    }

    const allAnime: MALAnime[] = [];
    const syncedKeys: string[] = [];
    let consecutiveEmpty = 0;

    for (const { year, season } of batch) {
      const anime = await fetchSeasonalAnime(accessToken, year, season);
      if (anime.length === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
        allAnime.push(...anime);
      }
      // Always mark as synced even if empty (empty = no anime that season on MAL)
      syncedKeys.push(`${year}-${season}`);

      if (consecutiveEmpty >= HISTORICAL_CRAWL_CONSECUTIVE_EMPTY_STOP) {
        // Mark remaining batch items synced too so we skip past the dead zone
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (allAnime.length > 0) {
      upsertMALAnime(allAnime);
    }
    markSeasonsSynced(syncedKeys);

    const stats = getHistoricalCrawlStats();
    appendLog('historical-crawl', 'success', `Historical crawl batch complete: ${syncedKeys.length} seasons, ${allAnime.length} anime`, {
      processedSeasons: syncedKeys.length,
      syncedCount: allAnime.length,
      remaining: stats.remaining,
    });

    return {
      success: true,
      alreadyRunning: false,
      syncedCount: allAnime.length,
      processedSeasons: syncedKeys.length,
      stats,
    };
  } catch (error) {
    console.error('Historical crawl error:', error);
    appendLog('historical-crawl', 'error', 'Historical crawl failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      alreadyRunning: false,
      syncedCount: 0,
      processedSeasons: 0,
      stats: getHistoricalCrawlStats(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    isHistoricalCrawlRunning = false;
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run dev`, trigger "Crawl History" from the main page. Then:
```bash
curl "http://localhost:3000/api/anime/connection-log?afterId=0"
```
Expected: a `historical-crawl` `success` entry with `processedSeasons`/`syncedCount`/`remaining` in `detail`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/anime.ts
git commit -m "Log historical crawl outcomes to connection log"
```

---

### Task 8: Instrument cron sync (`cron-sync.ts`)

**Files:**
- Modify: `src/pages/api/anime/cron-sync.ts`

**Interfaces:**
- Consumes: `appendLog` from `@/lib/connectionLog` (Task 1). This is the primary payoff: cron runs today have zero UI visibility.

- [ ] **Step 1: Replace the full file contents**

```ts
import { NextApiRequest, NextApiResponse } from 'next';
import { getMALAuthData, isMALTokenValid, performHistoricalCrawl } from '@/lib/anime';
import { appendLog } from '@/lib/connectionLog';

// This is a simplified version of the big-sync trigger
// It doesn't handle the SSE part, as it's meant for an automated cron job

async function startBigSync() {
  try {
    const response = await fetch('http://localhost:3000/api/anime/big-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to start big sync');
    }

    const data = await response.json();
    console.log('Cron sync started:', data.syncId);
    return data;
  } catch (error) {
    console.error('Error in cron-sync when starting big sync:', error);
    throw error;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Basic security check: can be improved with a secret key
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  appendLog('cron-sync', 'info', 'Cron sync run started');

  try {
    // Check MAL authentication status before starting
    const { token } = getMALAuthData();
    if (!token || !isMALTokenValid(token)) {
      // Here you might want to implement logic to refresh the token automatically
      // For now, we just log and fail if not valid
      console.error('Cron sync cannot run: MAL token is invalid or missing.');
      appendLog('cron-sync', 'error', 'Cron sync aborted: MAL token invalid or missing');
      return res.status(400).json({ error: 'MAL token is invalid or missing. Cannot start sync.' });
    }

    const bigSyncData = await startBigSync();
    appendLog('cron-sync', 'info', 'Cron sync triggered big sync', { syncId: bigSyncData.syncId });

    // Crawl a small batch of historical seasons after big-sync fires
    const crawlResult = await performHistoricalCrawl(token.access_token);
    console.log(
      `Historical crawl: ${crawlResult.processedSeasons} seasons, ${crawlResult.syncedCount} anime, ${crawlResult.stats.remaining} remaining`
    );
    appendLog('cron-sync', 'success', 'Cron sync run completed', {
      processedSeasons: crawlResult.processedSeasons,
      syncedCount: crawlResult.syncedCount,
      remaining: crawlResult.stats.remaining,
    });

    res.status(200).json({
      message: 'Cron sync process initiated successfully.',
      historicalCrawl: {
        processedSeasons: crawlResult.processedSeasons,
        syncedCount: crawlResult.syncedCount,
        remaining: crawlResult.stats.remaining,
      },
    });
  } catch (error) {
    console.error('Cron sync handler failed:', error);
    appendLog('cron-sync', 'error', 'Cron sync run failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({ 
      error: 'Failed to initiate cron sync',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run dev`. In another terminal, invoke the endpoint directly (mirroring how cron would call it — adjust the header if `CRON_SECRET` is unset in your local `.env`):
```bash
curl -X POST http://localhost:3000/api/anime/cron-sync -H "Authorization: Bearer $CRON_SECRET"
```
Then:
```bash
curl "http://localhost:3000/api/anime/connection-log?afterId=0"
```
Expected: `cron-sync` entries for run-started, big-sync-triggered, and run-completed (or the aborted/failed variants if MAL isn't authenticated).

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/anime/cron-sync.ts
git commit -m "Log cron sync run events to connection log"
```

---

### Task 9: `ConnectionLogPanel` component

**Files:**
- Create: `src/components/anime/ConnectionLogPanel.tsx`
- Create: `src/components/anime/ConnectionLogPanel.module.css`
- Modify: `src/components/anime/index.ts`

**Interfaces:**
- Consumes: `GET /api/anime/connection-log?afterId=<n>` → `{ entries: LogEntry[] }` (Task 1). Only needs the `LogEntry` shape (`id`, `timestamp`, `source`, `level`, `message`, `detail?`) — imported as a local type, not from `@/lib/connectionLog` (client bundle must not pull in that `fs`-based module transitively; the type is small enough to redeclare locally, matching the existing pattern for `@/lib/anime` type-only imports).
- Produces: `<ConnectionLogPanel />` (no props), rendered standalone on `/connections` (Task 11).

- [ ] **Step 1: Create `src/components/anime/ConnectionLogPanel.tsx`**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import styles from './ConnectionLogPanel.module.css';

type LogLevel = 'info' | 'success' | 'error';

interface LogEntry {
  id: number;
  timestamp: number;
  source: string;
  level: LogLevel;
  message: string;
  detail?: Record<string, unknown>;
}

const POLL_INTERVAL_MS = 2000;

const ConnectionLogPanel: React.FC = () => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const lastIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/anime/connection-log?afterId=${lastIdRef.current}`);
        if (!res.ok) return;
        const data = await res.json();
        const newEntries: LogEntry[] = data.entries || [];
        if (cancelled || newEntries.length === 0) return;
        lastIdRef.current = newEntries[newEntries.length - 1].id;
        setEntries(prev => [...prev, ...newEntries]);
      } catch {
        // best-effort UI, skip this tick and retry on the next interval
      }
    };

    poll();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>Connection & Sync Log</h3>
      <div className={styles.list} ref={listRef}>
        {entries.length === 0 ? (
          <div className={styles.empty}>No activity yet.</div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className={`${styles.entry} ${styles[entry.level]}`}>
              <span className={styles.timestamp}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span className={styles.source}>[{entry.source}]</span>
              <span className={styles.message}>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ConnectionLogPanel;
```

- [ ] **Step 2: Create `src/components/anime/ConnectionLogPanel.module.css`**

```css
.panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
}

.title {
  margin: 0;
  font-size: 1rem;
  color: var(--text-primary);
}

.list {
  height: 400px;
  overflow-y: auto;
  background: var(--bg-secondary);
  border-radius: 4px;
  padding: 8px;
  font-family: monospace;
  font-size: 0.85rem;
}

.empty {
  color: var(--text-secondary);
  padding: 8px;
}

.entry {
  display: flex;
  gap: 8px;
  padding: 2px 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

.timestamp {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.source {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.info .message {
  color: var(--text-primary);
}

.success .message {
  color: #4ade80;
}

.error .message {
  color: #ff6b6b;
}
```

- [ ] **Step 3: Export from `src/components/anime/index.ts`**

Add:

```ts
export { default as ConnectionLogPanel } from './ConnectionLogPanel';
```

- [ ] **Step 4: Generate CSS typings**

Run: `npm run css:types`
Expected: `src/components/anime/ConnectionLogPanel.module.css.d.ts` is generated (or updated) with the class names used above (`panel`, `title`, `list`, `empty`, `entry`, `timestamp`, `source`, `message`, `info`, `success`, `error`).

- [ ] **Step 5: Verify**

This component isn't rendered anywhere yet — defer visual verification to Task 11, where it's mounted on `/connections`. For now just confirm the project still builds:
Run: `npm run build`
Expected: build succeeds with no TypeScript errors referencing `ConnectionLogPanel`.

- [ ] **Step 6: Commit**

```bash
git add src/components/anime/ConnectionLogPanel.tsx src/components/anime/ConnectionLogPanel.module.css src/components/anime/ConnectionLogPanel.module.css.d.ts src/components/anime/index.ts
git commit -m "Add ConnectionLogPanel component"
```

---

### Task 10: Extract `useConnections` hook

**Files:**
- Create: `src/hooks/useConnections.ts`
- Modify: `src/hooks/index.ts`

**Interfaces:**
- Consumes: `MALAuthState` from `@/models/anime`; `HistoricalCrawlStats` as a type-only import from `@/lib/anime`.
- Produces:
```ts
function useConnections(options?: { onDataChanged?: () => void }): {
  authState: MALAuthState;
  isAuthLoading: boolean;
  authError: string;
  onConnect: () => void;
  onDisconnect: () => void;
  isSyncing: boolean;
  isBigSyncing: boolean;
  isHistoricalCrawling: boolean;
  syncError: string;
  historicalStats: HistoricalCrawlStats | null;
  onSync: () => void;
  onBigSync: () => void;
  onHistoricalCrawl: () => void;
  simklConnected: boolean;
  simklUser: string | undefined;
  isSimklAuthLoading: boolean;
  simklAuthError: string;
  isSimklSyncing: boolean;
  simklSyncMessage: string;
  onSimklConnect: () => void;
  onSimklDisconnect: () => void;
  onSimklSync: () => void;
}
```
This exact shape is consumed by `connections.tsx` (Task 11) and by the refactored `index.tsx` (Task 13) — both must destructure these same field names.

- [ ] **Step 1: Create `src/hooks/useConnections.ts`**

```ts
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { MALAuthState } from '@/models/anime';
import type { HistoricalCrawlStats } from '@/lib/anime';

interface UseConnectionsOptions {
  onDataChanged?: () => void;
}

export function useConnections(options: UseConnectionsOptions = {}) {
  const { onDataChanged } = options;
  const router = useRouter();

  // MAL auth state
  const [authState, setAuthState] = useState<MALAuthState>({ isAuthenticated: false });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBigSyncing, setIsBigSyncing] = useState(false);
  const [isHistoricalCrawling, setIsHistoricalCrawling] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [historicalStats, setHistoricalStats] = useState<HistoricalCrawlStats | null>(null);

  // SIMKL auth + sync state
  const [simklConnected, setSimklConnected] = useState(false);
  const [simklUser, setSimklUser] = useState<string | undefined>(undefined);
  const [isSimklAuthLoading, setIsSimklAuthLoading] = useState(true);
  const [simklAuthError, setSimklAuthError] = useState('');
  const [isSimklSyncing, setIsSimklSyncing] = useState(false);
  const [simklSyncMessage, setSimklSyncMessage] = useState('');

  const fetchHistoricalStats = async () => {
    try {
      const res = await fetch('/api/anime/historical-crawl');
      if (res.ok) setHistoricalStats(await res.json());
    } catch {
      // non-critical, silently ignore
    }
  };

  const checkAuthStatus = async () => {
    try {
      setIsAuthLoading(true);
      const response = await fetch('/api/anime/auth?action=status');
      const data = await response.json();
      setAuthState({ isAuthenticated: data.isAuthenticated, user: data.user });
    } catch (error) {
      console.error('Error checking auth status:', error);
      setAuthError('Failed to check authentication status');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const checkSimklStatus = async () => {
    try {
      setIsSimklAuthLoading(true);
      const response = await fetch('/api/anime/simkl/auth?action=status');
      const data = await response.json();
      setSimklConnected(!!data.isAuthenticated);
      setSimklUser(data.user?.user?.name);
    } catch (error) {
      console.error('Error checking SIMKL status:', error);
    } finally {
      setIsSimklAuthLoading(false);
    }
  };

  // Check auth status and historical stats on mount
  useEffect(() => {
    checkAuthStatus();
    fetchHistoricalStats();
    checkSimklStatus();
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    if (!router.isReady) return;

    const authParam = router.query.auth;
    if (authParam) {
      if (authParam === 'success') {
        checkAuthStatus();
      } else {
        setAuthError('Authentication failed. Please try again.');
      }
      const { auth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }

    const simklAuthParam = router.query.simkl_auth;
    if (simklAuthParam) {
      if (simklAuthParam === 'success') checkSimklStatus();
      else setSimklAuthError('SIMKL authentication failed. Please try again.');
      const { simkl_auth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.isReady, router.query, router]);

  // MAL auth handlers
  const handleConnect = async () => {
    try {
      setIsAuthLoading(true);
      setAuthError('');
      const response = await fetch('/api/anime/auth?action=login');
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        setAuthError('Failed to initiate authentication');
      }
    } catch (error) {
      console.error('Error connecting to MAL:', error);
      setAuthError('Failed to connect to MyAnimeList');
      setIsAuthLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setIsAuthLoading(true);
      setAuthError('');
      await fetch('/api/anime/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      setAuthState({ isAuthenticated: false });
    } catch (error) {
      console.error('Error disconnecting from MAL:', error);
      setAuthError('Failed to disconnect from MyAnimeList');
    } finally {
      setIsAuthLoading(false);
    }
  };

  // SIMKL auth handlers
  const handleSimklConnect = async () => {
    try {
      setIsSimklAuthLoading(true);
      setSimklAuthError('');
      const response = await fetch('/api/anime/simkl/auth?action=login');
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else { setSimklAuthError('Failed to initiate SIMKL authentication'); setIsSimklAuthLoading(false); }
    } catch (error) {
      console.error('Error connecting to SIMKL:', error);
      setSimklAuthError('Failed to connect to SIMKL');
      setIsSimklAuthLoading(false);
    }
  };

  const handleSimklDisconnect = async () => {
    try {
      setIsSimklAuthLoading(true);
      setSimklAuthError('');
      await fetch('/api/anime/simkl/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      setSimklConnected(false);
      setSimklUser(undefined);
    } catch (error) {
      console.error('Error disconnecting from SIMKL:', error);
      setSimklAuthError('Failed to disconnect from SIMKL');
    } finally {
      setIsSimklAuthLoading(false);
    }
  };

  const handleSimklSync = async () => {
    if (!simklConnected) return;
    setIsSimklSyncing(true);
    setSimklSyncMessage('');
    try {
      const response = await fetch('/api/anime/simkl/sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Sync failed');
      setSimklSyncMessage(
        `${data.phase}: +${data.added} updated, ${data.removed} removed${data.orphansSkipped ? `, ${data.orphansSkipped} skipped (no MAL id)` : ''}`
      );
      onDataChanged?.();
    } catch (error) {
      setSimklSyncMessage(error instanceof Error ? error.message : 'Failed to sync SIMKL.');
    } finally {
      setIsSimklSyncing(false);
    }
  };

  // Sync handlers
  const handleSync = async () => {
    if (!authState.isAuthenticated) return;
    setIsSyncing(true);
    setSyncError('');
    try {
      const response = await fetch('/api/anime/sync', { method: 'POST' });
      if (!response.ok) throw new Error('Sync failed');
      onDataChanged?.();
    } catch (error) {
      setSyncError('Failed to sync data.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBigSync = async () => {
    if (!authState.isAuthenticated) return;
    setIsBigSyncing(true);
    setSyncError('');
    try {
      const response = await fetch('/api/anime/big-sync', { method: 'POST' });
      if (!response.ok) throw new Error('Big sync failed');
      onDataChanged?.();
    } catch (error) {
      setSyncError('Failed to start big sync.');
    } finally {
      setIsBigSyncing(false);
    }
  };

  const handleHistoricalCrawl = async () => {
    if (!authState.isAuthenticated) return;
    setIsHistoricalCrawling(true);
    setSyncError('');
    try {
      const res = await fetch('/api/anime/historical-crawl', { method: 'POST' });
      if (!res.ok) throw new Error('Historical crawl failed');
      const data = await res.json();
      setHistoricalStats(data.stats);
      onDataChanged?.();
    } catch {
      setSyncError('Failed to run historical crawl.');
    } finally {
      setIsHistoricalCrawling(false);
    }
  };

  return {
    authState,
    isAuthLoading,
    authError,
    onConnect: handleConnect,
    onDisconnect: handleDisconnect,
    isSyncing,
    isBigSyncing,
    isHistoricalCrawling,
    syncError,
    historicalStats,
    onSync: handleSync,
    onBigSync: handleBigSync,
    onHistoricalCrawl: handleHistoricalCrawl,
    simklConnected,
    simklUser,
    isSimklAuthLoading,
    simklAuthError,
    isSimklSyncing,
    simklSyncMessage,
    onSimklConnect: handleSimklConnect,
    onSimklDisconnect: handleSimklDisconnect,
    onSimklSync: handleSimklSync,
  };
}
```

- [ ] **Step 2: Export from `src/hooks/index.ts`**

Add:

```ts
export { useConnections } from './useConnections';
```

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: build succeeds. `index.tsx` doesn't use this hook yet (Task 13), so this task only proves the hook compiles standalone with no consumers.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useConnections.ts src/hooks/index.ts
git commit -m "Extract useConnections hook from index.tsx"
```

---

### Task 11: `/connections` page

**Files:**
- Create: `src/pages/connections.tsx`

**Interfaces:**
- Consumes: `useConnections()` (Task 10), `AccountSection`/`SimklSection`/`DataSyncSection` (existing, unchanged props), `ConnectionLogPanel` (Task 9).

- [ ] **Step 1: Create `src/pages/connections.tsx`**

```tsx
import Head from 'next/head';
import { AccountSection, SimklSection, DataSyncSection, ConnectionLogPanel } from '@/components/anime';
import { useConnections } from '@/hooks';

export default function ConnectionsPage() {
  const {
    authState, isAuthLoading, authError, onConnect, onDisconnect,
    isSyncing, isBigSyncing, isHistoricalCrawling, syncError, historicalStats,
    onSync, onBigSync, onHistoricalCrawl,
    simklConnected, simklUser, isSimklAuthLoading, simklAuthError,
    isSimklSyncing, simklSyncMessage, onSimklConnect, onSimklDisconnect, onSimklSync,
  } = useConnections();

  return (
    <>
      <Head>
        <title>Connections - MyHomeApp</title>
        <meta name="description" content="Manage MyAnimeList/SIMKL connections and sync activity" />
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <div className="connections-page">
        <section className="connections-section">
          <h2>MyAnimeList</h2>
          <AccountSection
            authState={authState}
            isAuthLoading={isAuthLoading}
            authError={authError}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
          />
        </section>
        <section className="connections-section">
          <h2>SIMKL</h2>
          <SimklSection
            isConnected={simklConnected}
            userName={simklUser}
            isAuthLoading={isSimklAuthLoading}
            authError={simklAuthError}
            isSyncing={isSimklSyncing}
            syncMessage={simklSyncMessage}
            onConnect={onSimklConnect}
            onDisconnect={onSimklDisconnect}
            onSync={onSimklSync}
          />
        </section>
        <section className="connections-section">
          <h2>Sync</h2>
          <DataSyncSection
            authState={authState}
            isSyncing={isSyncing}
            isBigSyncing={isBigSyncing}
            isHistoricalCrawling={isHistoricalCrawling}
            syncError={syncError}
            historicalStats={historicalStats}
            onSync={onSync}
            onBigSync={onBigSync}
            onHistoricalCrawl={onHistoricalCrawl}
          />
        </section>
        <section className="connections-section">
          <ConnectionLogPanel />
        </section>
      </div>
      <style jsx>{`
        .connections-page { display: flex; flex-direction: column; gap: 1.5rem; max-width: 700px; }
        .connections-section { background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; }
        .connections-section h2 { margin: 0 0 0.75rem; font-size: 1.1rem; color: var(--text-primary); }
      `}</style>
    </>
  );
}
```

- [ ] **Step 2: Verify**

Run: `npm run dev`, navigate to `http://localhost:3000/connections` in a browser.
Expected: MAL/SIMKL account sections and sync buttons render and function identically to the main page's sidebar (connect/disconnect, sync/big-sync/crawl-history all work); the log panel below shows a scrollable list that grows as you trigger these actions, confirming Tasks 2–8's instrumentation reaches the UI end-to-end.

- [ ] **Step 3: Commit**

```bash
git add src/pages/connections.tsx
git commit -m "Add /connections page"
```

---

### Task 12: Add "Connections" nav link

**Files:**
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: Add the nav link**

Replace:

```tsx
              <Link
                href="/rate"
                className={`nav-link ${router.pathname === '/rate' ? 'active' : ''}`}
              >
                Rating Calculator
              </Link>
            </nav>
```

with:

```tsx
              <Link
                href="/rate"
                className={`nav-link ${router.pathname === '/rate' ? 'active' : ''}`}
              >
                Rating Calculator
              </Link>
              <Link
                href="/connections"
                className={`nav-link ${router.pathname === '/connections' ? 'active' : ''}`}
              >
                Connections
              </Link>
            </nav>
```

- [ ] **Step 2: Verify**

Run: `npm run dev`. Confirm "Connections" appears in the top nav on every page and is highlighted as active when on `/connections`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Layout.tsx
git commit -m "Add Connections link to top nav"
```

---

### Task 13: Refactor `index.tsx` to use `useConnections`

**Files:**
- Modify: `src/pages/index.tsx`

**Interfaces:**
- Consumes: `useConnections({ onDataChanged: loadAnimes })` (Task 10). Renders the same `AnimeSidebar` with the same prop names — only the value source changes.

- [ ] **Step 1: Remove local auth/sync state and replace with the hook**

Replace lines 1-73 (imports through `checkSimklStatus`) and the mount/OAuth-callback effects (lines 133-163) as follows.

Replace the import block:

```tsx
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { AnimePageLayout, AnimeSidebar, AnimeTable, AnimeCardView } from '@/components/anime';
import { AnimeForDisplay, MALAuthState, UserAnimeStatus, StatsColumn } from '@/models/anime';
import type { HistoricalCrawlStats } from '@/lib/anime';
import { useAnimeUrlState } from '@/hooks';

export default function AnimePage() {
  const router = useRouter();
  const { filters, display, updateFilters, updateDisplay, isReady } = useAnimeUrlState();

  // Auth state (not URL-controlled)
  const [authState, setAuthState] = useState<MALAuthState>({ isAuthenticated: false });
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  // Sync state (not URL-controlled)
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBigSyncing, setIsBigSyncing] = useState(false);
  const [isHistoricalCrawling, setIsHistoricalCrawling] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [historicalStats, setHistoricalStats] = useState<HistoricalCrawlStats | null>(null);

  // SIMKL auth + sync state (not URL-controlled)
  const [simklConnected, setSimklConnected] = useState(false);
  const [simklUser, setSimklUser] = useState<string | undefined>(undefined);
  const [isSimklAuthLoading, setIsSimklAuthLoading] = useState(true);
  const [simklAuthError, setSimklAuthError] = useState('');
  const [isSimklSyncing, setIsSimklSyncing] = useState(false);
  const [simklSyncMessage, setSimklSyncMessage] = useState('');

  // Data state
  const [animes, setAnimes] = useState<AnimeForDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchHistoricalStats = async () => {
    try {
      const res = await fetch('/api/anime/historical-crawl');
      if (res.ok) setHistoricalStats(await res.json());
    } catch {
      // non-critical, silently ignore
    }
  };

  const checkAuthStatus = async () => {
    try {
      setIsAuthLoading(true);
      const response = await fetch('/api/anime/auth?action=status');
      const data = await response.json();
      setAuthState({ isAuthenticated: data.isAuthenticated, user: data.user });
    } catch (error) {
      console.error('Error checking auth status:', error);
      setAuthError('Failed to check authentication status');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const checkSimklStatus = async () => {
    try {
      setIsSimklAuthLoading(true);
      const response = await fetch('/api/anime/simkl/auth?action=status');
      const data = await response.json();
      setSimklConnected(!!data.isAuthenticated);
      setSimklUser(data.user?.user?.name);
    } catch (error) {
      console.error('Error checking SIMKL status:', error);
    } finally {
      setIsSimklAuthLoading(false);
    }
  };

  const loadAnimes = useCallback(async () => {
```

with:

```tsx
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { AnimePageLayout, AnimeSidebar, AnimeTable, AnimeCardView } from '@/components/anime';
import { AnimeForDisplay, UserAnimeStatus, StatsColumn } from '@/models/anime';
import { useAnimeUrlState, useConnections } from '@/hooks';

export default function AnimePage() {
  const { filters, display, updateFilters, updateDisplay, isReady } = useAnimeUrlState();

  // Data state
  const [animes, setAnimes] = useState<AnimeForDisplay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadAnimes = useCallback(async () => {
```

Then, right after the `loadAnimes` `useCallback` block closes (still inside the component, immediately before the "Check auth status and historical stats on mount" comment), add:

```tsx
  const {
    authState, isAuthLoading, authError, onConnect: handleConnect, onDisconnect: handleDisconnect,
    isSyncing, isBigSyncing, isHistoricalCrawling, syncError, historicalStats,
    onSync: handleSync, onBigSync: handleBigSync, onHistoricalCrawl: handleHistoricalCrawl,
    simklConnected, simklUser, isSimklAuthLoading, simklAuthError,
    isSimklSyncing, simklSyncMessage,
    onSimklConnect: handleSimklConnect, onSimklDisconnect: handleSimklDisconnect, onSimklSync: handleSimklSync,
  } = useConnections({ onDataChanged: loadAnimes });
```

- [ ] **Step 2: Remove the now-redundant mount effect, OAuth-callback effect, and all extracted handlers**

Delete this whole block (the "Check auth status and historical stats on mount" effect and the "Handle OAuth callback" effect — both now live inside `useConnections`):

```tsx
  // Check auth status and historical stats on mount
  useEffect(() => {
    checkAuthStatus();
    fetchHistoricalStats();
    checkSimklStatus();
  }, []);

  // Handle OAuth callback
  useEffect(() => {
    if (!router.isReady) return;

    const authParam = router.query.auth;
    if (authParam) {
      if (authParam === 'success') {
        checkAuthStatus();
      } else {
        setAuthError('Authentication failed. Please try again.');
      }
      // Remove auth param from URL without affecting other params
      const { auth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }

    const simklAuthParam = router.query.simkl_auth;
    if (simklAuthParam) {
      if (simklAuthParam === 'success') checkSimklStatus();
      else setSimklAuthError('SIMKL authentication failed. Please try again.');
      const { simkl_auth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
  }, [router.isReady, router.query, router]);

  // Load animes when filters change
```

with just:

```tsx
  // Load animes when filters change
```

Then delete the entire block of extracted handlers — everything from `// Auth handlers` through the end of `handleHistoricalCrawl` (this is lines 171-300 of the original file: `handleConnect`, `handleDisconnect`, `handleSimklConnect`, `handleSimklDisconnect`, `handleSimklSync`, `handleSync`, `handleBigSync`, `handleHistoricalCrawl`), since those now come from `useConnections` (renamed via destructuring in Step 1). Leave everything from `// Filter handlers - update URL` (`handleStatusFilterChange` onward) untouched.

- [ ] **Step 3: Verify no leftover references**

Run:
```bash
grep -n "checkAuthStatus\|checkSimklStatus\|fetchHistoricalStats\|useRouter" src/pages/index.tsx
```
Expected: no matches (all were either removed or moved into `useConnections.ts`). If `useRouter`/`router` is still referenced elsewhere in the file (it isn't — only the OAuth-callback effect used it), keep the import; otherwise the `useRouter` import and `const router = useRouter()` line should already be gone from Step 1's replacement.

- [ ] **Step 4: Verify build and behavior**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

Run: `npm run dev`, load `/`, and manually confirm no regression:
1. MAL auth state, connect/disconnect still work from the sidebar.
2. SIMKL auth state, connect/disconnect still work.
3. Sync / Big Sync / Crawl History buttons still work and still refresh the anime list afterward (via `onDataChanged: loadAnimes`).
4. Historical crawl stats still display correctly in the sidebar.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.tsx
git commit -m "Refactor index.tsx to use shared useConnections hook"
```

---

## Self-Review Notes

- **Spec coverage:** All spec sections map to tasks — storage module + API (Task 1), every instrumentation point listed in the spec (Tasks 2-8), `ConnectionLogPanel` (Task 9), `useConnections` hook (Task 10), `/connections` page (Task 11), nav link (Task 12), `index.tsx` hook-based refactor with no behavior change (Task 13).
- **No placeholders:** every step has concrete, complete code; no "TBD"/"similar to Task N" shortcuts.
- **Type consistency:** `useConnections()`'s return shape (Task 10) is used verbatim by both `connections.tsx` (Task 11) and `index.tsx` (Task 13, via renaming destructure). `LogEntry`/`LogSource`/`LogLevel` (Task 1) match the client-side re-declared type in `ConnectionLogPanel` (Task 9) and the `detail` fields populated by each instrumentation task.
- **Scope:** single cohesive feature (UI reorg + observability), no unrelated refactors introduced.
