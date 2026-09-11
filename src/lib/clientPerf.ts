/**
 * The browser's half of the perf log (server half: `lib/store/perf.ts`).
 *
 * A page load can be slow in places the server never sees, and a server log
 * alone would read "fast" for every one of them. So a probed load splits its
 * wall time by the browser's own Resource Timing entry for the API call:
 *
 *  - `queueMs`   — `startTime → requestStart`: the request waiting in the browser
 *                  (connection pool, stalled socket, connect);
 *  - `ttfbMs`    — `requestStart → responseStart`: the server's turn, network included;
 *  - `serverMs`  — the server's own handler time, read back from `Server-Timing`,
 *                  so `ttfbMs - serverMs` is time the request spent reaching a
 *                  handler (a blocked event loop shows here);
 *  - `downloadMs`, then `renderMs` (data set → next frame);
 *  - `sinceNavMs` — from the click (Next's `routeChangeStart`) or, on a hard
 *                  load, from the navigation itself: what the owner actually felt.
 *
 * Always logged to the console; POSTed to `/api/anime/perf` only when slow, so
 * `perf.log` collects the loads worth explaining next to the server's `req` lines.
 *
 * Client-safe: no imports, browser globals only, and every call guarded so a
 * missing API degrades to a thinner report rather than a broken page.
 */

/** A load at least this long is reported to the server. */
const REPORT_MS = 1500;

let navStart: number | null = null;

/** Called on Next's `routeChangeStart` (from `_app`): the moment the owner clicked. */
export function markNavigationStart(): void {
  navStart = performance.now();
  try {
    // Posters are resource entries too, and the default buffer (250) fills in a
    // few pages — after which the API call's entry would silently not exist.
    performance.setResourceTimingBufferSize(2000);
  } catch { /* unsupported — probes just lose the split */ }
}

export interface LoadProbe {
  /** Call right after the response's data is in state; measures to the next frame. */
  done(kb?: number): void;
}

/**
 * Start timing one data load. `kind` is `initial` for the page's first fetch
 * (the one the owner waits on) and `reload` for the refreshes after a write.
 */
export function startLoadProbe(page: string, url: string, kind: 'initial' | 'reload'): LoadProbe {
  const t0 = performance.now();
  const clickedAt = kind === 'initial' ? navStart : null;
  navStart = null;

  return {
    done(kb) {
      const dataAt = performance.now();
      requestAnimationFrame(() => setTimeout(() => {
        const paintedAt = performance.now();
        const report: Record<string, number | string> = {
          page,
          url,
          kind,
          fetchMs: dataAt - t0,
          renderMs: paintedAt - dataAt,
          // No click recorded ⇒ a hard load, timed from the navigation itself.
          ...(kind === 'initial' ? { sinceNavMs: paintedAt - (clickedAt ?? 0) } : {}),
          ...(kb !== undefined ? { kb } : {}),
        };
        try {
          const abs = new URL(url, window.location.href).href;
          const entries = performance.getEntriesByName(abs) as PerformanceResourceTiming[];
          const entry = entries[entries.length - 1];
          if (entry && entry.startTime >= t0 - 5) {
            report.queueMs = entry.requestStart - entry.startTime;
            report.connectMs = entry.connectEnd - entry.connectStart;
            report.ttfbMs = entry.responseStart - entry.requestStart;
            report.downloadMs = entry.responseEnd - entry.responseStart;
            const total = entry.serverTiming?.find(s => s.name === 'total');
            if (total) report.serverMs = total.duration;
            const rows = entry.serverTiming?.find(s => s.name === 'rows');
            if (rows?.description) report.rows = rows.description;
          }
          // Keep the buffer from filling with this page's posters.
          performance.clearResourceTimings();
        } catch { /* Resource Timing unavailable — the wall times still stand */ }

        const rounded = Object.fromEntries(
          Object.entries(report).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : v])
        );
        console.info('[perf]', rounded);

        const worst = Math.max(Number(rounded.fetchMs) || 0, Number(rounded.sinceNavMs) || 0);
        if (worst >= REPORT_MS) {
          fetch('/api/anime/perf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rounded),
            keepalive: true,
          }).catch(() => { /* diagnostics must never surface as an error */ });
        }
      }, 0));
    },
  };
}
