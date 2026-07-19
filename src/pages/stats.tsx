/**
 * "/stats" — repartition of the statused list across six dimensions.
 *
 * Its own route with its own lean URL state, for the same reason /tier and
 * /quick-rate are: this is a read-only analysis surface, not a filter
 * combination of the main list, and its state (a dimension + a status scope)
 * has no business in `AnimeFiltersState`.
 *
 * The heavy lifting is server-side (`/api/anime/stats`) — see that route for
 * why. The page only renders the six top-50 lists it is handed, and offers the
 * cast sweep that fills the two AniList-only dimensions.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Button } from '@/components/shared';
import { useStatsUrlState } from '@/hooks';
import { useT, TranslationKey } from '@/lib/i18n';
import { STATS_DIMENSIONS, type StatEntry, type StatsDimension } from '@/lib/stats';
import type { StatsApiResponse } from '@/pages/api/anime/stats';

// Same five statuses the rest of the app knows. Unlike the tier board,
// `plan_to_watch` IS offered: you can legitimately ask what your backlog is
// made of, even though you can't rate it.
const STATUSES = ['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch'] as const;

/** The two dimensions that depend on the lazily-filled cast slice. */
const CAST_BACKED: StatsDimension[] = ['seiyuu', 'producers'];

interface CastCoverage {
  statused: number;
  filled: number;
  missing: number;
  sweepRunning: boolean;
}

/** Initials fallback for a seiyuu with no usable portrait (AniList's grey silhouette is stripped upstream). */
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

export default function StatsPage() {
  const t = useT();
  const { state, update, isReady } = useStatsUrlState();

  const [data, setData] = useState<StatsApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [coverage, setCoverage] = useState<CastCoverage | null>(null);
  const [sweepStarted, setSweepStarted] = useState(false);

  const statusKey = state.statuses.join(',');

  const loadStats = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusKey) params.set('status', statusKey);
      const res = await fetch(`/api/anime/stats?${params.toString()}`);
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
    } catch {
      setError(t('stats.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [statusKey, t]);

  const loadCoverage = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/anilist/cast-sweep');
      if (res.ok) setCoverage(await res.json());
    } catch {
      // Coverage is advisory — a failure here must not blank the stats.
    }
  }, []);

  useEffect(() => {
    if (!isReady) return;
    void loadStats();
  }, [isReady, loadStats]);

  useEffect(() => {
    if (!isReady) return;
    void loadCoverage();
  }, [isReady, loadCoverage]);

  // While the sweep runs, poll coverage; refresh the stats themselves only once
  // it finishes, so the lists don't reshuffle under the user every few seconds.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (!coverage?.sweepRunning) {
      if (wasRunning.current) {
        wasRunning.current = false;
        void loadStats();
      }
      return;
    }
    wasRunning.current = true;
    const timer = setTimeout(() => { void loadCoverage(); }, 5000);
    return () => clearTimeout(timer);
  }, [coverage, loadCoverage, loadStats]);

  const startSweep = useCallback(async () => {
    setSweepStarted(true);
    try {
      await fetch('/api/anime/anilist/cast-sweep', { method: 'POST' });
      await loadCoverage();
    } catch {
      setSweepStarted(false);
    }
  }, [loadCoverage]);

  const toggleStatus = (status: string) => {
    const next = state.statuses.includes(status)
      ? state.statuses.filter(s => s !== status)
      : [...state.statuses, status];
    update({ statuses: next });
  };

  const current = data?.dimensions[state.dimension];
  const entries = current?.entries ?? [];
  const max = entries[0]?.count ?? 0;
  const showCoverageNotice =
    CAST_BACKED.includes(state.dimension) && !!coverage && coverage.missing > 0;

  // No <Layout> here — `_app.tsx` already wraps every page in it.
  return (
    <>
      <Head>
        <title>{t('stats.pageTitle')}</title>
      </Head>

      <div className="stats-page">
        <header className="stats-header">
          <div>
            <h1>{t('stats.heading')}</h1>
            {data && (
              <p className="stats-sub">{t('stats.subtitle', { count: String(data.total) })}</p>
            )}
          </div>
          <div className="stats-statuses">
            <span className="stats-label">{t('stats.statuses')}</span>
            <button
              type="button"
              className={`chip ${state.statuses.length === 0 ? 'on' : ''}`}
              onClick={() => update({ statuses: [] })}
            >
              {t('stats.allStatuses')}
            </button>
            {STATUSES.map(status => (
              <button
                key={status}
                type="button"
                className={`chip ${state.statuses.includes(status) ? 'on' : ''}`}
                onClick={() => toggleStatus(status)}
              >
                {t(`statusShort.${status}` as TranslationKey)}
              </button>
            ))}
          </div>
        </header>

        <nav className="stats-tabs">
          {STATS_DIMENSIONS.map(dimension => (
            <button
              key={dimension}
              type="button"
              className={`tab ${state.dimension === dimension ? 'on' : ''}`}
              onClick={() => update({ dimension })}
            >
              {t(`stats.dim.${dimension}` as TranslationKey)}
            </button>
          ))}
        </nav>

        {showCoverageNotice && (
          <div className="stats-notice">
            <span>
              {sweepStarted || coverage!.sweepRunning
                ? t('stats.castFillStarted', {
                    minutes: String(Math.max(1, Math.round((coverage!.missing * 2.1) / 60))),
                  })
                : t('stats.castMissing', { missing: String(coverage!.missing) })}
            </span>
            {!sweepStarted && !coverage!.sweepRunning && (
              <Button variant="secondary" onClick={startSweep}>
                {t('stats.castFill')}
              </Button>
            )}
          </div>
        )}

        {error && <div className="stats-error">{error}</div>}
        {isLoading && !data && <div className="stats-empty">{t('common.loading')}</div>}

        {current && entries.length === 0 && !isLoading && (
          <div className="stats-empty">{t('stats.empty')}</div>
        )}

        {current && entries.length > 0 && (
          <>
            <div className="stats-meta">
              <span>{t('stats.topOf', { shown: String(entries.length), total: String(current.distinct) })}</span>
              <span>·</span>
              <span>{t('stats.coverage', { covered: String(current.covered), total: String(data!.total) })}</span>
            </div>

            <ol className="stats-list">
              {entries.map((entry, index) => (
                <Row
                  key={entry.key}
                  entry={entry}
                  rank={index + 1}
                  max={max}
                  showPhoto={state.dimension === 'seiyuu'}
                  linkToCredits={state.dimension === 'staff'}
                />
              ))}
            </ol>
          </>
        )}
      </div>

      <style jsx>{`
        .stats-page { padding: 1rem 0 3rem; }
        .stats-header {
          display: flex; flex-wrap: wrap; gap: 1rem 2rem;
          align-items: flex-start; justify-content: space-between; margin-bottom: 1.25rem;
        }
        h1 { margin: 0; font-size: 1.6rem; color: var(--text-primary); }
        .stats-sub { margin: 0.25rem 0 0; color: var(--text-secondary); font-size: 0.9rem; }
        .stats-statuses { display: flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
        .stats-label { color: var(--text-secondary); font-size: 0.85rem; margin-right: 0.2rem; }
        .chip {
          background: var(--bg-tertiary); color: var(--text-secondary);
          border: 1px solid var(--border-color); border-radius: 999px;
          padding: 0.25rem 0.7rem; font-size: 0.82rem; cursor: pointer;
        }
        .chip:hover { color: var(--text-primary); }
        .chip.on { background: var(--accent-color); border-color: var(--accent-color); color: #fff; }
        .stats-tabs {
          display: flex; flex-wrap: wrap; gap: 0.35rem;
          border-bottom: 1px solid var(--border-color); margin-bottom: 1rem;
        }
        .tab {
          background: none; border: none; border-bottom: 2px solid transparent;
          color: var(--text-secondary); padding: 0.55rem 0.9rem;
          font-size: 0.95rem; cursor: pointer;
        }
        .tab:hover { color: var(--text-primary); }
        .tab.on { color: var(--accent-color); border-bottom-color: var(--accent-color); }
        .stats-notice {
          display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center;
          justify-content: space-between; background: var(--bg-secondary);
          border: 1px solid var(--border-color); border-radius: 8px;
          padding: 0.7rem 0.9rem; margin-bottom: 1rem;
          color: var(--text-secondary); font-size: 0.88rem;
        }
        .stats-meta {
          display: flex; gap: 0.5rem; color: var(--text-secondary);
          font-size: 0.82rem; margin-bottom: 0.6rem;
        }
        .stats-error, .stats-empty {
          padding: 1.5rem; text-align: center; color: var(--text-secondary);
        }
        .stats-error { color: var(--error-color, #e06c75); }
        .stats-list { list-style: none; margin: 0; padding: 0; }
      `}</style>
    </>
  );
}

interface RowProps {
  entry: StatEntry;
  rank: number;
  max: number;
  showPhoto: boolean;
  linkToCredits: boolean;
}

/**
 * One ranked row. The bar is scaled against the TOP entry's count, not against
 * the title total — at 50 rows the leader is often well under 50%, and scaling
 * to the total would render every bar as an unreadable sliver.
 */
function Row({ entry, rank, max, showPhoto, linkToCredits }: RowProps) {
  const t = useT();
  const width = max > 0 ? Math.max(2, (entry.count / max) * 100) : 0;

  const label = linkToCredits && entry.id !== undefined
    ? <Link href={`/credits/staff/${entry.id}`} className="name-link">{entry.name}</Link>
    : <span className="name-text">{entry.name}</span>;

  return (
    <li className="row">
      <span className="rank">{rank}</span>

      {showPhoto && (
        <span className="photo">
          {entry.image
            ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={entry.image} alt={entry.name} loading="lazy" />
            : <span className="photo-fallback">{initials(entry.name)}</span>}
        </span>
      )}

      <span className="body">
        <span className="line">
          {label}
          <span className="numbers">
            <strong>{entry.pct}%</strong>
            <span className="count">
              {entry.count === 1
                ? t('stats.countTitle')
                : t('stats.countTitles', { count: String(entry.count) })}
            </span>
          </span>
        </span>
        {entry.detail && <span className="detail">{entry.detail}</span>}
        <span className="bar"><span className="fill" style={{ width: `${width}%` }} /></span>
      </span>

      <style jsx>{`
        .row {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.5rem 0.25rem;
          border-bottom: 1px solid var(--border-color);
        }
        .rank {
          width: 2rem; flex-shrink: 0; text-align: right;
          color: var(--text-secondary); font-size: 0.85rem; font-variant-numeric: tabular-nums;
        }
        .photo { width: 44px; height: 44px; flex-shrink: 0; }
        .photo :global(img) {
          width: 44px; height: 44px; object-fit: cover;
          border-radius: 50%; background: var(--bg-tertiary);
        }
        .photo-fallback {
          width: 44px; height: 44px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          background: var(--bg-tertiary); color: var(--text-secondary); font-size: 0.8rem;
        }
        .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.25rem; }
        .line { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
        .line :global(.name-text), .line :global(.name-link) {
          color: var(--text-primary); font-size: 0.95rem;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .line :global(.name-link) { text-decoration: none; }
        .line :global(.name-link):hover { color: var(--accent-color); text-decoration: underline; }
        .numbers {
          display: flex; align-items: baseline; gap: 0.5rem; flex-shrink: 0;
          font-variant-numeric: tabular-nums;
        }
        .numbers strong { color: var(--accent-color); font-size: 0.95rem; }
        .count { color: var(--text-secondary); font-size: 0.78rem; }
        .detail {
          color: var(--text-secondary); font-size: 0.78rem;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .bar { display: block; height: 4px; background: var(--bg-tertiary); border-radius: 2px; }
        .fill { display: block; height: 100%; background: var(--accent-color); border-radius: 2px; }
      `}</style>
    </li>
  );
}
