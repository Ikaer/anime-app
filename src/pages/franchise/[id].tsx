/**
 * `/franchise/[id]` — one franchise as a watch order.
 *
 * The question is "I want to watch this thing, in what order, and where am I" —
 * which the main list cannot express (a connected-component question, not a
 * filter combination) and which none of the existing franchise surfaces answer:
 * `/quick-rate` reaches the same components to bulk-RATE them, `/catch-up` asks
 * only what is ABSENT from franchises you already finished something of, and
 * the detail page's "Anime liés" section is an unordered pile of edges.
 *
 * ## The id is a MEMBER, not a franchise
 *
 * A franchise has no id of its own — it is a component derived from relation
 * data that changes on every AniList sync, which is exactly why `/boxes` stores
 * canonical ids rather than a franchise key. So the URL names a member and the
 * page renders the component containing it. Two consequences, both deliberate:
 * every member of a franchise is a valid URL for it, and no redirect
 * canonicalizes them (there is nothing stable to canonicalize TO). The member
 * you arrived by is marked in the line instead, which on an 11-row list is the
 * thing you actually want to know.
 *
 * ## Server-rendered, like the detail page it is reached from
 *
 * Grouping is O(catalog) over ~25k records, so it happens here and only the
 * lean `FranchiseEntry[]` crosses the wire — the same posture as
 * `/api/anime/catch-up` and `/api/anime/quick-rate`. It needs no API route of
 * its own because nothing on the page refetches: the one control is the scope
 * toggle, which is a URL key and therefore a navigation. Measured on the live
 * store, both indexes cost 51ms and 47ms to build once per bundle and 0ms
 * after — they are memoized on the row array's identity, so they rebuild
 * exactly when a slice file actually changed.
 *
 * `titleLang` is a prop rather than `useTitleLanguage()` for the reason every
 * SSR page here takes it as one: the hook's pre-fetch value is
 * `SHIPPED_TITLE_LANGUAGE`, which would paint the wrong headline for one frame.
 */
import Head from 'next/head';
import Link from 'next/link';
import type { GetServerSideProps } from 'next';
import { getAnimeByCanonicalId, getAnimeForDisplay, isCanonicalId } from '@/lib/store';
import { getFranchiseIndex, type FranchiseScope } from '@/lib/domain/franchise';
import { buildFranchiseView, type FranchiseView } from '@/lib/domain/franchiseOrder';
import { getTitleLanguage } from '@/lib/config/settings';
import type { TitleLanguage } from '@/lib/url/viewDefaults';
import { useT, type TFunction, type TranslationKey } from '@/lib/i18n';

interface Props {
  /** The member the page was opened from — the "you are here" row. */
  focusId: string;
  focusTitle: string;
  view: FranchiseView;
  scope: FranchiseScope;
  /**
   * Member count under BOTH scopes, so the toggle can say what it would do
   * before you press it. Cheap: the other index is memoized too.
   */
  counts: { franchise: number; direct: number };
  titleLang: TitleLanguage;
}

const STATUS_ICON: Record<string, string> = {
  watching: '📺',
  completed: '✅',
  on_hold: '⏸️',
  dropped: '🗑️',
  plan_to_watch: '📅',
};

/** "2007-12-01" -> "12/2007". Fixed locale: see the note in `anime/[id].tsx`. */
function fmtMonth(d: string | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return `${String(parsed.getUTCMonth() + 1).padStart(2, '0')}/${parsed.getUTCFullYear()}`;
}

function statusLabel(status: string | undefined, t: TFunction): string {
  return status ? t(`statusShort.${status}` as TranslationKey) : '';
}

export default function FranchisePage({
  focusId,
  focusTitle,
  view,
  scope,
  counts,
}: Props) {
  const t = useT();
  const { entries, progress, nextUpId, unairedCount } = view;
  const nextUp = entries.find(e => e.id === nextUpId);
  const done = progress.completed;
  const pct = progress.total > 0 ? Math.round((done / progress.total) * 100) : 0;
  const otherScope: FranchiseScope = scope === 'direct' ? 'franchise' : 'direct';

  return (
    <div className="fr-page">
      <Head>
        <title>{t('franchise.pageTitle', { name: view.name })}</title>
      </Head>

      <nav className="crumbs">
        <Link href={`/anime/${focusId}`}>← {focusTitle}</Link>
      </nav>

      <header className="fr-head">
        <div className="fr-id">
          <span className="kicker">{t('franchise.kicker')}</span>
          <h1 className="fr-title">{view.name}</h1>
          <p className="fr-sub">
            {/* French agrees in number and this app has no plural machinery, so
                the singular is a separate key chosen inline. Written as a ternary
                over two literals rather than a built-up `...One` string: a
                constructed key needs a `TranslationKey` cast, and the cast is
                exactly what switches off the missing-key compile check. Only the
                counts that actually inflect get a variant — "1 en cours" and
                "1 à venir" are already correct. */}
            {t(progress.total === 1 ? 'franchise.entryCountOne' : 'franchise.entryCount', { count: progress.total })}
            {progress.episodesTotal > 0 && ` · ${t(progress.episodesTotal === 1 ? 'franchise.episodeCountOne' : 'franchise.episodeCount', { count: progress.episodesTotal })}`}
            {unairedCount > 0 && ` · ${t('franchise.unairedCount', { count: unairedCount })}`}
          </p>
        </div>

        {/* The scope toggle is /catch-up's « suites directes », and it is the
            one real defence against the handful of giant components: measured
            on the live store, only 10 of 2,542 multi-member franchises exceed
            30 entries, but those chain whole unrelated series together (Gundam
            is 131 wide, and narrows to 24). It states both counts so the effect
            is visible before the click. */}
        <Link
          className={scope === 'direct' ? 'scope-btn on' : 'scope-btn'}
          href={`/franchise/${focusId}${otherScope === 'direct' ? '?dr=1' : ''}`}
        >
          {scope === 'direct' ? t('franchise.scopeAll') : t('franchise.scopeDirect')}
          <span className="scope-n">
            {otherScope === 'direct' ? counts.direct : counts.franchise}
          </span>
        </Link>
      </header>

      {/* ---------- Progress ---------- */}
      <section className="prog">
        <div className="prog-bar" role="presentation">
          <span className="prog-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="prog-legend">
          <strong>{t(progress.total === 1 ? 'franchise.progressOne' : 'franchise.progress', { done, total: progress.total })}</strong>
          {progress.started > 0 && <span>{t('franchise.started', { count: progress.started })}</span>}
          {progress.dropped > 0 && <span>{t(progress.dropped === 1 ? 'franchise.droppedOne' : 'franchise.dropped', { count: progress.dropped })}</span>}
          {progress.untouched > 0 && <span>{t(progress.untouched === 1 ? 'franchise.untouchedOne' : 'franchise.untouched', { count: progress.untouched })}</span>}
          {progress.episodesRemaining > 0 && (
            <span className="remaining">
              {t(progress.episodesRemaining === 1 ? 'franchise.episodesRemainingOne' : 'franchise.episodesRemaining', { count: progress.episodesRemaining })}
            </span>
          )}
        </div>
      </section>

      {/* ---------- Next up ---------- */}
      {nextUp ? (
        <Link href={`/anime/${nextUp.id}`} className="next">
          <div className="next-poster">
            {nextUp.picture ? <img src={nextUp.picture} alt="" /> : <span className="noimg">?</span>}
          </div>
          <div className="next-body">
            <span className="next-kicker">{t('franchise.nextUp')}</span>
            <span className="next-title">
              {t('franchise.positionOf', { position: nextUp.position, total: progress.total })} · {nextUp.title}
            </span>
            <span className="next-meta">
              {fmtMonth(nextUp.startDate)}
              {nextUp.mediaType && ` · ${nextUp.mediaType.toUpperCase()}`}
              {nextUp.numEpisodes ? ` · ${t('franchise.eps', { count: nextUp.numEpisodes })}` : ''}
              {nextUp.status === 'watching' && nextUp.progress
                ? ` · ${t('franchise.resumeAt', { progress: nextUp.progress })}`
                : ''}
            </span>
          </div>
        </Link>
      ) : (
        <p className="uptodate">{t('franchise.upToDate')}</p>
      )}

      {/* ---------- The line ---------- */}
      <ol className="line">
        {entries.map(e => {
          const cls = [
            'row',
            e.isFocus ? 'is-focus' : '',
            e.id === nextUpId ? 'is-next' : '',
            e.status === 'completed' ? 'is-done' : '',
            e.airing === 'not_yet_aired' ? 'is-unaired' : '',
          ].filter(Boolean).join(' ');
          return (
            <li key={e.id} className={cls}>
              <Link href={`/anime/${e.id}`} className="row-link">
                <span className="pos">{e.position}</span>
                <span className="thumb">
                  {e.picture ? <img src={e.picture} alt="" /> : <span className="noimg">?</span>}
                </span>
                <span className="row-body">
                  <span className="row-title">
                    {e.title}
                    {e.isFocus && <span className="here">{t('franchise.youAreHere')}</span>}
                  </span>
                  <span className="row-meta">
                    {fmtMonth(e.startDate)}
                    {e.mediaType && ` · ${e.mediaType.toUpperCase()}`}
                    {e.numEpisodes ? ` · ${t('franchise.eps', { count: e.numEpisodes })}` : ''}
                    {e.airing === 'not_yet_aired' && ` · ${t('airing.not_yet_aired')}`}
                    {e.airing === 'currently_airing' && ` · ${t('airing.currently_airing')}`}
                  </span>
                </span>
                <span className="row-right">
                  {e.status && (
                    <span className={`st st-${e.status}`}>
                      {STATUS_ICON[e.status]} {statusLabel(e.status, t)}
                      {e.status === 'watching' && e.progress ? ` ${e.progress}${e.numEpisodes ? `/${e.numEpisodes}` : ''}` : ''}
                    </span>
                  )}
                  {e.score ? <span className="my-score">{e.score}</span> : null}
                  {e.mean ? <span className="mean">☆ {e.mean.toFixed(2)}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      {/* The order is a claim about data we have, and the page says which. */}
      <p className="hint">{t('franchise.orderHint')}</p>

      <style jsx>{`
        .fr-page { max-width: 1000px; margin: 0 auto; padding: 1rem 1.25rem 3rem;
          display: flex; flex-direction: column; gap: 1rem; }

        /* Every rule below that targets a class carried by a next/link is
           wrapped in :global(), and scoped by hand under .fr-page. styled-jsx
           only rewrites className on DOM elements — a className handed to a
           COMPONENT is passed through untouched, so the scoped form matches
           nothing and the rule silently does nothing. Same arrangement, same
           reason, as .related :global(.related-card) on the detail page; the
           symptom here was every row rendering as a stack instead of a line. */
        .crumbs :global(a) { color: var(--text-secondary); text-decoration: none; font-size: 0.85rem; }
        .crumbs :global(a):hover { color: var(--accent-primary); }

        .fr-head { display: flex; align-items: flex-start; justify-content: space-between;
          gap: 1rem; flex-wrap: wrap; }
        .fr-id { min-width: 0; }
        .kicker { color: var(--text-muted); font-size: 0.72rem; text-transform: uppercase;
          letter-spacing: 0.06em; }
        .fr-title { margin: 2px 0 4px; font-size: 1.6rem; color: var(--text-primary); line-height: 1.2; }
        .fr-sub { margin: 0; color: var(--text-secondary); font-size: 0.85rem; }

        .fr-page :global(.scope-btn) { display: inline-flex; align-items: center; gap: 0.45rem; white-space: nowrap;
          padding: 0.35rem 0.7rem; border-radius: 999px; text-decoration: none; font-size: 0.82rem;
          background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-secondary); }
        .fr-page :global(.scope-btn):hover { border-color: var(--accent-primary); color: var(--text-primary); }
        .fr-page :global(.scope-btn.on) { border-color: var(--accent-primary); color: var(--text-primary); }
        .scope-n { padding: 0 0.4rem; border-radius: 999px; background: var(--bg-primary);
          border: 1px solid var(--border-color); font-size: 0.75rem; }

        .prog { display: flex; flex-direction: column; gap: 6px; }
        .prog-bar { height: 6px; border-radius: 999px; background: var(--bg-secondary);
          border: 1px solid var(--border-color); overflow: hidden; }
        .prog-fill { display: block; height: 100%; background: #16a34a; }
        .prog-legend { display: flex; gap: 0.9rem; flex-wrap: wrap; color: var(--text-secondary);
          font-size: 0.82rem; }
        .prog-legend strong { color: var(--text-primary); font-weight: 600; }
        .remaining { color: var(--text-muted); }

        .fr-page :global(.next) { display: flex; gap: 0.85rem; align-items: center; text-decoration: none;
          padding: 0.7rem; border-radius: 10px; background: var(--bg-primary);
          border: 1px solid var(--accent-primary); }
        .fr-page :global(.next):hover { background: var(--bg-secondary); }
        .next-poster { width: 54px; height: 78px; flex: none; border-radius: 6px; overflow: hidden;
          background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; }
        .next-poster img { width: 100%; height: 100%; object-fit: cover; }
        .next-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
        .next-kicker { color: var(--accent-primary); font-size: 0.72rem; text-transform: uppercase;
          letter-spacing: 0.06em; }
        .next-title { color: var(--text-primary); font-size: 1rem; font-weight: 600; }
        .next-meta { color: var(--text-secondary); font-size: 0.8rem; }

        .uptodate { margin: 0; padding: 0.7rem 0.85rem; border-radius: 10px;
          background: var(--bg-primary); border: 1px solid var(--border-color);
          color: var(--text-secondary); font-size: 0.9rem; }

        .line { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
        .row { border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); }
        .row.is-focus { border-color: var(--text-secondary); }
        .row.is-next { border-color: var(--accent-primary); }
        .row.is-done { opacity: 0.72; }
        .row.is-unaired { border-style: dashed; }

        .fr-page :global(.row-link) { display: flex; align-items: center; gap: 0.7rem; padding: 0.45rem 0.6rem;
          text-decoration: none; min-width: 0; }
        .fr-page :global(.row-link):hover { background: var(--bg-secondary); border-radius: 8px; }

        .pos { flex: none; width: 1.9rem; text-align: center; color: var(--text-muted);
          font-size: 0.9rem; font-variant-numeric: tabular-nums; }
        .row.is-done .pos { color: #16a34a; }

        .thumb { flex: none; width: 34px; height: 48px; border-radius: 4px; overflow: hidden;
          background: var(--bg-secondary); display: flex; align-items: center; justify-content: center; }
        .thumb img { width: 100%; height: 100%; object-fit: cover; }
        .noimg { color: var(--text-muted); font-size: 0.7rem; }

        .row-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
        .row-title { color: var(--text-primary); font-size: 0.92rem; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap; }
        .here { margin-left: 0.45rem; padding: 0 0.35rem; border-radius: 4px; font-size: 0.68rem;
          background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-secondary); }
        .row-meta { color: var(--text-muted); font-size: 0.75rem; }

        .row-right { display: flex; align-items: center; gap: 0.4rem; flex: none; }
        .st { padding: 0.1rem 0.4rem; border-radius: 999px; font-size: 0.72rem; white-space: nowrap;
          background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-secondary); }
        .st-completed { color: #16a34a; }
        .st-dropped { color: #dc2626; }
        .my-score { min-width: 1.6rem; text-align: center; padding: 0.1rem 0.35rem; border-radius: 4px;
          font-size: 0.8rem; font-weight: 600; color: var(--text-primary); background: var(--bg-secondary);
          border: 1px solid var(--border-color); }
        .mean { color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; }

        .hint { margin: 0; color: var(--text-muted); font-size: 0.76rem; }

        @media (max-width: 640px) {
          .row-right .mean { display: none; }
        }
      `}</style>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const raw = String(ctx.params?.id);
  if (!isCanonicalId(raw)) return { notFound: true };

  const focus = getAnimeByCanonicalId(raw);
  if (!focus) return { notFound: true };

  const scope: FranchiseScope = ctx.query.dr === '1' ? 'direct' : 'franchise';
  const catalog = getAnimeForDisplay();
  const titleLang = getTitleLanguage();

  // Both scopes: one to render, the other only for the toggle's count. Each is
  // ~50ms once per bundle and 0 after (memoized on the row array's identity).
  const franchiseIdx = getFranchiseIndex(catalog, 'franchise');
  const directIdx = getFranchiseIndex(catalog, 'direct');
  // A title with no in-catalog relations is in no index; it is its own franchise
  // of one, which the page renders honestly rather than 404ing.
  const members = (scope === 'direct' ? directIdx : franchiseIdx).get(focus.id) ?? [focus];

  const view = buildFranchiseView(
    // Hidden titles are excluded everywhere else a franchise is grouped; a watch
    // order that lists something you deliberately hid would be the odd one out.
    members.filter(m => !m.hidden || m.id === focus.id),
    focus.id,
    titleLang
  );

  return {
    props: {
      focusId: focus.id,
      focusTitle: view.entries.find(e => e.isFocus)?.title ?? view.name,
      // AnimeRecord-derived objects carry `undefined` fields, which Next cannot
      // serialize — same round-trip as every other page here.
      view: JSON.parse(JSON.stringify(view)),
      scope,
      counts: {
        franchise: (franchiseIdx.get(focus.id) ?? [focus]).length,
        direct: (directIdx.get(focus.id) ?? [focus]).length,
      },
      titleLang,
    },
  };
};
