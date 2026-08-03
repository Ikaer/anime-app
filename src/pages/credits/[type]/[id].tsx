/**
 * /credits/studio/[id] and /credits/staff/[id] — one credit's filmography.
 *
 * The narrowing filters and the sort run in `getServerSideProps`, not in the
 * browser: finding the credit is a catalog scan either way, so the server is
 * already holding the real `AnimeRecord`s that `applyNarrowingFilters` and
 * `sortAnimeRecords` want, and the page keeps shipping the lean `CreditedAnime`
 * projection instead of ~25k-record-sized rows. The consequence is that
 * `useCreditsUrlState` pushes NON-shallow — a shallow push would leave every
 * filter inert.
 *
 * Read-only, like /catch-up: the card ends at a link to the detail page, which
 * is where a status is set. The status badge is a label, not a control.
 */
import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { AnimePageLayout, AnimeListHeader } from '@/components/anime';
import { RecoFiltersSection } from '@/components/anime/sidebar';
import filterStyles from '@/components/anime/sidebar/RecoFiltersSection.module.css';
import { CollapsibleSection } from '@/components/shared';
import { getAnimeForDisplay } from '@/lib/store';
import { applyNarrowingFilters, getEffectiveStatus, sortAnimeRecords } from '@/lib/domain/animeUtils';
import { listAnimeByStudio, listAnimeByStaff, toCredited, type CreditedAnime } from '@/lib/domain/creditsCatalog';
import { decodeCreditsState, useCreditsUrlState } from '@/hooks';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { SortColumn, SortDirection, UserAnimeStatus } from '@/models/anime';

type CreditType = 'studio' | 'staff';

/** Same list (and order) as the main list's status filter — `not_defined` included:
 *  a filmography is mostly titles you have no status on, so "sans statut" is a
 *  meaningful narrowing here, unlike on the tier board. */
const ALL_STATUSES: (UserAnimeStatus | 'not_defined')[] = [
  'watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch', 'not_defined',
];

const STATUS_ICON: Record<string, string> = {
  watching: '📺',
  completed: '✅',
  on_hold: '⏸️',
  dropped: '🗑️',
  plan_to_watch: '📅',
};

interface Props {
  type: CreditType;
  id: number;
  name: string;
  items: CreditedAnime[];
  /** Credits before narrowing — so the count can say "42 of 310". */
  total: number;
  /** Genre vocabulary of the WHOLE filmography, so it doesn't shrink as you filter. */
  availableGenres: string[];
}

export default function CreditsPage({ type, id, name, items, total, availableGenres }: Props) {
  const t = useT();
  const router = useRouter();
  const { state, update } = useCreditsUrlState(`/credits/${type}/${id}`);
  const heading = type === 'studio' ? t('credits.studioHeading', { name }) : t('credits.staffHeading', { name });

  // Filtering is a server round-trip here, so say so — otherwise a filter click
  // looks like it did nothing until the new props land. Gated on the
  // destination: `routeChangeStart` also fires when a card is clicked, and
  // blanking the grid into "loading" on the way OUT of the page is just wrong.
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    const basePath = `/credits/${type}/${id}`;
    const start = (url: string) => {
      if (url === basePath || url.startsWith(`${basePath}?`)) setIsLoading(true);
    };
    const done = () => setIsLoading(false);
    router.events.on('routeChangeStart', start);
    router.events.on('routeChangeComplete', done);
    router.events.on('routeChangeError', done);
    return () => {
      router.events.off('routeChangeStart', start);
      router.events.off('routeChangeComplete', done);
      router.events.off('routeChangeError', done);
    };
  }, [router.events, type, id]);

  // "N of M" whenever a filter is SET, not whenever it happened to narrow —
  // a filter that keeps everything is still active, and reading a bare total
  // under checked boxes is what makes a count untrustworthy.
  const isFiltered = !!state.search || state.mediaTypes.length > 0 || state.genres.length > 0
    || state.statuses.length > 0 || state.minScore !== null || state.maxScore !== null
    || state.minYear !== null || state.maxYear !== null;

  const [expanded, setExpanded] = useState<Record<string, boolean>>({ filters: true });
  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const sidebar = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
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
          <label className={filterStyles.label}>{t('credits.statusFilter')}</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ALL_STATUSES.map(s => (
              <label key={s} className={filterStyles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={state.statuses.includes(s)}
                  onChange={(e) => update({
                    statuses: e.target.checked
                      ? [...state.statuses, s]
                      : state.statuses.filter(x => x !== s),
                  })}
                /> {t(`status.${s}` as TranslationKey)}
              </label>
            ))}
          </div>
        </div>

        {availableGenres.length > 0 && (
          <div className={filterStyles.filterGroup}>
            <label className={filterStyles.label}>{t('tier.genres')}</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
              {availableGenres.map(g => (
                <label key={g} className={filterStyles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={state.genres.includes(g)}
                    onChange={(e) => update({
                      genres: e.target.checked
                        ? [...state.genres, g]
                        : state.genres.filter(x => x !== g),
                    })}
                  /> {g}
                </label>
              ))}
            </div>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );

  return (
    <>
      <Head>
        <title>{t('credits.pageTitle', { name })}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>

      <AnimePageLayout sidebar={sidebar}>
        <div className="cr-main">
          <Link href="/" className="back">{t('detail.back')}</Link>

          {/* The same bar `/`, `/recommendations` and `/tier` render. No
              `display` slot: the grid is auto-fill, not cards-per-row. */}
          <AnimeListHeader
            title={heading}
            count={isFiltered
              ? t('credits.countFiltered', { count: items.length, total })
              : t(total === 1 ? 'credits.countOne' : 'credits.countOther', { count: total })}
            sort={{
              sortBy: state.sortBy,
              sortDir: state.sortDir,
              onSortByChange: (c: SortColumn) => update({ sortBy: c }),
              onSortDirChange: (d: SortDirection) => update({ sortDir: d }),
            }}
          />

          {isLoading ? (
            <div className="empty">{t('common.loading')}</div>
          ) : items.length === 0 ? (
            <div className="empty">{t('credits.empty')}</div>
          ) : (
            <div className="grid">
              {items.map(a => (
                <Link key={a.id} href={`/anime/${a.id}`} className="card" title={a.title}>
                  {a.poster
                    ? <img src={a.poster} alt="" />
                    : <div className="noimg">?</div>}
                  <div className="body">
                    <span className="title">{a.title}</span>
                    <div className="meta">
                      {a.year && <span>{a.year}</span>}
                      {a.mediaType && <span>{a.mediaType.toUpperCase()}</span>}
                      {a.mean != null && <span className="mean">★ {a.mean.toFixed(2)}</span>}
                    </div>
                    {/* My status on this title, when there is one — the whole
                        point being that a filmography is mostly titles I have
                        no status on, so an empty chip would be noise. */}
                    {a.status && (
                      <span className={`status ${a.status}`}>
                        <span className="status-icon">{STATUS_ICON[a.status] || ''}</span>
                        {t(`statusShort.${a.status}` as TranslationKey)}
                        {a.score ? <span className="status-score">{a.score}</span> : null}
                      </span>
                    )}
                    {a.role && <span className="role">{a.role}</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </AnimePageLayout>

      <style jsx>{`
        .cr-main { display: flex; flex-direction: column; gap: 1rem; color: var(--text-primary); padding-bottom: 3rem; }
        .back { color: var(--accent-primary); text-decoration: none; font-weight: 600; align-self: flex-start; }
        .back:hover { text-decoration: underline; }
        .empty { text-align: center; padding: 3rem; color: var(--text-secondary); }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
        .grid :global(.card) { display: flex; flex-direction: column; gap: 0.4rem; text-decoration: none;
          color: var(--text-primary); background: var(--bg-tertiary); border: 1px solid var(--border-color);
          border-radius: 10px; padding: 0.6rem; }
        .grid :global(.card):hover { border-color: var(--border-hover); }
        .grid :global(.card) img { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 6px; }
        .noimg { width: 100%; aspect-ratio: 2 / 3; border-radius: 6px; background: var(--bg-secondary);
          display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
        .body { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; align-items: flex-start; }
        .title { font-size: 0.88rem; font-weight: 600; line-height: 1.25; overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .grid :global(.card):hover .title { text-decoration: underline; }
        .meta { display: flex; flex-wrap: wrap; gap: 0.5rem; color: var(--text-muted); font-size: 0.75rem; }
        .meta .mean { color: var(--accent-primary); }
        .role { color: var(--text-secondary); font-size: 0.75rem; }

        /* Same colour vocabulary as the card view's personal-status label. */
        .status { display: inline-flex; align-items: center; gap: 4px; padding: 1px 6px; border-radius: 999px;
          font-size: 0.7rem; font-weight: 600; border: 1px solid transparent; }
        .status-icon { font-size: 0.7rem; }
        .status-score { padding-left: 4px; margin-left: 2px; border-left: 1px solid rgba(255,255,255,0.25); }
        .status.watching { background: rgba(59,130,246,0.16); color: #93c5fd; border-color: rgba(59,130,246,0.4); }
        .status.completed { background: rgba(16,185,129,0.16); color: #6ee7b7; border-color: rgba(16,185,129,0.4); }
        .status.on_hold { background: rgba(245,158,11,0.16); color: #fcd34d; border-color: rgba(245,158,11,0.4); }
        .status.dropped { background: rgba(239,68,68,0.16); color: #fca5a5; border-color: rgba(239,68,68,0.4); }
        .status.plan_to_watch { background: rgba(139,92,246,0.16); color: #c4b5fd; border-color: rgba(139,92,246,0.4); }
      `}</style>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const type = String(ctx.params?.type);
  const id = parseInt(String(ctx.params?.id), 10);
  if ((type !== 'studio' && type !== 'staff') || !Number.isInteger(id)) {
    return { notFound: true };
  }
  // Catalog fields (studios/staff) only, so the personal-state cache caveat
  // doesn't apply — the shared cached catalog is fine (see similarByCredits.ts).
  const catalog = getAnimeForDisplay();
  const result = type === 'studio' ? listAnimeByStudio(id, catalog) : listAnimeByStaff(id, catalog);
  // 404 is about whether the CREDIT exists, never about what the filters left —
  // an over-narrow filter has to render an empty grid, not a missing page.
  if (!result) {
    return { notFound: true };
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(ctx.query)) {
    if (typeof value === 'string') params.set(key, value);
  }
  const state = decodeCreditsState(params);

  let records = applyNarrowingFilters(result.records, {
    search: state.search,
    mediaTypes: state.mediaTypes,
    minScore: state.minScore,
    maxScore: state.maxScore,
    minYear: state.minYear,
    maxYear: state.maxYear,
    genres: state.genres,
  });

  // Effective personal status, `not_defined` matching a title in no list —
  // same OR semantics (and the same helper) as the main list's status filter.
  if (state.statuses.length > 0) {
    const wanted = new Set(state.statuses);
    records = records.filter(a => wanted.has(getEffectiveStatus(a) || 'not_defined'));
  }

  const genreNames = new Set<string>();
  for (const a of result.records) for (const g of a.catalog.genres || []) genreNames.add(g.name);

  return {
    props: {
      type,
      id,
      name: result.name,
      items: JSON.parse(JSON.stringify(sortAnimeRecords(records, state.sortBy, state.sortDir).map(toCredited))),
      total: result.records.length,
      availableGenres: Array.from(genreNames).sort((a, b) => a.localeCompare(b)),
    },
  };
};
