/**
 * /quick-rate — franchise-bulk rating (docs/quickRate/).
 *
 * Solves the two rating-at-scale pains neither the tier board nor the detail
 * page covers: rating a whole **franchise** in one action, and "just put a
 * score, and it counts as watched".
 *
 * Two things make it different from /tier, both deliberate:
 * - **Scope reaches unstatused catalog titles** (the tier board only fetches
 *   already-statused ones), because the unseen seasons of a franchise are
 *   exactly what you want to sweep. That means the whole catalog is in scope, so
 *   grouping + a lean projection happen server-side and **filtering refetches**
 *   instead of running in the browser.
 * - **Rating auto-completes**, page-scoped and opt-out-able. Elsewhere a score
 *   edit stays a score edit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { AnimePageLayout } from '@/components/anime';
import { RecoFiltersSection } from '@/components/anime/sidebar';
import filterStyles from '@/components/anime/sidebar/RecoFiltersSection.module.css';
import { CollapsibleSection } from '@/components/shared';
import { useQuickRateUrlState, toQuickRateQuery } from '@/hooks';
import { useT, TranslationKey } from '@/lib/i18n';
import type { QuickRateGroup, QuickRateMember, QuickRateResponse } from './api/anime/quick-rate';

const SCORES = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

// Same vocabulary as the tier board's filter, plus the unstatused bucket that
// only this page can reach.
const QR_STATUSES = ['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch', 'not_defined'] as const;

// green (10) → red (1), matching the tier board's scale.
function scoreColor(n: number): string {
  return `hsl(${Math.round(((n - 1) / 9) * 120)}, 55%, 42%)`;
}

interface QueueItem {
  id: string;
  score: number;
  prevScore: number;
  prevStatus?: string;
  numEpisodes?: number;
  autoComplete: boolean;
}

interface Override { score: number; status?: string; }

export default function QuickRatePage() {
  const t = useT();
  const { state, update, isReady } = useQuickRateUrlState();

  const [groups, setGroups] = useState<QuickRateGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Map<string, string>>(new Map());

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ filters: true, write: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const query = isReady ? toQuickRateQuery(state) : null;

  // Refetch on every filter change — the catalog is far too large to hold
  // client-side, so narrowing happens server-side (see the endpoint's header).
  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/anime/quick-rate${query ? `?${query}` : ''}`);
        if (!res.ok) throw new Error('load failed');
        const data: QuickRateResponse = await res.json();
        if (cancelled) return;
        setGroups(data.groups || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        // The server clamps a stale page number; mirror it back so the URL and
        // the pager agree on where we actually landed.
        if (typeof data.page === 'number' && data.page !== state.page) update({ page: data.page });
      } catch {
        if (!cancelled) setError(t('quickRate.loadFailed'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const baseline = useMemo(() => {
    const m = new Map<string, QuickRateMember>();
    for (const g of groups) for (const mem of g.members) m.set(mem.id, mem);
    return m;
  }, [groups]);

  const scoreOf = useCallback(
    (id: string): number => overrides.get(id)?.score ?? baseline.get(id)?.score ?? 0,
    [overrides, baseline],
  );
  const statusOf = useCallback(
    (id: string): string | undefined =>
      overrides.has(id) ? overrides.get(id)!.status : baseline.get(id)?.status,
    [overrides, baseline],
  );

  // ---- Serial write queue (SIMKL's 1 req/s + 20s per-user lock). ----------
  // A franchise "set all" enqueues one write per member; a per-member override
  // is just another item queued behind them.
  const queueRef = useRef<QueueItem[]>([]);
  const processingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;
    while (queueRef.current.length > 0) {
      const item = queueRef.current.shift()!;
      setSaving(prev => new Set(prev).add(item.id));
      try {
        // The status+progress endpoint, not score-only `rating`: auto-complete
        // needs to set all three in one write.
        const body: Record<string, unknown> = { score: item.score };
        if (item.autoComplete && item.score > 0) {
          body.status = 'completed';
          if (item.numEpisodes) body.num_episodes_watched = item.numEpisodes;
        }
        const res = await fetch(`/api/anime/animes/${item.id}/mal-status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({} as Record<string, any>));
        if (!res.ok) {
          // Nothing persisted — put the card back where it was.
          setOverrides(prev => new Map(prev).set(item.id, { score: item.prevScore, status: item.prevStatus }));
          setFailed(prev => new Map(prev).set(item.id, data?.error || t('quickRate.saveFailed')));
        } else {
          // Persisted locally; a remote provider may still have refused it.
          const outcomes: Record<string, { ok?: boolean }> = data.outcomes || {};
          const bad = Object.entries(outcomes).filter(([, o]) => o.ok === false).map(([p]) => p.toUpperCase());
          setFailed(prev => {
            const n = new Map(prev);
            if (bad.length) n.set(item.id, t('quickRate.notSynced', { sources: bad.join(' + ') }));
            else n.delete(item.id);
            return n;
          });
        }
      } catch {
        setOverrides(prev => new Map(prev).set(item.id, { score: item.prevScore, status: item.prevStatus }));
        setFailed(prev => new Map(prev).set(item.id, t('quickRate.networkError')));
      } finally {
        setSaving(prev => { const n = new Set(prev); n.delete(item.id); return n; });
      }
    }
    processingRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rate = useCallback((member: QuickRateMember, score: number) => {
    const prevScore = scoreOf(member.id);
    const prevStatus = statusOf(member.id);
    const autoComplete = state.autoComplete;
    if (prevScore === score && !(autoComplete && score > 0 && prevStatus !== 'completed')) return;
    setOverrides(prev => new Map(prev).set(member.id, {
      score,
      status: autoComplete && score > 0 ? 'completed' : prevStatus,
    }));
    setFailed(prev => { const n = new Map(prev); n.delete(member.id); return n; });
    queueRef.current.push({
      id: member.id,
      score,
      prevScore,
      prevStatus,
      numEpisodes: member.numEpisodes,
      autoComplete,
    });
    processQueue();
  }, [scoreOf, statusOf, state.autoComplete, processQueue]);

  /** The group fast path: one score onto every member. Per-member override after. */
  const rateGroup = useCallback((group: QuickRateGroup, score: number) => {
    for (const member of group.members) rate(member, score);
  }, [rate]);

  const goToPage = useCallback((p: number) => {
    update({ page: p });
    // A page is up to 20 franchises tall; without this you land mid-list.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [update]);

  const renderScoreRow = (onPick: (n: number) => void, current: number, compact?: boolean) => (
    <div className={compact ? 'scores compact' : 'scores'}>
      {SCORES.map(n => (
        <button
          key={n}
          type="button"
          className={`score ${current === n ? 'picked' : ''}`}
          style={current === n ? { background: scoreColor(n), borderColor: scoreColor(n), color: '#fff' } : undefined}
          onClick={() => onPick(n)}
        >
          {n}
        </button>
      ))}
      {current > 0 && (
        <button type="button" className="score clear" onClick={() => onPick(0)}>
          {t('common.clear')}
        </button>
      )}
    </div>
  );

  const renderMember = (m: QuickRateMember) => {
    const score = scoreOf(m.id);
    const status = statusOf(m.id);
    const fail = failed.get(m.id);
    return (
      <div key={m.id} className={`member ${fail ? 'failed' : ''}`}>
        <div className="poster">
          {m.picture
            ? <img src={m.picture} alt="" loading="lazy" />
            : <div className="noimg">{m.title.slice(0, 2)}</div>}
          {saving.has(m.id) && <span className="badge saving">…</span>}
          {!saving.has(m.id) && fail && <span className="badge fail" title={fail}>!</span>}
        </div>
        <div className="member-body">
          <div className="member-head">
            <a className="member-title" href={`/anime/${m.id}`} target="_blank" rel="noopener noreferrer">
              {m.title}
            </a>
            <span className="member-meta">
              {m.year ? `${m.year} · ` : ''}
              {m.mediaType ? m.mediaType.toUpperCase() : ''}
              {m.numEpisodes ? ` · ${t('quickRate.epCount', { count: m.numEpisodes })}` : ''}
            </span>
          </div>
          <div className="member-state">
            <span className={status ? 'chip' : 'chip muted'}>
              {status ? t(`statusShort.${status}` as TranslationKey) : t('quickRate.unstatused')}
            </span>
          </div>
          {renderScoreRow(n => rate(m, n), score, true)}
        </div>
      </div>
    );
  };

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection title={t('quickRate.writeSection')} isExpanded={expanded.write} onToggle={() => toggle('write')}>
        <label className={filterStyles.checkboxLabel}>
          <input
            type="checkbox"
            checked={state.autoComplete}
            onChange={e => update({ autoComplete: e.target.checked })}
          /> {t('quickRate.autoComplete')}
        </label>
        <p className="hint">{t('quickRate.autoCompleteHint')}</p>
      </CollapsibleSection>

      <CollapsibleSection title={t('section.filters')} isExpanded={expanded.filters} onToggle={() => toggle('filters')}>
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

        <div className={filterStyles.filterGroup}>
          <label className={filterStyles.label}>{t('tier.statuses')}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {QR_STATUSES.map(s => (
              <label key={s} className={filterStyles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={state.statuses.includes(s)}
                  onChange={e => {
                    const next = e.target.checked
                      ? [...state.statuses, s]
                      : state.statuses.filter(x => x !== s);
                    update({ statuses: next });
                  }}
                /> {s === 'not_defined' ? t('quickRate.unstatused') : t(`status.${s}` as TranslationKey)}
              </label>
            ))}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );

  return (
    <>
      <Head>
        <title>{t('quickRate.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="qr-main">
          {error && <div className="error-banner">{error} <button onClick={() => setError('')}>×</button></div>}

          <div className="qr-header">
            <h1 className="qr-title">{t('nav.quickRate')}</h1>
            <span className="qr-count">
              {t('quickRate.groupCount', { count: total })}
              {totalPages > 1
                ? ` — ${t('quickRate.pageOf', { page: state.page + 1, total: totalPages })}`
                : ''}
            </span>
          </div>

          {!isReady || isLoading ? (
            <div className="loading-state">{t('common.loading')}</div>
          ) : groups.length === 0 ? (
            <div className="loading-state">{t('quickRate.empty')}</div>
          ) : (
            <>
            <div className="groups">
              {groups.map(g => (
                <section key={g.id} className="group">
                  <div className="group-head">
                    <div>
                      <h2 className="group-title">{g.title}</h2>
                      <span className="group-sub">{t('quickRate.memberCount', { count: g.members.length })}</span>
                    </div>
                    <div className="group-actions">
                      <span className="group-label">{t('quickRate.setAll')}</span>
                      {renderScoreRow(n => rateGroup(g, n), 0)}
                    </div>
                  </div>
                  <div className="members">{g.members.map(renderMember)}</div>
                </section>
              ))}
            </div>
            {totalPages > 1 && (
              <nav className="pager">
                <button type="button" onClick={() => goToPage(state.page - 1)} disabled={state.page === 0}>
                  ← {t('quickRate.prevPage')}
                </button>
                <span className="pager-label">
                  {t('quickRate.pageOf', { page: state.page + 1, total: totalPages })}
                </span>
                <button
                  type="button"
                  onClick={() => goToPage(state.page + 1)}
                  disabled={state.page >= totalPages - 1}
                >
                  {t('quickRate.nextPage')} →
                </button>
              </nav>
            )}
            </>
          )}
        </div>
      </AnimePageLayout>

      <style jsx>{`
        .qr-main { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .qr-header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
        .qr-title { font-size: 1.5rem; margin: 0; color: var(--text-primary); }
        .qr-count { color: var(--text-secondary); }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }
        .hint { color: var(--text-muted); font-size: 0.78rem; margin: 6px 0 0; }

        .groups { display: flex; flex-direction: column; gap: 1rem; }
        .group { border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-primary); }
        .group-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
          flex-wrap: wrap; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border-color); }
        .group-title { margin: 0; font-size: 1.05rem; color: var(--text-primary); }
        .group-sub { color: var(--text-secondary); font-size: 0.8rem; }
        .group-actions { display: flex; align-items: center; gap: 0.6rem; }
        .group-label { color: var(--text-secondary); font-size: 0.8rem; }

        .members { display: flex; flex-direction: column; }

        .pager { display: flex; align-items: center; justify-content: center; gap: 1rem;
          padding: 1rem 0 2rem; }
        .pager button { padding: 0.4rem 0.9rem; border-radius: 6px; cursor: pointer;
          background: var(--bg-secondary); border: 1px solid var(--border-color);
          color: var(--text-secondary); font-size: 0.9rem; }
        .pager button:hover:not(:disabled) { border-color: var(--border-hover); color: var(--text-primary); }
        .pager button:disabled { opacity: 0.4; cursor: default; }
        .pager-label { color: var(--text-secondary); font-size: 0.85rem; }
      `}</style>
      <style jsx global>{`
        /* Member/score rules are global-but-scoped under .qr-main: renderMember
           and renderScoreRow are nested helpers, and styled-jsx only scopes JSX
           returned by the component itself. */
        .qr-main .scores { display: flex; flex-wrap: wrap; gap: 4px; }
        .qr-main .score { min-width: 30px; padding: 3px 7px; border-radius: 6px; cursor: pointer;
          background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-secondary);
          font-size: 0.85rem; line-height: 1.2; }
        .qr-main .scores.compact .score { min-width: 26px; padding: 2px 6px; font-size: 0.8rem; }
        .qr-main .score:hover { border-color: var(--border-hover); color: var(--text-primary); }
        .qr-main .score.picked { font-weight: 700; }
        .qr-main .score.clear { color: var(--text-muted); }

        .qr-main .member { display: flex; gap: 0.75rem; padding: 0.6rem 1rem;
          border-top: 1px solid var(--border-color); }
        .qr-main .member:first-child { border-top: none; }
        .qr-main .member.failed { box-shadow: inset 3px 0 0 #dc2626; }
        .qr-main .poster { position: relative; flex: 0 0 auto; width: 46px; height: 66px;
          border-radius: 4px; overflow: hidden; background: var(--bg-secondary); }
        .qr-main .poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .qr-main .noimg { width: 100%; height: 100%; display: flex; align-items: center;
          justify-content: center; font-size: 0.7rem; color: var(--text-secondary); }
        .qr-main .badge { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 0.7rem; font-weight: 700; color: #fff; }
        .qr-main .badge.saving { background: rgba(0,0,0,0.6); }
        .qr-main .badge.fail { background: #dc2626; }

        .qr-main .member-body { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; }
        .qr-main .member-head { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
        .qr-main .member-title { color: var(--text-primary); font-weight: 500; text-decoration: none; }
        .qr-main .member-title:hover { color: var(--accent-primary); }
        .qr-main .member-meta { color: var(--text-muted); font-size: 0.75rem; }
        .qr-main .member-state .chip { display: inline-block; padding: 0.05rem 0.4rem; border-radius: 999px;
          font-size: 0.72rem; background: var(--bg-secondary); border: 1px solid var(--border-color);
          color: var(--text-secondary); }
        .qr-main .member-state .chip.muted { color: var(--text-muted); opacity: 0.8; }
      `}</style>
    </>
  );
}
