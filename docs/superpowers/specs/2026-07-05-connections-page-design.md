# Connections & Sync Log page

## Problem

The main `/` page and `/recommendations` page sidebars are getting crowded with MAL/SIMKL connect/disconnect buttons and sync triggers (`AccountSection`, `DataSyncSection`, `SimklSection`). There is also no visibility into what happens during syncs beyond a one-line status message, and cron-triggered syncs (`/api/anime/cron-sync`) are completely invisible in the UI today.

## Goals

- A dedicated page holding all connection/sync controls (MAL account, SIMKL account, sync/big-sync/historical-crawl triggers).
- A log window on that page showing live and historical detail of connection/sync activity, including cron-triggered runs.
- Do not remove the existing sidebar sections from the main page for now — this is additive.

## Non-goals

- No change to sync/auth business logic itself — this is UI reorganization + observability only.
- No SSE plumbing for the log (existing big-sync SSE endpoint is left as-is; the log is a separate, simpler polling-based view).
- No log filtering/search UI in v1 — a flat chronological scrollable list is sufficient.

## Architecture

### Shared connections hook

Extract the MAL/SIMKL auth + sync state and handlers currently local to `src/pages/index.tsx` (state: `authState`, `isAuthLoading`, `authError`, `isSyncing`, `isBigSyncing`, `isHistoricalCrawling`, `syncError`, `historicalStats`, `simklConnected`, `simklUser`, `isSimklAuthLoading`, `simklAuthError`, `isSimklSyncing`, `simklSyncMessage`; handlers: `handleConnect`, `handleDisconnect`, `handleSimklConnect`, `handleSimklDisconnect`, `handleSimklSync`, `handleSync`, `handleBigSync`, `handleHistoricalCrawl`, plus the OAuth-callback query-param effect) into a new hook:

```ts
// src/hooks/useConnections.ts
function useConnections(options?: { onDataChanged?: () => void }): {
  authState, isAuthLoading, authError, onConnect, onDisconnect,
  isSyncing, isBigSyncing, isHistoricalCrawling, syncError, historicalStats,
  onSync, onBigSync, onHistoricalCrawl,
  simklConnected, simklUser, isSimklAuthLoading, simklAuthError,
  isSimklSyncing, simklSyncMessage, onSimklConnect, onSimklDisconnect, onSimklSync,
}
```

`onDataChanged` replaces the direct `loadAnimes()` calls currently inline in the handlers — `index.tsx` passes its `loadAnimes`, `connections.tsx` passes nothing (no anime list to refresh there).

Both `index.tsx` and the new `connections.tsx` call this hook. `index.tsx`'s sidebar wiring changes from local state to hook output; the rendered `AccountSection` / `DataSyncSection` / `SimklSection` in the sidebar are unchanged (same props, same components, same location) — purely a state-source swap, nothing removed or moved out of the main page.

### New page: `/connections`

`src/pages/connections.tsx`, using the existing `AnimePageLayout`-style page shell but without the anime table — just a content column with:
1. `AccountSection` (MAL)
2. `SimklSection`
3. `DataSyncSection`
4. `ConnectionLogPanel` (see below)

Added to top nav in `src/components/Layout.tsx` as "Connections" (`/connections`), alongside Anime / Pour toi / Rating Calculator.

### Persistent connection/sync log

New server-only module `src/lib/connectionLog.ts` (separate from `lib/anime.ts` to avoid coupling; uses its own `fs`/`path` against `DATA_PATH`):

```ts
type LogSource = 'mal-auth' | 'simkl-auth' | 'sync' | 'big-sync' | 'historical-crawl' | 'simkl-sync' | 'cron-sync';
type LogLevel = 'info' | 'success' | 'error';

interface LogEntry {
  id: number;
  timestamp: number; // Date.now()
  source: LogSource;
  level: LogLevel;
  message: string;
  detail?: Record<string, unknown>;
}

function appendLog(source: LogSource, level: LogLevel, message: string, detail?: Record<string, unknown>): void;
function getLogEntries(afterId?: number): LogEntry[];
```

Storage file: `connection_log.json` under `DATA_PATH`, shape `{ counter: number, entries: LogEntry[] }`. `counter` is a monotonically increasing id source so client polling cursors stay valid even after the entries array is truncated. On each `appendLog`, entries are capped to the most recent 500 (truncate oldest first), matching the existing cap pattern in `big-sync.ts`'s in-memory progress array.

`appendLog` is best-effort: wrapped in try/catch, failures are swallowed (logged to console only) so a logging hiccup never breaks an actual sync/auth flow.

### API endpoint

`GET /api/anime/connection-log?afterId=<n>` → `src/pages/api/anime/connection-log.ts`. Returns `{ entries: LogEntry[] }`, entries with `id > afterId` (or last ~200 if `afterId` omitted/invalid). Read-only, no POST.

### Instrumentation points (additive `appendLog` calls, no logic changes)

- `src/pages/api/anime/auth.ts`: login initiated, OAuth callback success/failure, logout.
- `src/pages/api/anime/simkl/auth.ts`: same for SIMKL.
- `src/pages/api/anime/sync.ts`: sync start, per-season fetch summary, personal-list sync stats, final summary/error.
- `src/pages/api/anime/big-sync.ts`: the existing `addProgress` callback (already feeding the SSE endpoint) additionally calls `appendLog` for every event — same granularity already computed, reused rather than re-derived.
- `src/lib/anime.ts` `performHistoricalCrawl`: per-batch result (seasons processed, anime synced, remaining).
- `src/pages/api/anime/simkl/sync.ts`: phase + added/removed/skipped from `performSimklSync`'s return value.
- `src/pages/api/anime/cron-sync.ts`: run start, big-sync trigger result, historical-crawl result, auth failure. This is the main payoff — cron runs currently have zero UI visibility.

### `ConnectionLogPanel` component

`src/components/anime/ConnectionLogPanel.tsx`. On mount, fetches `?afterId=0` for initial history, then polls `?afterId=<lastSeenId>` every 2 seconds, appending new entries to local state. Renders a scrollable, monospace, auto-scroll-to-bottom list; entries color-coded by `level` (info/success/error) via CSS custom properties per project convention. Stops polling on unmount (`clearInterval` in cleanup).

## Error handling

- Log write failures: swallowed, console-logged only, never surface to the user or block the underlying operation.
- Log read failures (endpoint): standard 500 JSON error response, consistent with other API handlers.
- `ConnectionLogPanel` polling failures: skip the tick, retry on the next interval (no error banner — this is a secondary/observability UI, not critical path).

## Testing

No test suite in this project (per `CLAUDE.md`). Verification is manual via the dev server:
1. Load `/connections`, confirm nav link, layout, and existing sidebar sections still work identically on `/`.
2. Connect/disconnect MAL and SIMKL from the new page; confirm log entries appear.
3. Run Sync, Big Sync, Crawl History from the new page; confirm granular log entries stream in within ~2s via polling.
4. Confirm `index.tsx`'s sidebar still functions (auth state, sync buttons, historical stats) after the hook extraction — no behavior regression.
