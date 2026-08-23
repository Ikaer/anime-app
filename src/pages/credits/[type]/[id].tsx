/**
 * /credits/studio/[id], /credits/staff/[id] and /credits/seiyuu/[id] — one
 * credit's filmography.
 *
 * **`seiyuu` is a third TYPE, not more rows on `staff`**, even though both key
 * on the same AniList staff id space. The two credit sets are disjoint by
 * construction: `sources.anilist.staff` is the top-50 *production* credits,
 * which never contain voice actors. They also come from different places —
 * staff rides on the record, seiyuu live in the cast slice, which is
 * deliberately off the row join — so only this type reads a second file and
 * only this type has partial coverage to declare (see `castCovered`).
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
import { getAllAnilistCast, getAnimeForDisplay } from '@/lib/store';
import { applyNarrowingFilters, getEffectiveStatus, sortAnimeRecords } from '@/lib/domain/animeUtils';
import { listAnimeByStudio, listAnimeByStaff, listAnimeBySeiyuu, toCredited, type CreditedAnime } from '@/lib/domain/creditsCatalog';
import { decodeCreditsState, useCreditsUrlState } from '@/hooks';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { SortColumn, SortDirection, UserAnimeStatus } from '@/models/anime';

type CreditType = 'studio' | 'staff' | 'seiyuu';

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
  /** Seiyuu only — AniList's Japanese-script name, when it has one. */
  nameNative: string | null;
  /** Seiyuu only — AniList-hosted portrait, hot-linked like the cast section's. */
  image: string | null;
  items: CreditedAnime[];
  /** Credits before narrowing — so the count can say "42 of 310". */
  total: number;
  /** Genre vocabulary of the WHOLE filmography, so it doesn't shrink as you filter. */
  availableGenres: string[];
  /**
   * Seiyuu only: how many catalog titles had a cast entry at all. The cast slice
   * is filled lazily + by the /stats sweep, never catalog-wide, so this
   * filmography is drawn from a pool — saying which one is the difference
   * between an honest partial answer and a silently wrong one.
   */
  castCovered: number | null;
  /** Catalog size, the denominator `castCovered` is read against. */
  catalogTotal: number;
}

export default function CreditsPage({
  type, id, name, nameNative, image, items, total, availableGenres, castCovered, catalogTotal,
}: Props) {
  const t = useT();
  const router = useRouter();
  const { state, update } = useCreditsUrlState(`/credits/${type}/${id}`);
  const heading = type === 'studio'
    ? t('credits.studioHeading', { name })
    : type === 'seiyuu'
      ? t('credits.seiyuuHeading', { name })
      : t('credits.staffHeading', { name });


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

  /**
   * Whether the character portraits ride on the posters. Component state, not a
   * URL key: it says how the grid LOOKS, and the same reasoning that removed the
   * `img` key applies — a display toggle nobody shares does not earn a param.
   * It survives filter changes because those re-render this page rather than
   * remounting it; a hard reload legitimately starts from the default.
   */
  const [showFaces, setShowFaces] = useState(true);
  const anyFace = items.some(a => a.characters?.some(c => c.image));

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
          {/* The portrait rides in the header's `title` slot rather than above
              it, so a seiyuu page keeps the exact bar every other list page
              renders. It is written INLINE rather than built into a variable
              above: styled-jsx only scopes JSX inside the tree that holds the
              `<style jsx>` block, so a hoisted node would render unstyled — and
              an unsized portrait is a full-height poster. */}
          <AnimeListHeader
            title={type === 'seiyuu' && (image || nameNative) ? (
              <span className="who">
                {image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="portrait" src={image} alt="" />
                  : null}
                <span className="who-text">
                  <span>{heading}</span>
                  {nameNative && <span className="native">{nameNative}</span>}
                  {/* Lives here, in the seiyuu's own box, because it controls
                      something only a seiyuu page has. Hidden outright when no
                      character on the page carries a portrait — a toggle with
                      nothing to toggle is worse than no toggle. */}
                  {anyFace && (
                    <button
                      type="button"
                      className="faces-toggle"
                      aria-pressed={showFaces}
                      onClick={() => setShowFaces(v => !v)}
                    >
                      {t(showFaces ? 'credits.hideFaces' : 'credits.showFaces')}
                    </button>
                  )}
                </span>
              </span>
            ) : heading}
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

          {/* Coverage is a property of the DATA, not of the filters, so it sits
              outside the loading/empty branches — an over-narrow filter must not
              hide the reason a filmography looks short. */}
          {castCovered !== null && castCovered < catalogTotal && (
            <p className="coverage">
              {t('credits.seiyuuCoverage', { covered: castCovered, total: catalogTotal })}{' '}
              <Link href="/stats">{t('credits.seiyuuCoverageAction')}</Link>
            </p>
          )}

          {isLoading ? (
            <div className="empty">{t('common.loading')}</div>
          ) : items.length === 0 ? (
            <div className="empty">{t('credits.empty')}</div>
          ) : (
            <div className="grid">
              {items.map(a => (
                <Link key={a.id} href={`/anime/${a.id}`} className="card" title={a.title}>
                  <span className="poster">
                    {a.poster
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={a.poster} alt="" />
                      : <span className="noimg">?</span>}
                    {/* The character(s) this seiyuu voiced, over the art they
                        belong to. On the poster rather than beside the title
                        because a face is what identifies a role — the name chip
                        below still carries the text, so hiding these loses
                        nothing but the pictures. */}
                    {showFaces && a.characters && a.characters.some(c => c.image) && (
                      // The circle SIZES ITSELF to the count: one credit — the
                      // usual case — earns the full quarter of the poster, and
                      // each extra face gives some of it back rather than every
                      // card paying the worst case's size. Capped at 4, past
                      // which they wrap instead of shrinking further.
                      <span className={`faces faces-${Math.min(a.characters.filter(c => c.image).length, 4)}`}>
                        {a.characters.filter(c => c.image).map(c => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={c.id}
                            className={c.role === 'MAIN' ? 'face face-main' : 'face'}
                            src={c.image}
                            alt={c.name}
                            title={c.name}
                            loading="lazy"
                          />
                        ))}
                      </span>
                    )}
                  </span>
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
                    {/* Every character, not just the first: voicing two roles in
                        one title is common enough that showing one silently
                        drops a real credit. */}
                    {a.characters && a.characters.length > 0 && (
                      <span className="chars">
                        {a.characters.map(c => (
                          <span key={c.id} className={c.role === 'MAIN' ? 'char char-main' : 'char'}>
                            {c.name}
                          </span>
                        ))}
                      </span>
                    )}
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
        .coverage { margin: 0; color: var(--text-muted); font-size: 0.85rem; }
        .coverage :global(a) { color: var(--accent-primary); }

        .who { display: inline-flex; align-items: center; gap: 0.6rem; }
        .faces-toggle { margin-top: 4px; align-self: flex-start; cursor: pointer; font: inherit;
          font-size: 0.72rem; font-weight: 600; padding: 2px 8px; border-radius: 999px;
          color: var(--text-secondary); background: var(--bg-tertiary); border: 1px solid var(--border-color); }
        .faces-toggle:hover { color: var(--text-primary); border-color: var(--border-hover); }
        .who .portrait { width: 44px; height: 44px; border-radius: 50%; object-fit: cover;
          border: 1px solid var(--border-color); }
        .who-text { display: inline-flex; flex-direction: column; line-height: 1.2; }
        .who-text .native { color: var(--text-muted); font-size: 0.8rem; font-weight: 400; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
        .grid :global(.card) { display: flex; flex-direction: column; gap: 0.4rem; text-decoration: none;
          color: var(--text-primary); background: var(--bg-tertiary); border: 1px solid var(--border-color);
          border-radius: 10px; padding: 0.6rem; }
        .grid :global(.card):hover { border-color: var(--border-hover); }
        /* .poster > img, NOT .card img: the card also holds the character
           circles, and a descendant selector here won them on specificity and
           stretched each one into a 2:3 poster of its own. */
        .poster { position: relative; display: block; width: 100%; }
        .poster > img { width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 6px; display: block; }
        .noimg { width: 100%; aspect-ratio: 2 / 3; border-radius: 6px; background: var(--bg-secondary);
          display: flex; align-items: center; justify-content: center; color: var(--text-muted); }

        /* Bottom-anchored, and wrap-reverse so a second row grows UPWARD: a
           poster's subject is far more often at the top than the bottom, and a
           row growing downward would hang off the art entirely. pointer-events:
           none keeps the whole card one click target — the circles are a label,
           not a control. */
        .faces { position: absolute; left: 6px; right: 6px; bottom: 6px;
          display: flex; flex-wrap: wrap-reverse; gap: 4px; pointer-events: none; }
        .face { aspect-ratio: 1; border-radius: 50%; object-fit: cover;
          object-position: top center; background: var(--bg-secondary);
          border: 2px solid rgba(0, 0, 0, 0.55); box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55); }
        .face-main { border-color: var(--accent-primary); }

        /* One face is the common case, and it is sized to be READ rather than to
           a tidy fraction: 70% of the poster, picked on the 4K-at-300%-zoom TV
           where a quarter-width circle was still too small to tell a character
           by. It stays clear of the title band because the poster is 2:3 — 70%
           of the width is only 47% of the height. Past one the row is shared,
           and each subtraction is what the gaps eat, so a row lands on exactly
           100% instead of overflowing and wrapping one short. Four is the floor:
           a fifth face wraps rather than shrinking into an unreadable dot. */
        .faces-1 .face { width: 70%; }
        .faces-2 .face { width: calc(50% - 2px); }
        .faces-3 .face { width: calc(33.333% - 2.7px); }
        .faces-4 .face { width: calc(25% - 3px); }
        .body { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; align-items: flex-start; }
        .title { font-size: 0.88rem; font-weight: 600; line-height: 1.25; overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .grid :global(.card):hover .title { text-decoration: underline; }
        .meta { display: flex; flex-wrap: wrap; gap: 0.5rem; color: var(--text-muted); font-size: 0.75rem; }
        .meta .mean { color: var(--accent-primary); }
        .role { color: var(--text-secondary); font-size: 0.75rem; }
        .chars { display: flex; flex-wrap: wrap; gap: 0.25rem; }
        /* Text only: the portrait lives on the poster, so putting it here too
           would say the same thing twice in a quarter of the space. */
        .char { color: var(--text-secondary); font-size: 0.72rem; padding: 1px 6px; border-radius: 999px;
          background: var(--bg-secondary); border: 1px solid var(--border-color); }
        /* char-main, not main: styled-jsx scopes a rule to this file, but it does
           NOT stop globals.css from ALSO matching the bare class name — and
           .main there is the page shell's min-height: calc(100vh - 80px), which
           rendered every MAIN-role chip as a full-height lozenge. Keep modifier
           names on these pages prefixed. (No backticks in here: this whole block
           is a template literal, and one would close it.) */
        .char.char-main { color: var(--accent-primary); border-color: var(--accent-primary); }

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
  if ((type !== 'studio' && type !== 'staff' && type !== 'seiyuu') || !Number.isInteger(id)) {
    return { notFound: true };
  }
  // Catalog fields (studios/staff/cast) only, so the personal-state cache caveat
  // doesn't apply — the shared cached catalog is fine (see similarByCredits.ts).
  const catalog = getAnimeForDisplay();
  // The cast slice is read ONLY on the seiyuu branch: it is the bulkiest AniList
  // payload there is, and parsing it to render a studio filmography would tax
  // the other two types for data they never look at.
  const result = type === 'studio'
    ? listAnimeByStudio(id, catalog)
    : type === 'seiyuu'
      ? listAnimeBySeiyuu(id, catalog, getAllAnilistCast())
      : listAnimeByStaff(id, catalog);
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
      nameNative: result.nameNative ?? null,
      image: result.image ?? null,
      items: JSON.parse(JSON.stringify(sortAnimeRecords(records, state.sortBy, state.sortDir).map(toCredited))),
      total: result.records.length,
      availableGenres: Array.from(genreNames).sort((a, b) => a.localeCompare(b)),
      castCovered: result.castCovered ?? null,
      catalogTotal: catalog.length,
    },
  };
};
