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

const ConnectionLogPanel: React.FC = () => {
  const t = useT();
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
