import React, { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
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

/**
 * Append only the ids we don't already hold, and return `prev` untouched when
 * there is nothing new — so a redundant tick costs no re-render and no
 * scroll-to-bottom.
 *
 * The panel accumulates across the whole mount while the server only ever hands
 * back `id > afterId`, so in the happy path this filter is a no-op. It is here
 * because the append is the one step that must stay idempotent: two polls that
 * overlap, or a server-side page that overlaps what we already have, would
 * otherwise render the same id twice and break React's keying.
 */
function mergeEntries(prev: LogEntry[], incoming: LogEntry[]): LogEntry[] {
  const seen = new Set(prev.map(e => e.id));
  const added: LogEntry[] = [];
  for (const entry of incoming) {
    // Deduped WITHIN `incoming` too, not just against `prev`: `appendLog` is an
    // unlocked read-modify-write, so two concurrent server-side appends (a cron
    // tick and a hand-pressed sync) can mint the same id twice into the file.
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    added.push(entry);
  }
  return added.length === 0 ? prev : [...prev, ...added];
}

const ConnectionLogPanel: React.FC = () => {
  const t = useT();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const lastIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      // A tick slower than POLL_INTERVAL_MS must not race the next one: both
      // would read the same `lastIdRef`, both would be answered with the same
      // page, and both would append it. Measured on this store (500 entries,
      // ~155KB) with the response held for 5s: three ticks went out at
      // `afterId=0` and the panel rendered 1,500 rows for 500 entries. That
      // needs no StrictMode and no dev server — it reproduces in a production
      // build, and only wants a response slower than the interval, which a cold
      // route compile makes routine and a slow NAS tick can reach. Only React's
      // duplicate-key console warning is development-only; the duplicated rows
      // are not.
      // Skipping a tick never skips an entry: the cursor is `lastIdRef`, so the
      // next poll to complete asks for everything after the last id it stored.
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const res = await fetch(`/api/anime/connection-log?afterId=${lastIdRef.current}`);
        if (!res.ok) return;
        const data = await res.json();
        const newEntries: LogEntry[] = data.entries || [];
        if (cancelled || newEntries.length === 0) return;
        lastIdRef.current = newEntries[newEntries.length - 1].id;
        setEntries(prev => mergeEntries(prev, newEntries));
      } catch {
        // best-effort UI, skip this tick and retry on the next interval
      } finally {
        inFlightRef.current = false;
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
      <h3 className={styles.title}>{t('connLog.title')}</h3>
      <div className={styles.list} ref={listRef}>
        {entries.length === 0 ? (
          <div className={styles.empty}>{t('connLog.empty')}</div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className={`${styles.entry} ${styles[entry.level]}`}>
              <div className={styles.entryHeader}>
                <span className={styles.timestamp}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                <span className={styles.source}>[{entry.source}]</span>
                <span className={styles.message}>{entry.message}</span>
              </div>
              {entry.detail && (
                <div className={styles.detail}>{JSON.stringify(entry.detail)}</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default ConnectionLogPanel;
