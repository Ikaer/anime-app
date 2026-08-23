/**
 * /activity — « Fil d'activité ».
 *
 * A reverse-chronological read of when you last watched each title, grouped by
 * day. The main list cannot express it: `watched_at` is not one of its sort
 * columns, and "group by day" is not a filter combination.
 *
 * Read-only, like /catch-up: nothing here writes. A row ends at the detail page,
 * which is where a status or a score is set.
 *
 * ⚠️ **Days are grouped CLIENT-side, on purpose.** `watched_at` is a UTC
 * instant, and only the browser knows the reader's timezone — grouping on the
 * server would file a 23:30Z session under the wrong day for anyone east of
 * Greenwich, which is every user of this app. The API therefore returns a flat,
 * already-sorted list and this page cuts it into days. A day can straddle a page
 * boundary; that just repeats its header on the next page, which is correct.
 */
import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { AnimePageLayout } from '@/components/anime';
import { RecoFiltersSection } from '@/components/anime/sidebar';
import filterStyles from '@/components/anime/sidebar/RecoFiltersSection.module.css';
import { CollapsibleSection } from '@/components/shared';
import { useActivityUrlState, toActivityQuery } from '@/hooks';
import { useProviderStatuses } from '@/hooks/useProviderStatuses';
import { useT, useI18n, TranslationKey } from '@/lib/i18n';
import type { ActivityEntry, ActivityResponse } from './api/anime/activity';

/** The statuses a watch date can appear on; `plan_to_watch` never has one. */
const STATUSES = ['watching', 'completed', 'on_hold', 'dropped'];

/** Local-midnight key for an instant, so grouping follows the reader's day. */
function localDayKey(iso: string): string {
  const d = new Date(iso);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export default function ActivityPage() {
  const t = useT();
  const { lang } = useI18n();
  const { state, update, isReady } = useActivityUrlState();

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [undated, setUndated] = useState(0);
  const [available, setAvailable] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ filters: true, status: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  // The feed is only as fresh as the last SIMKL delta, and that is the one
  // provider that supplies its clock — so the sync belongs on this page, not
  // only on /connections. `connected` is token PRESENCE, the same predicate the
  // write path uses, so the button cannot disagree with what the sync will do.
  const { byId, refresh: refreshProviders } = useProviderStatuses();
  const simklEnabled = !!byId.simkl?.connected;
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  // Bumped after a sync so the feed refetches without the filters moving.
  const [reloadToken, setReloadToken] = useState(0);

  const query = isReady ? toActivityQuery(state) : null;

  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/anime/activity${query ? `?${query}` : ''}`);
        if (!res.ok) throw new Error('load failed');
        const data: ActivityResponse = await res.json();
        if (cancelled) return;
        setEntries(data.entries || []);
        setTotal(data.total || 0);
        setUndated(data.undated || 0);
        setAvailable(data.available !== false);
        setTotalPages(data.totalPages || 1);
        // The server clamps a stale page number; mirror it back so the URL and
        // the pager agree on where we actually landed.
        if (typeof data.page === 'number' && data.page !== state.page) update({ page: data.page });
      } catch {
        if (!cancelled) setError(t('activity.loadFailed'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, reloadToken]);

  const handleSimklSync = async () => {
    if (!simklEnabled || isSyncing) return;
    setIsSyncing(true);
    setSyncMessage('');
    try {
      const res = await fetch('/api/anime/simkl/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || 'sync failed');
      setSyncMessage(t('activity.syncDone', { added: data.added ?? 0, removed: data.removed ?? 0 }));
      // The delta rewrites `personal/simkl.json`, which bumps its mtime and so
      // invalidates the row cache — the refetch below sees the new dates.
      setReloadToken(n => n + 1);
      void refreshProviders();
    } catch (err) {
      setSyncMessage(err instanceof Error && err.message !== 'sync failed'
        ? err.message
        : t('activity.syncFailed'));
    } finally {
      setIsSyncing(false);
    }
  };

  // Cut the flat list into local days. Order is preserved from the server, so
  // this never re-sorts — it only inserts the boundaries.
  const days = useMemo(() => {
    const out: { key: string; entries: ActivityEntry[] }[] = [];
    for (const e of entries) {
      const key = localDayKey(e.watchedAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.entries.push(e);
      else out.push({ key, entries: [e] });
    }
    return out;
  }, [entries]);

  const dayLabel = (key: string): string => {
    const today = localDayKey(new Date().toISOString());
    if (key === today) return t('activity.today');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (key === localDayKey(yesterday.toISOString())) return t('activity.yesterday');
    // `key` is a local-midnight calendar date; parsing it back with explicit
    // parts avoids `new Date('YYYY-MM-DD')` being read as UTC and shifting a day.
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  };

  const timeLabel = (iso: string): string =>
    new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'fr-FR', {
      hour: '2-digit', minute: '2-digit',
    });

  const toggleStatus = (s: string, on: boolean) => {
    const next = on ? [...state.statuses, s] : state.statuses.filter(x => x !== s);
    update({ statuses: next });
  };

  const goToPage = (p: number) => {
    update({ page: p });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderRow = (e: ActivityEntry) => (
    <a
      key={`${e.id}-${e.watchedAt}`}
      className="row"
      href={`/anime/${e.id}`}
      target="_blank"
      rel="noopener noreferrer"
      title={e.title}
    >
      <span className="time">{timeLabel(e.watchedAt)}</span>
      <span className="thumb">
        {e.picture
          ? <img src={e.picture} alt="" loading="lazy" />
          : <span className="noimg">{e.title.slice(0, 2)}</span>}
      </span>
      <span className="body">
        <span className="title">{e.title}</span>
        <span className="meta">
          {e.year ? `${e.year}` : ''}
          {e.mediaType ? `${e.year ? ' · ' : ''}${e.mediaType.toUpperCase()}` : ''}
          {e.mean ? ` · ★ ${e.mean.toFixed(2)}` : ''}
        </span>
      </span>
      <span className="tail">
        {e.status && (
          <span className={`status ${e.status}`}>
            {t(`statusShort.${e.status}` as TranslationKey)}
          </span>
        )}
        {typeof e.progress === 'number' && (
          <span className="prog">
            {e.progress}{e.totalEpisodes ? ` / ${e.totalEpisodes}` : ''}
          </span>
        )}
        {e.score ? <span className="score">{e.score}</span> : null}
      </span>
    </a>
  );

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection
        title={t('activity.statusSection')}
        isExpanded={expanded.status}
        onToggle={() => toggle('status')}
      >
        <p className="af-hint">{t('activity.intro')}</p>
        {STATUSES.map(s => (
          <label key={s} className={filterStyles.checkboxLabel}>
            <input
              type="checkbox"
              checked={state.statuses.includes(s)}
              onChange={ev => toggleStatus(s, ev.target.checked)}
            /> {t(`statusShort.${s}` as TranslationKey)}
          </label>
        ))}
        <p className="af-hint">{t('activity.statusHint')}</p>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('section.filters')}
        isExpanded={expanded.filters}
        onToggle={() => toggle('filters')}
      >
        <RecoFiltersSection
          search={state.search}
          onSearchChange={(v: string) => update({ search: v })}
          mediaTypes={state.mediaTypes}
          onMediaTypesChange={(v: string[]) => update({ mediaTypes: v })}
          minScore={state.minScore}
          onMinScoreChange={(v: number | null) => update({ minScore: v })}
          maxScore={state.maxScore}
          onMaxScoreChange={(v: number | null) => update({ maxScore: v })}
          minYear={state.minYear}
          maxYear={state.maxYear}
          onYearChange={(min: number | null, max: number | null) => update({ minYear: min, maxYear: max })}
        />
      </CollapsibleSection>
    </div>
  );

  return (
    <>
      <Head>
        <title>{t('activity.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="af-main">
          {error && <div className="error-banner">{error} <button onClick={() => setError('')}>×</button></div>}

          <div className="af-header">
            <h1 className="af-title">{t('nav.activity')}</h1>
            <span className="af-count">
              {t('activity.summary', { count: total })}
              {undated > 0 ? ` — ${t('activity.undated', { count: undated })}` : ''}
              {totalPages > 1
                ? ` — ${t('activity.pageOf', { page: state.page + 1, total: totalPages })}`
                : ''}
            </span>
            {simklEnabled && (
              <span className="af-sync">
                <button type="button" onClick={handleSimklSync} disabled={isSyncing}>
                  {isSyncing ? t('activity.syncing') : t('activity.syncSimkl')}
                </button>
                {syncMessage && <span className="af-sync-msg">{syncMessage}</span>}
              </span>
            )}
          </div>

          {!isReady || isLoading ? (
            <div className="loading-state">{t('common.loading')}</div>
          ) : !available ? (
            // Distinct from "no results": this install has no clock at all, which
            // is a setup fact rather than an empty filter.
            <div className="loading-state">
              <p>{t('activity.unavailable')}</p>
              <p className="af-hint">{t('activity.unavailableHint')}</p>
            </div>
          ) : days.length === 0 ? (
            <div className="loading-state">{t('activity.empty')}</div>
          ) : (
            <>
              {days.map(d => (
                <section key={d.key} className="day">
                  <h2 className="day-head">
                    {dayLabel(d.key)}
                    <span className="day-count">{d.entries.length}</span>
                  </h2>
                  <div className="rows">{d.entries.map(renderRow)}</div>
                </section>
              ))}

              {totalPages > 1 && (
                <div className="pager">
                  <button disabled={state.page === 0} onClick={() => goToPage(state.page - 1)}>
                    ‹ {t('activity.prevPage')}
                  </button>
                  <span>{t('activity.pageOf', { page: state.page + 1, total: totalPages })}</span>
                  <button
                    disabled={state.page >= totalPages - 1}
                    onClick={() => goToPage(state.page + 1)}
                  >
                    {t('activity.nextPage')} ›
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </AnimePageLayout>

      {/* Scoped block: ONLY elements that appear in this component's own
          `return`. styled-jsx suffixes every compound in a selector chain
          (`.af-main.jsx-x .row.jsx-x`), so anything rendered from the
          `renderRow` helper or the hoisted `sidebar` const — neither of which
          carries the scope class — can never match here. Those live in the
          global block below, exactly as catch-up.tsx and tier.tsx do it. */}
      <style jsx>{`
        .af-main { padding: 1rem 1.25rem 3rem; }
        .af-header {
          display: flex; align-items: baseline; gap: 1rem;
          flex-wrap: wrap; margin-bottom: 1.25rem;
        }
        .af-title { margin: 0; font-size: 1.5rem; color: var(--text-primary); }
        .af-count { color: var(--text-secondary); font-size: 0.9rem; }
        .af-sync { display: inline-flex; align-items: center; gap: 0.6rem; }
        .af-sync button {
          background: var(--bg-secondary, #2a2e34); color: var(--text-primary);
          border: 1px solid var(--border-color, #33373d);
          border-radius: 6px; padding: 0.3rem 0.7rem; cursor: pointer; font-size: 0.85rem;
        }
        .af-sync button:hover:not(:disabled) { border-color: var(--accent-primary); }
        .af-sync button:disabled { opacity: 0.5; cursor: default; }
        .af-sync-msg { color: var(--text-secondary); font-size: 0.8rem; }

        .day { margin-bottom: 1.75rem; }
        .day-head {
          display: flex; align-items: center; gap: 0.6rem;
          margin: 0 0 0.6rem; padding-bottom: 0.4rem;
          border-bottom: 1px solid var(--border-color, #33373d);
          font-size: 1rem; font-weight: 600;
          color: var(--text-primary);
          position: sticky; top: 0; z-index: 1;
          background: var(--bg-primary, #1b1e23);
        }
        /* French writes weekdays and months lowercase, so only the first letter
           is lifted — \`text-transform: capitalize\` would give "Vendredi 21 Août". */
        .day-head::first-letter { text-transform: uppercase; }
        .day-count {
          font-size: 0.75rem; font-weight: 500;
          color: var(--text-secondary);
          background: var(--bg-secondary, #2a2e34);
          border-radius: 999px; padding: 0.1rem 0.5rem;
        }
        .rows { display: flex; flex-direction: column; gap: 0.3rem; }

        .pager {
          display: flex; align-items: center; justify-content: center; gap: 1rem;
          margin-top: 1.5rem; color: var(--text-secondary);
        }
        .pager button {
          background: var(--bg-secondary, #2a2e34); color: var(--text-primary);
          border: 1px solid var(--border-color, #33373d);
          border-radius: 6px; padding: 0.35rem 0.8rem; cursor: pointer;
        }
        .pager button:disabled { opacity: 0.4; cursor: default; }
        .loading-state { padding: 2rem; text-align: center; color: var(--text-secondary); }
      `}</style>

      {/* Global block: everything rendered OUTSIDE the returned tree — the feed
          rows (`renderRow`) and the sidebar hints (the hoisted `sidebar` const).
          The page-unique \`.af-\` prefix is what scopes these, since styled-jsx
          cannot. Same arrangement as \`.cu-main\` in catch-up.tsx. */}
      <style jsx global>{`
        .af-main .row {
          display: flex; align-items: center; gap: 0.75rem;
          padding: 0.4rem 0.5rem; border-radius: 6px;
          text-decoration: none; color: inherit;
          transition: background 0.12s ease;
        }
        .af-main .row:hover { background: var(--bg-secondary, #2a2e34); }
        .af-main .row .time {
          flex: 0 0 3.2rem; font-variant-numeric: tabular-nums;
          font-size: 0.85rem; color: var(--text-secondary);
        }
        .af-main .row .thumb { flex: 0 0 auto; display: block; width: 40px; height: 57px; }
        .af-main .row .thumb img {
          width: 100%; height: 100%; object-fit: cover; border-radius: 4px; display: block;
        }
        .af-main .row .noimg {
          display: flex; align-items: center; justify-content: center;
          width: 100%; height: 100%; border-radius: 4px;
          background: var(--bg-secondary, #2a2e34);
          color: var(--text-secondary); font-size: 0.8rem;
        }
        .af-main .row .body {
          flex: 1 1 auto; min-width: 0;
          display: flex; flex-direction: column; gap: 0.15rem;
        }
        .af-main .row .title {
          color: var(--text-primary); font-size: 0.95rem;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .af-main .row:hover .title { color: var(--accent-primary); }
        .af-main .row .meta { color: var(--text-muted, #8b929c); font-size: 0.78rem; }
        .af-main .row .tail { flex: 0 0 auto; display: flex; align-items: center; gap: 0.5rem; }
        .af-main .row .status {
          font-size: 0.72rem; padding: 0.1rem 0.45rem; border-radius: 999px;
          background: var(--bg-secondary, #2a2e34); color: var(--text-secondary);
          white-space: nowrap;
        }
        .af-main .row .status.watching { background: hsl(213, 45%, 30%); color: #cfe2ff; }
        .af-main .row .status.completed { background: hsl(140, 40%, 26%); color: #ccf0d8; }
        .af-main .row .status.dropped { background: hsl(0, 40%, 30%); color: #f5d0d0; }
        .af-main .row .status.on_hold { background: hsl(38, 45%, 28%); color: #f7e3c4; }
        .af-main .row .prog {
          font-variant-numeric: tabular-nums; font-size: 0.8rem;
          color: var(--text-secondary); white-space: nowrap;
          min-width: 4.2rem; text-align: right;
        }
        .af-main .row .score {
          font-weight: 600; font-size: 0.85rem; color: var(--text-primary);
          background: var(--bg-secondary, #2a2e34);
          border-radius: 4px; padding: 0.05rem 0.35rem;
          min-width: 1.6rem; text-align: center;
        }

        /* The design target is the TV at 4K/300% zoom (~1280 CSS px), where the
           row is a comfortable single line. Below ~760px — a narrow window or a
           side panel — the title column gets squeezed to zero width and the row
           grows to ~160px of wrapped text, so the metadata drops to its own
           line instead. */
        @media (max-width: 760px) {
          .af-main .row { flex-wrap: wrap; }
          .af-main .row .body { flex: 1 1 60%; }
          .af-main .row .tail { margin-left: calc(3.2rem + 40px + 1.5rem); }
        }

        .af-hint {
          color: var(--text-secondary); font-size: 0.8rem; margin: 0.4rem 0 0; line-height: 1.4;
        }
      `}</style>
    </>
  );
}
