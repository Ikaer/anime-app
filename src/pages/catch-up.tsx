/**
 * /catch-up — « À rattraper ».
 *
 * The franchises you finished something of, and the entries in them you never
 * started: the seasons, movies, OVAs and specials that fall through every other
 * surface. The main list can't express it (it's a graph question, not a filter
 * combination) and /quick-rate reaches the same titles for a different purpose —
 * there you *rate* a whole franchise, here you only ask what's left of it.
 *
 * Read-only on purpose: nothing on this page writes. It ends at a link to the
 * detail page, which is where a status is set.
 */
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { AnimePageLayout } from '@/components/anime';
import { RecoFiltersSection } from '@/components/anime/sidebar';
import filterStyles from '@/components/anime/sidebar/RecoFiltersSection.module.css';
import { CollapsibleSection } from '@/components/shared';
import { useCatchUpUrlState, toCatchUpQuery } from '@/hooks';
import { useT, TranslationKey } from '@/lib/i18n';
import type { CatchUpEntry, CatchUpGroup, CatchUpResponse } from './api/anime/catch-up';

export default function CatchUpPage() {
  const t = useT();
  const { state, update, isReady } = useCatchUpUrlState();

  const [groups, setGroups] = useState<CatchUpGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [totalMissing, setTotalMissing] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ filters: true, scope: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const query = isReady ? toCatchUpQuery(state) : null;

  // Refetch on every filter change — the holes are unstatused catalog titles, so
  // the scope is the whole catalog and narrowing happens server-side.
  useEffect(() => {
    if (query === null) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/anime/catch-up${query ? `?${query}` : ''}`);
        if (!res.ok) throw new Error('load failed');
        const data: CatchUpResponse = await res.json();
        if (cancelled) return;
        setGroups(data.groups || []);
        setTotal(data.total || 0);
        setTotalMissing(data.totalMissing || 0);
        setTotalPages(data.totalPages || 1);
        // The server clamps a stale page number; mirror it back so the URL and
        // the pager agree on where we actually landed.
        if (typeof data.page === 'number' && data.page !== state.page) update({ page: data.page });
      } catch {
        if (!cancelled) setError(t('catchUp.loadFailed'));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const goToPage = (p: number) => {
    update({ page: p });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** One hole. The card IS the answer, so it gets the poster and the metadata. */
  const renderMissing = (e: CatchUpEntry) => (
    <a
      key={e.id}
      className="miss"
      href={`/anime/${e.id}`}
      target="_blank"
      rel="noopener noreferrer"
      // The card clamps the title to two lines, and a franchise's entries are
      // exactly the titles that differ only in their tail ("… -The First Kiss
      // That Never Ends-"), so the full string has to stay reachable.
      title={e.title}
    >
      <div className="miss-poster">
        {e.picture
          ? <img src={e.picture} alt="" loading="lazy" />
          : <div className="noimg">{e.title.slice(0, 2)}</div>}
        {e.airing && e.airing !== 'finished_airing' && (
          <span className={`airing ${e.airing}`}>
            {t(`airing.${e.airing}` as TranslationKey)}
          </span>
        )}
      </div>
      <div className="miss-title">{e.title}</div>
      <div className="miss-meta">
        {e.year ? `${e.year}` : ''}
        {e.mediaType ? `${e.year ? ' · ' : ''}${e.mediaType.toUpperCase()}` : ''}
        {e.numEpisodes ? ` · ${t('catchUp.epCount', { count: e.numEpisodes })}` : ''}
      </div>
      {e.mean ? <div className="miss-mean">★ {e.mean.toFixed(2)}</div> : null}
    </a>
  );

  /** One entry you already have a status on — context, not the answer. */
  const renderSeen = (e: CatchUpEntry) => (
    <a
      key={e.id}
      className="seen"
      href={`/anime/${e.id}`}
      target="_blank"
      rel="noopener noreferrer"
      title={`${e.title} — ${t(`statusShort.${e.status}` as TranslationKey)}${e.score ? ` · ${e.score}/10` : ''}`}
    >
      {e.picture
        ? <img src={e.picture} alt="" loading="lazy" />
        : <span className="noimg">{e.title.slice(0, 2)}</span>}
      {e.score ? <span className="seen-score">{e.score}</span> : null}
    </a>
  );

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
      <CollapsibleSection
        title={t('catchUp.scopeSection')}
        isExpanded={expanded.scope}
        onToggle={() => toggle('scope')}
      >
        <p className="hint">{t('catchUp.intro')}</p>
        <label className={filterStyles.checkboxLabel}>
          <input
            type="checkbox"
            checked={state.direct}
            onChange={e => update({ direct: e.target.checked })}
          /> {t('catchUp.directOnly')}
        </label>
        <p className="hint">{t('catchUp.directOnlyHint')}</p>
        <label className={filterStyles.checkboxLabel}>
          <input
            type="checkbox"
            checked={state.unaired}
            onChange={e => update({ unaired: e.target.checked })}
          /> {t('catchUp.showUnaired')}
        </label>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('section.filters')}
        isExpanded={expanded.filters}
        onToggle={() => toggle('filters')}
      >
        <p className="hint">{t('catchUp.filtersHint')}</p>
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
        <title>{t('catchUp.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>
      <AnimePageLayout sidebar={sidebar}>
        <div className="cu-main">
          {error && <div className="error-banner">{error} <button onClick={() => setError('')}>×</button></div>}

          <div className="cu-header">
            <h1 className="cu-title">{t('nav.catchUp')}</h1>
            <span className="cu-count">
              {t('catchUp.summary', { franchises: total, titles: totalMissing })}
              {totalPages > 1
                ? ` — ${t('catchUp.pageOf', { page: state.page + 1, total: totalPages })}`
                : ''}
            </span>
          </div>

          {!isReady || isLoading ? (
            <div className="loading-state">{t('common.loading')}</div>
          ) : groups.length === 0 ? (
            <div className="loading-state">{t('catchUp.empty')}</div>
          ) : (
            <>
              <div className="groups">
                {groups.map(g => (
                  <section key={g.id} className="group">
                    <div className="group-head">
                      <div className="group-id">
                        <h2 className="group-title">{g.title}</h2>
                        <span className="group-sub">
                          {t('catchUp.missingCount', { count: g.missing.length })}
                          {g.unairedHidden > 0
                            ? ` · ${t('catchUp.unairedHidden', { count: g.unairedHidden })}`
                            : ''}
                        </span>
                      </div>
                      <div className="group-right">
                        <span className={g.score ? 'score-chip' : 'score-chip unrated'}>
                          {g.score ? t('catchUp.yourScore', { score: g.score }) : t('catchUp.unrated')}
                        </span>
                        <div className="seen-strip">{g.seen.map(renderSeen)}</div>
                      </div>
                    </div>
                    <div className="misses">{g.missing.map(renderMissing)}</div>
                  </section>
                ))}
              </div>

              {totalPages > 1 && (
                <nav className="pager">
                  <button type="button" onClick={() => goToPage(state.page - 1)} disabled={state.page === 0}>
                    ← {t('catchUp.prevPage')}
                  </button>
                  <span className="pager-label">
                    {t('catchUp.pageOf', { page: state.page + 1, total: totalPages })}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToPage(state.page + 1)}
                    disabled={state.page >= totalPages - 1}
                  >
                    {t('catchUp.nextPage')} →
                  </button>
                </nav>
              )}
            </>
          )}
        </div>
      </AnimePageLayout>

      <style jsx>{`
        .cu-main { display: flex; flex-direction: column; gap: 1rem; }
        .error-banner { background: #fee2e2; color: #dc2626; padding: 1rem; border-radius: 8px; }
        .cu-header { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
          flex-wrap: wrap; }
        .cu-title { font-size: 1.5rem; margin: 0; color: var(--text-primary); }
        .cu-count { color: var(--text-secondary); }
        .loading-state { text-align: center; padding: 3rem; color: var(--text-secondary); }
        .hint { color: var(--text-muted); font-size: 0.78rem; margin: 0 0 8px; }

        .groups { display: flex; flex-direction: column; gap: 1rem; }
        .group { border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-primary); }
        .group-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem;
          flex-wrap: wrap; padding: 0.75rem 1rem; border-bottom: 1px solid var(--border-color); }
        .group-id { min-width: 0; }
        .group-title { margin: 0; font-size: 1.05rem; color: var(--text-primary); }
        .group-sub { color: var(--text-secondary); font-size: 0.8rem; }
        .group-right { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }

        .score-chip { padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.78rem;
          background: var(--bg-secondary); border: 1px solid var(--border-color);
          color: var(--text-primary); white-space: nowrap; }
        .score-chip.unrated { color: var(--text-muted); }

        /* The titles you already watched — deliberately small: they explain why
           the franchise is listed, they are not the thing you came for. */
        .seen-strip { display: flex; gap: 3px; flex-wrap: wrap; max-width: 340px; }

        .misses { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 0.75rem; padding: 0.85rem 1rem 1rem; }

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
        /* renderMissing / renderSeen are nested helpers, and styled-jsx only
           scopes JSX returned by the component itself — so these are global,
           scoped by hand under .cu-main. Same arrangement as /quick-rate. */
        .cu-main .miss { display: flex; flex-direction: column; gap: 3px; text-decoration: none; }
        .cu-main .miss-poster { position: relative; width: 100%; aspect-ratio: 2 / 3;
          border-radius: 6px; overflow: hidden; background: var(--bg-secondary);
          border: 1px solid var(--border-color); }
        .cu-main .miss:hover .miss-poster { border-color: var(--accent-primary); }
        .cu-main .miss-poster img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cu-main .noimg { width: 100%; height: 100%; display: flex; align-items: center;
          justify-content: center; font-size: 0.7rem; color: var(--text-secondary); }
        .cu-main .airing { position: absolute; left: 4px; bottom: 4px; padding: 1px 5px;
          border-radius: 4px; font-size: 0.65rem; color: #fff; background: rgba(0,0,0,0.72); }
        .cu-main .airing.not_yet_aired { background: #7c3aed; }
        .cu-main .airing.currently_airing { background: #0f766e; }
        .cu-main .miss-title { color: var(--text-primary); font-size: 0.82rem; line-height: 1.25;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .cu-main .miss:hover .miss-title { color: var(--accent-primary); }
        .cu-main .miss-meta { color: var(--text-muted); font-size: 0.72rem; }
        .cu-main .miss-mean { color: var(--text-secondary); font-size: 0.72rem; }

        .cu-main .seen { position: relative; display: block; width: 26px; height: 38px;
          border-radius: 3px; overflow: hidden; background: var(--bg-secondary);
          opacity: 0.75; text-decoration: none; }
        .cu-main .seen:hover { opacity: 1; }
        .cu-main .seen img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .cu-main .seen .noimg { font-size: 0.55rem; }
        .cu-main .seen-score { position: absolute; right: 0; bottom: 0; padding: 0 2px;
          font-size: 0.6rem; font-weight: 700; color: #fff; background: rgba(0,0,0,0.75); }
      `}</style>
    </>
  );
}
