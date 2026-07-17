import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useT, type TranslationKey } from '@/lib/i18n';
import styles from './FirstRunOnboarding.module.css';

/**
 * First-run onboarding panel, shown by index.tsx instead of the anime list
 * when the store is genuinely empty (registry count 0 — see the gate there).
 * Shows where data will land (resolved data path + settings link) and offers
 * to seed the catalog via the AniList bulk crawl (`scope: 'bulk'`), with a
 * progress bar fed by polling the connection log's per-season entries.
 */

// Local mirror of the log entry shape (same pattern as ConnectionLogPanel —
// @/lib/connectionLog is fs-bound and must not be imported client-side).
interface LogEntry {
  id: number;
  source: string;
  level: 'info' | 'success' | 'error';
  message: string;
  detail?: Record<string, unknown>;
}

interface CrawlProgress {
  seasonIndex: number;
  totalSeasons: number;
  season?: string;
  year?: number;
}

type Phase = 'idle' | 'starting' | 'crawling' | 'done' | 'error';

const POLL_INTERVAL_MS = 2000;

interface FirstRunOnboardingProps {
  /** Called once the bulk crawl completes so the page can flip to the list. */
  onCatalogLoaded: () => void;
}

export default function FirstRunOnboarding({ onCatalogLoaded }: FirstRunOnboardingProps) {
  const t = useT();
  const [dataPath, setDataPath] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [titlesLoaded, setTitlesLoaded] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  // Log entries strictly after this id belong to OUR crawl — guards against a
  // stale success/error from an earlier crawl (LOGS_PATH survives a data reset).
  const baselineIdRef = useRef(0);

  // Resolved data path for the "your data will be saved here" line.
  useEffect(() => {
    fetch('/api/anime/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(resp => setDataPath(resp?.bootstrap?.dataPath?.resolved ?? null))
      .catch(() => setDataPath(null));
  }, []);

  // Reload-mid-crawl: if a crawl is already running, resume the progress view.
  // Baseline = the last "crawl started" entry, so earlier terminal entries
  // from previous crawls are never mistaken for ours.
  useEffect(() => {
    (async () => {
      try {
        const stats = await fetch('/api/anime/anilist/catalog-crawl').then(r => r.json());
        if (!stats?.crawlRunning) return;
        const log = await fetch('/api/anime/connection-log').then(r => r.json());
        const started = ((log?.entries ?? []) as LogEntry[])
          .filter(e => e.source === 'anilist-catalog-crawl' && e.message.includes('crawl started'))
          .reduce<number>((max, e) => Math.max(max, e.id), 0);
        baselineIdRef.current = Math.max(0, started - 1);
        setPhase('crawling');
      } catch {
        // non-critical — stay on the idle view
      }
    })();
  }, []);

  const startCrawl = useCallback(async () => {
    setPhase('starting');
    setErrorMessage('');
    try {
      // Snapshot the current log head BEFORE starting, so polling only reads
      // entries our crawl appended.
      const log = await fetch('/api/anime/connection-log').then(r => r.json()).catch(() => null);
      baselineIdRef.current = ((log?.entries ?? []) as LogEntry[]).reduce<number>(
        (max, e) => Math.max(max, e.id),
        0
      );
      const res = await fetch('/api/anime/anilist/catalog-crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'bulk' }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setProgress(null);
      setTitlesLoaded(0);
      setPhase('crawling');
    } catch {
      setPhase('error');
      setErrorMessage(t('onboarding.startFailed'));
    }
  }, [t]);

  // Progress polling while the crawl runs.
  useEffect(() => {
    if (phase !== 'crawling') return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/anime/connection-log?afterId=${baselineIdRef.current}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const entries = ((data?.entries ?? []) as LogEntry[]).filter(
          e => e.source === 'anilist-catalog-crawl'
        );
        if (entries.length === 0) return;

        const last = entries.reduce((a, b) => (b.id > a.id ? b : a));
        const loaded = entries.reduce(
          (sum, e) => sum + (typeof e.detail?.titles === 'number' ? e.detail.titles : 0),
          0
        );
        if (cancelled) return;
        setTitlesLoaded(loaded);

        if (last.level === 'error') {
          setPhase('error');
          setErrorMessage(t('onboarding.crawlFailed'));
          return;
        }
        if (last.level === 'success') {
          setProgress(p => (p ? { ...p, seasonIndex: p.totalSeasons } : p));
          setPhase('done');
          // Let the full bar register before flipping to the list.
          setTimeout(() => onCatalogLoaded(), 900);
          return;
        }
        const d = last.detail;
        if (typeof d?.seasonIndex === 'number' && typeof d?.totalSeasons === 'number') {
          setProgress({
            seasonIndex: d.seasonIndex,
            totalSeasons: d.totalSeasons,
            season: typeof d.season === 'string' ? d.season : undefined,
            year: typeof d.year === 'number' ? d.year : undefined,
          });
        }
      } catch {
        // transient poll failure — keep polling
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, onCatalogLoaded, t]);

  const pct = phase === 'done'
    ? 100
    : progress
      ? Math.round((progress.seasonIndex / progress.totalSeasons) * 100)
      : 0;
  const seasonLabel = progress?.season
    ? `${t(`seasonName.${progress.season}` as TranslationKey)} ${progress.year ?? ''}`.trim()
    : null;
  const showProgress = phase === 'crawling' || phase === 'done';

  return (
    <div className={styles.wrap}>
      <div className={styles.panel}>
        <h1 className={styles.title}>{t('onboarding.title')}</h1>
        <p className={styles.intro}>{t('onboarding.intro')}</p>

        <p className={styles.pathLine}>
          {t('onboarding.dataPath')}{' '}
          <code className={styles.path}>{dataPath ?? '…'}</code>
        </p>
        <p className={styles.settingsLine}>
          {t('onboarding.changePrefix')}{' '}
          <Link href="/settings" className={styles.settingsLink}>
            {t('onboarding.settingsLink')}
          </Link>
          .
        </p>

        {!showProgress && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.loadButton}
              onClick={startCrawl}
              disabled={phase === 'starting'}
            >
              {phase === 'starting' ? t('onboarding.starting') : t('onboarding.loadButton')}
            </button>
            <p className={styles.hint}>{t('onboarding.loadHint')}</p>
            {phase === 'error' && <p className={styles.error}>{errorMessage}</p>}
          </div>
        )}

        {showProgress && (
          <div className={styles.progressBlock}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${pct}%` }} />
            </div>
            <p className={styles.progressLabel}>
              {phase === 'done'
                ? t('onboarding.done')
                : progress
                  ? t('onboarding.progressSeason', {
                      index: String(progress.seasonIndex),
                      total: String(progress.totalSeasons),
                      season: seasonLabel ?? '…',
                    })
                  : t('onboarding.starting')}
            </p>
            {titlesLoaded > 0 && (
              <p className={styles.titlesCount}>
                {t('onboarding.titlesLoaded', { count: String(titlesLoaded) })}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
