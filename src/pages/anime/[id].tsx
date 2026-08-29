import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { getAnimeByCanonicalId, getAnimeForDisplay, resolveByMalId, isCanonicalId, getAnilistCast } from '@/lib/store';
import type { AnimeRecord, AnimeCatalog, AniListCharacterEntry, AniListStaffEntry, Discrepancy, ProvenanceSource, ProviderPersonalState } from '@/models/anime';
import { getEffectiveStatus, getEffectiveScore, getEffectiveProgress, formatUserStatus, formatSeason, getPrimaryTitle, getSecondaryTitle, catalogFieldOrigins, type CatalogFieldOrigin } from '@/lib/domain/animeUtils';
import { groupStaffByTier, getStaffAffinity, pickStaffAffinity, type StaffRoleTier } from '@/lib/domain/staffRole';
import { getCatalogPrecedenceByField, getTitleLanguage } from '@/lib/config/settings';
import { generateGoogleORQuery, generateJustWatchQuery } from '@/lib/domain/searchLinks';
import { computeSimilarByCredits, type SimilarByCredits } from '@/lib/reco/byCredits';
import type { TitleLanguage } from '@/lib/url/viewDefaults';
import { buildRelationIndex, resolveRelations } from '@/lib/domain/relations';
import { getFranchiseIndex } from '@/lib/domain/franchise';
import { canClearStatus } from '@/lib/providers/registry';
import { RefreshButton } from '@/components/shared';
import { MoreLikeThis, PersonalStateEditor, CastSection, ProvenanceChip } from '@/components/anime';
import { useT, type TFunction, type TranslationKey } from '@/lib/i18n';

/**
 * A relation, projected for display. Lean on purpose: a resolved relation holds
 * the whole target record, and shipping ~20 of those would dwarf the page.
 */
interface RelatedItem {
  id: string;
  title: string;
  picture?: string;
  relation: string;
}

interface Props {
  anime: AnimeRecord;
  /**
   * The title-language preference, resolved server-side and passed down rather
   * than read from `useTitleLanguage()` like the client-fetched pages do. This
   * page renders its title in `getServerSideProps`, so the hook's pre-fetch
   * `SHIPPED_TITLE_LANGUAGE` would show an English title for one paint and then
   * swap it — a visible flicker on the one surface where the title is the
   * headline. Same reason the credits page takes it as a prop.
   */
  titleLang: TitleLanguage;
  similar: SimilarByCredits[];
  /** Relations from BOTH providers, resolved to canonical ids — see
   *  `domain/relations.ts`. MAL's `catalog.relatedAnime` alone covers 48 titles
   *  catalog-wide, so reading it directly left this section blank almost
   *  everywhere. */
  related: RelatedItem[];
  /** Cached cast, or `null` when this title has never been fetched — the
   *  CastSection then fills it once from AniList. Passed separately from
   *  `anime` because cast lives in its own slice, off the hydration path
   *  (see `AniListCastEntry`). */
  cast: AniListCharacterEntry[] | null;
  /**
   * Per-catalog-field origin, for the inline provenance chips — which provider
   * supplied each displayed value, and whether precedence had to arbitrate.
   * Computed server-side under the *resolved* per-field ordering (the user's
   * `/settings` overrides included), for the same reason `/precedence` reads it
   * rather than the shipped constant: the page must describe the merge the
   * record was actually built with.
   */
  origins: Partial<Record<keyof AnimeCatalog, CatalogFieldOrigin>>;
  /** No writable external provider connected — gates the status "clear"
   *  affordance (see `PersonalPatch`). */
  canClearStatus: boolean;
  /**
   * `{ staffId: count }` — how many of the user's statused titles each headline
   * (T1) credit on this title also holds a T1 credit on, for the "N dans ta
   * liste" mark. Only entries clearing `STAFF_AFFINITY_MIN` are sent.
   *
   * **Empty on a title the user has already watched**, deliberately: measured,
   * the mark fires on 56% of T1 rows there (of course a watched show's staff
   * recur in your list) versus 15.8% on unseen ones, where it is a genuine
   * discovery signal rather than decoration.
   */
  staffAffinity: Record<number, number>;
  /**
   * How many titles the franchise containing this one holds (`FRANCHISE_RELATIONS`
   * scope). Only its size is needed — the link to `/franchise/[id]` is offered
   * when it is >1, and that page does the grouping again for itself.
   */
  franchiseSize: number;
}

// ---------------------------------------------------------------------------
// Small formatting helpers (local-only, no dependencies on the app's UI kit)
// ---------------------------------------------------------------------------

function fmtDate(d?: string): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  // Fixed locale (not the runtime default): the server's Node locale and the
  // browser's locale can disagree, and toLocaleDateString() with no locale
  // arg then renders differently on each side, tripping a hydration mismatch.
  return parsed.toLocaleDateString('fr-FR');
}

function fmtDuration(seconds?: number): string {
  if (!seconds) return '—';
  const min = Math.round(seconds / 60);
  return `${min} min`;
}

function fmtNum(n?: number): string {
  if (n == null) return '—';
  // Fixed locale, same reasoning as fmtDate above: the runtime-default locale
  // differs between the server (Node) and the browser, tripping hydration.
  return n.toLocaleString('fr-FR');
}

function fmtScore(n?: number | null): string {
  return n != null && n > 0 ? String(n) : '—';
}

function airingLabel(status: string | undefined, t: TFunction): string {
  switch (status) {
    case 'currently_airing':
    case 'finished_airing':
    case 'not_yet_aired':
      return t(`airing.${status}` as TranslationKey);
    default: return status || '—';
  }
}

/** Localize a personal watch status ('watching' → "En cours"), '—' when absent. */
function statusLabel(status: string | null | undefined, t: TFunction): string {
  return status ? t(`statusShort.${status}` as TranslationKey) : '—';
}

/**
 * "MAL 7 · SIMKL 8 · Local 8" — one dimension of a discrepancy, rendered across
 * however many providers hold the title.
 */
function discLine(
  disc: Discrepancy,
  t: TFunction,
  render: (s: ProviderPersonalState) => string
): string {
  return (Object.entries(disc.providers) as [ProvenanceSource, ProviderPersonalState][])
    .filter(([, s]) => s.present)
    .map(([p, s]) => `${t(`disc.provider.${p}` as TranslationKey)} ${render(s)}`)
    .join(' · ');
}

export default function AnimeDetailPage({ anime, similar, related, cast, origins, canClearStatus, staffAffinity, titleLang, franchiseSize }: Props) {
  const t = useT();
  const router = useRouter();
  const poster = anime.catalog.mainPicture?.large || anime.catalog.mainPicture?.medium || '';
  const en = anime.catalog.alternativeTitles?.en;
  const ja = anime.catalog.alternativeTitles?.ja;
  const synonyms = anime.catalog.alternativeTitles?.synonyms || [];
  const primaryTitle = getPrimaryTitle(anime, titleLang);
  const secondaryTitle = getSecondaryTitle(anime, titleLang);
  const titleField = (shown: string) => (shown === anime.catalog.title ? 'title' : 'alternativeTitles');
  const titleOrigin = (shown: string) =>
    (shown === anime.catalog.title ? origins.title : origins.alternativeTitles);

  const mal = anime.sources.malPersonal;
  const simkl = anime.sources.simkl;
  const disc = anime.discrepancy;
  const tags = anime.sources.anilist?.tags || [];
  const staff = anime.sources.anilist?.staff || [];
  // Pure lookup over ≤50 entries — cheap enough to run on render rather than
  // shipping a fifth pre-grouped prop.
  const staffTiers = groupStaffByTier(staff);
  const crosswalk = anime.crosswalk || {};

  // Raw per-provider personal state, in precedence-ish reading order. Raw on
  // purpose, and a legitimate `sources.*` read under the E7 rule: this table
  // exists to show WHERE the effective value came from and where the providers
  // disagree, so a merged value is precisely what it must not show.
  const local = anime.sources.local;
  const anilistPersonal = anime.sources.anilistPersonal;
  const providerLines: {
    provider: ProvenanceSource;
    status?: string;
    score?: number | null;
    progress?: number | null;
    total?: number | null;
  }[] = [
    { provider: 'mal', status: mal?.status, score: mal?.score, progress: mal?.num_episodes_watched, total: anime.catalog.numEpisodes },
    { provider: 'simkl', status: simkl?.status, score: simkl?.score, progress: simkl?.num_episodes_watched, total: simkl?.total_episodes },
    // AniList and local only show up once they hold something — an empty row is
    // noise for a MAL/SIMKL user whose other providers are off entirely.
    // AniList was missing here altogether: it is a full personal provider that
    // takes part in discrepancy detection, so the table that explains a
    // discrepancy could not show the entry causing it.
    ...(anilistPersonal ? [{ provider: 'anilist' as ProvenanceSource, status: anilistPersonal.status, score: anilistPersonal.score, progress: anilistPersonal.progress, total: anime.catalog.numEpisodes }] : []),
    ...(local ? [{ provider: 'local' as ProvenanceSource, status: local.status, score: local.score, progress: local.progress, total: anime.catalog.numEpisodes }] : []),
  ];

  const effStatus = getEffectiveStatus(anime);
  const effScore = getEffectiveScore(anime);
  const effProgress = getEffectiveProgress(anime);

  // Not `primaryTitle`: this feeds the Google/JustWatch links, and those index
  // Latin-script titles — see the same note in AnimeCardView. Deliberately
  // independent of `titleLanguage`.
  const searchTitle = en || anime.catalog.title;
  const anilistId = anime.sources.anilist?.anilist_id ?? crosswalk.anilist;

  // Page backdrop. AniList's landscape banner is the real thing (it's what Plex
  // shows); the portrait poster is the fallback and needs a heavier blur, since
  // cover-cropping it to a wide viewport leaves only a thin, meaningless band.
  const banner = anime.sources.anilist?.banner_image || '';
  const backdrop = banner || poster;

  // Cross-source id rows worth surfacing, in a stable order.
  const idRows: Array<[string, string | number | undefined, string | undefined]> = [
    ['MAL', crosswalk.mal, `https://myanimelist.net/anime/${crosswalk.mal}`],
    ['SIMKL', crosswalk.simkl ?? simkl?.simkl_id, (crosswalk.simkl ?? simkl?.simkl_id) ? `https://simkl.com/anime/${crosswalk.simkl ?? simkl?.simkl_id}` : undefined],
    ['AniList', anilistId, anilistId ? `https://anilist.co/anime/${anilistId}` : undefined],
    ['AniDB', crosswalk.anidb, undefined],
    ['Kitsu', crosswalk.kitsu, undefined],
    ['TMDB', crosswalk.tmdb, undefined],
    ['IMDB', crosswalk.imdb, crosswalk.imdb ? `https://www.imdb.com/title/${crosswalk.imdb}` : undefined],
  ];

  return (
    <>
      <Head>
        <title>{t('detail.pageTitle', { title: primaryTitle })}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>

      {/* Full-page backdrop, scrimmed, behind every section. Two layers: a blurred
          fill that colors the whole viewport, and — when AniList gave us a banner —
          the crisp art at its natural width, anchored to the top like Plex. */}
      {backdrop && (
        <div className={`backdrop ${banner ? 'is-banner' : 'is-poster'}`} aria-hidden="true">
          <img className="ambient" src={backdrop} alt="" />
          {banner && <img className="art" src={banner} alt="" />}
          <div className="grain" />
        </div>
      )}

      <div className="page">
        <div className="topbar">
          <Link href="/" className="back">{t('detail.back')}</Link>
          <div className="ext-links">
            <Link href={`/rate?id=${crosswalk.mal}`} className="ext-link">{t('detail.rate')}</Link>
            <RefreshButton
              animeId={anime.id}
              onRefreshed={() => {
                router.replace(router.asPath, undefined, { scroll: false })
              }}
            />
            {/* Sits with « Noter » and « Rafraîchir » rather than with the
                external links that follow, because it goes somewhere inside the
                app. Terse like its neighbours; the full phrase is the tooltip.
                Hidden on a franchise of one, where the page would only restate
                this title. */}
            {franchiseSize > 1 && (
              <Link href={`/franchise/${anime.id}`} className="ext-link" title={t('franchise.link')}>
                🎬 {t('franchise.button')}
              </Link>
            )}
            <a href={`https://myanimelist.net/anime/${crosswalk.mal}`} target="_blank" rel="noopener noreferrer">MAL</a>
            {(simkl?.simkl_id || crosswalk.simkl) && (
              <a href={`https://simkl.com/anime/${simkl?.simkl_id ?? crosswalk.simkl}`} target="_blank" rel="noopener noreferrer">SIMKL</a>
            )}
            {anilistId && (
              <a href={`https://anilist.co/anime/${anilistId}`} target="_blank" rel="noopener noreferrer">AniList</a>
            )}
            <a href={generateGoogleORQuery(searchTitle)} target="_blank" rel="noopener noreferrer">Google</a>
            <a href={generateJustWatchQuery(searchTitle)} target="_blank" rel="noopener noreferrer">JustWatch</a>
          </div>
        </div>

        {/* ---------- Header ---------- */}
        {/* `hero`, not `header`: globals.css styles `.header` as the sticky site navbar. */}
        <header className="hero">
          {poster
            ? <img className="poster" src={poster} alt={primaryTitle} />
            : <div className="poster noimg">{t('common.noImage')}</div>}
          <div className="head-info">
            {/* Which CATALOG FIELD supplied each line depends on the user's
                `titleLanguage`, so the chips are derived from the rendered string
                rather than assumed. Before the preference existed the primary was
                always `alternativeTitles.en` and the secondary always
                `catalog.title`; hardcoding that now mislabels every romaji or
                native reader. `titleField` compares against `catalog.title`
                because that is the only one of the three that is its own field —
                both `en` and `ja` live under `alternativeTitles`. */}
            <h1>{primaryTitle}<ProvenanceChip field={titleField(primaryTitle)} origin={titleOrigin(primaryTitle)} /></h1>
            {secondaryTitle && <div className="alt">{secondaryTitle}<ProvenanceChip field={titleField(secondaryTitle)} origin={titleOrigin(secondaryTitle)} /></div>}
            {/* The Japanese title gets its own line only when it is not already
                one of the two above — under `native` it IS the primary. */}
            {ja && ja !== primaryTitle && ja !== secondaryTitle && <div className="alt ja">{ja}</div>}
            {synonyms.length > 0 && <div className="synonyms">{t('detail.alsoKnown', { names: synonyms.join(' · ') })}</div>}
            <div className="badges">
              <span className={`airing ${anime.catalog.airingStatus || ''}`}>{airingLabel(anime.catalog.airingStatus, t)}</span>
              {anime.catalog.mediaType && <span className="pill">{anime.catalog.mediaType.toUpperCase()}</span>}
              {anime.catalog.startSeason && (
                <span className="pill" style={{ color: formatSeason(anime.catalog.startSeason.year, anime.catalog.startSeason.season, t).color }}>
                  {formatSeason(anime.catalog.startSeason.year, anime.catalog.startSeason.season, t).label}
                </span>
              )}
              {anime.catalog.nsfw && anime.catalog.nsfw !== 'white' && <span className="pill nsfw">NSFW: {anime.catalog.nsfw}</span>}
              {anime.hidden && <span className="pill hidden">{t('detail.hidden')}</span>}
            </div>
            {anime.catalog.synopsis && (
              <p className="prose synopsis">
                {anime.catalog.synopsis}
                <ProvenanceChip field="synopsis" origin={origins.synopsis} />
              </p>
            )}
          </div>
          {/* Third column, sitting under the action buttons of the topbar. */}
          {((anime.catalog.genres && anime.catalog.genres.length > 0) || (anime.catalog.studios && anime.catalog.studios.length > 0)) && (
            <div className="head-meta">
              {anime.catalog.genres && anime.catalog.genres.length > 0 && (
                <div className="head-chips">
                  {/* One chip for the whole group, not one per genre: the list is
                      unioned element-wise, so provenance is a property of the list
                      rather than of any one name. */}
                  <ProvenanceChip field="genres" origin={origins.genres} />
                  {/* keyed on name, not id: unioned AniList genres all carry the
                      synthetic id 0, so two of them on one title would collide */}
                  {anime.catalog.genres.map(g => <span key={g.name} className="chip">{g.name}</span>)}
                </div>
              )}
              {anime.catalog.studios && anime.catalog.studios.length > 0 && (
                <div className="head-chips">
                  <ProvenanceChip field="studios" origin={origins.studios} />
                  {anime.catalog.studios.map(s => (
                    <Link key={s.id} href={`/credits/studio/${s.id}`} className="chip studio">🎬 {s.name}</Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </header>

        {/* ---------- Cast (AniList) & Staff (AniList) — a row of their own,
            directly under the hero, cast on the left, staff on the right ---------- */}
        {(staff.length > 0 || cast) && (
          <div className="credits-row">
            <CastSection animeId={anime.id} initialCast={cast} />
            {staff.length > 0 && (
              <section className="section">
                <h2>{t('detail.staffCount', { count: staff.length })}</h2>

                {/* T1 — the auteur block. Full-width rows, name leading, so the
                    five or so names that define the show read before the crew.
                    Can legitimately be empty (shorts, anthologies), hence the
                    guard rather than an assumed head. */}
                {staffTiers[1].length > 0 && (
                  <div className="staff-headline">
                    {staffTiers[1].map(s => (
                      <Link key={`${s.id}-${s.role}`} href={`/credits/staff/${s.id}`} className="headline-row">
                        <span className="headline-name">{s.name}</span>
                        <span className="headline-meta">
                          <span className="headline-role">{s.role}</span>
                          {staffAffinity[s.id] > 0 && (
                            <span className="affinity" title={t('detail.staffInListTitle', { count: staffAffinity[s.id] })}>
                              {t('detail.staffInList', { count: staffAffinity[s.id] })}
                            </span>
                          )}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}

                {/* T2 then T3 — same grid, T3 dimmed. Labelled so the weighting
                    is legible rather than merely felt. */}
                {([2, 3] as StaffRoleTier[]).map(tier => staffTiers[tier].length > 0 && (
                  <div key={tier} className="staff-group">
                    <h3 className="staff-group-label">{t(`detail.staffTier.${tier}` as TranslationKey)}</h3>
                    <StaffRows credits={staffTiers[tier]} dim={tier === 3} />
                  </div>
                ))}

                {/* T4 — key animation, in-betweens, dub crew, promo, admin.
                    Collapsed: it is a third of all credits and none of it is
                    what anyone opened this page for. */}
                {staffTiers[4].length > 0 && (
                  <details className="staff-more">
                    <summary>{t('detail.staffTierMore', { count: staffTiers[4].length })}</summary>
                    {/* Dimmed like T3, not plain: expanded T4 sitting at full
                        weight below a dimmed T3 inverted the whole hierarchy. */}
                    <StaffRows credits={staffTiers[4]} dim />
                  </details>
                )}
              </section>
            )}
          </div>
        )}

        <div className="columns">
        <aside className="col-side">
          {/* ---------- Crowd drill-down (MAL + AniList recos anchored on this title) ---------- */}
          <MoreLikeThis animeId={anime.id} />

          {/* ---------- Similar by staff & studio (production-credit recos) ---------- */}
          {similar.length > 0 && (
            <section className="section">
              <h2>{t('detail.sameStudioStaff')}</h2>
              <p className="reco-sub">{t('detail.sameStudioStaffSub')}</p>
              <div className="reco-cards">
                {similar.map(s => (
                  <Link key={s.id} href={`/anime/${s.id}`} className="reco-card" title={s.title}>
                    {s.poster
                      ? <img src={s.poster} alt="" />
                      : <div className="reco-noimg">?</div>}
                    <div className="reco-body">
                      <span className="reco-title">{s.title}</span>
                      <div className="reco-shared">
                        {s.sharedStudios.map(name => (
                          <span key={`st-${name}`} className="reco-badge studio">🎬 {name}</span>
                        ))}
                        {s.sharedStaff.map(cr => (
                          <span key={`sf-${cr.role}-${cr.name}`} className="reco-badge staff">
                            <span className="reco-role">{cr.role}</span> {cr.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ---------- Related anime ---------- */}
          {related.length > 0 && (
            <section className="section">
              <h2>{t('detail.relatedAnime')}</h2>
              <div className="related">
                {related.map(r => (
                  <Link key={r.id} href={`/anime/${r.id}`} className="related-card" title={r.title}>
                    {r.picture
                      ? <img src={r.picture} alt="" />
                      : <div className="related-noimg">?</div>}
                    <span className="related-rel">{r.relation}</span>
                    <span className="related-title">{r.title}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </aside>

        <main className="col-main">

        {/* ---------- Personal state reconciliation (the point of this page) ---------- */}
        <section className="section">
          <h2>{t('detail.personalState')}</h2>
          {/* The bootstrap surface — the only place an unstatused catalog title can
              become statused + scored. */}
          <PersonalStateEditor
            animeId={anime.id}
            status={effStatus}
            score={effScore}
            progress={effProgress}
            numEpisodes={anime.catalog.numEpisodes}
            canClearStatus={canClearStatus}
            onWritten={() => router.replace(router.asPath, undefined, { scroll: false })}
          />
          {/* One row per provider, not a MAL/SIMKL column pair — the same long
              format the /discrepancies page uses, so a fourth provider costs a
              row rather than a column. */}
          <table className="reco-table">
            <thead>
              <tr>
                <th>{t('discPage.provider')}</th>
                <th>{t('detail.status')}</th>
                <th>{t('detail.score')}</th>
                <th>{t('detail.progress')}</th>
              </tr>
            </thead>
            <tbody>
              {providerLines.map(line => (
                <tr key={line.provider}>
                  <td className="rowlabel">{t(`disc.provider.${line.provider}` as TranslationKey)}</td>
                  <td>{statusLabel(line.status, t)}</td>
                  <td>{fmtScore(line.score)}</td>
                  <td>{line.progress ?? '—'}{line.total ? ` / ${line.total}` : ''}</td>
                </tr>
              ))}
              <tr>
                <td className="rowlabel eff">{t('detail.effective')}</td>
                <td className="eff">{statusLabel(effStatus, t)}</td>
                <td className="eff">{effScore ?? '—'}</td>
                <td className="eff">{effProgress ?? '—'}</td>
              </tr>
            </tbody>
          </table>
          <div className="meta-lines">
            {mal?.is_rewatching && <span>{t('detail.rewatching')}</span>}
            {mal?.updated_at && <span>{t('detail.malUpdated', { date: fmtDate(mal.updated_at) })}</span>}
            {simkl?.watched_at && <span>{t('detail.simklWatched', { date: fmtDate(simkl.watched_at) })}</span>}
          </div>

          {disc && (
            <div className="discrepancy">
              <strong>{t('detail.discTitle')}</strong>
              <ul>
                {disc.presence && (
                  <li>
                    {t('detail.discAbsent', {
                      present: disc.presence.present.map(p => t(`disc.provider.${p}` as TranslationKey)).join(', '),
                      absent: disc.presence.absent.map(p => t(`disc.provider.${p}` as TranslationKey)).join(', '),
                    })}
                  </li>
                )}
                {disc.disagree.status && <li>{t('detail.status')} : {discLine(disc, t, s => statusLabel(s.status, t))}</li>}
                {disc.disagree.score && <li>{t('detail.score')} : {discLine(disc, t, s => String(s.score || '—'))}</li>}
                {disc.disagree.progress && <li>{t('detail.progress')} : {discLine(disc, t, s => String(s.progress ?? '—'))}</li>}
              </ul>
            </div>
          )}
        </section>

        {/* ---------- Catalog facts (MAL authority) ---------- */}
        <section className="section">
          {/* The inspector answers "why does this field hold THAT value" for the
              very fields tabulated below, so its entry point belongs on this
              heading rather than in the topbar's external-links row. */}
          <h2 className="h2-row">
            {t('detail.catalogSheet')}
            <Link href={`/precedence?id=${anime.id}`} className="inspect">{t('detail.inspectPrecedence')}</Link>
          </h2>
          <div className="grid">
            <Field label={t('detail.meanScore')} value={anime.catalog.mean != null ? anime.catalog.mean.toFixed(2) : '—'} field="mean" origin={origins.mean} />
            <Field label={t('field.rank')} value={anime.catalog.rank != null ? `#${anime.catalog.rank}` : '—'} field="rank" origin={origins.rank} />
            <Field label={t('field.popularity')} value={anime.catalog.popularity != null ? `#${anime.catalog.popularity}` : '—'} field="popularity" origin={origins.popularity} />
            <Field label={t('field.users')} value={fmtNum(anime.catalog.numListUsers)} field="numListUsers" origin={origins.numListUsers} />
            <Field label={t('field.scorers')} value={fmtNum(anime.catalog.numScoringUsers)} field="numScoringUsers" origin={origins.numScoringUsers} />
            <Field label={t('field.episodes')} value={anime.catalog.numEpisodes ? String(anime.catalog.numEpisodes) : t('common.tba')} field="numEpisodes" origin={origins.numEpisodes} />
            <Field label={t('detail.durationPerEp')} value={fmtDuration(anime.catalog.averageEpisodeDuration)} field="averageEpisodeDuration" origin={origins.averageEpisodeDuration} />
            <Field label={t('detail.source')} value={anime.catalog.source ? formatUserStatus(anime.catalog.source) : '—'} field="source" origin={origins.source} />
            <Field label={t('detail.rating')} value={anime.catalog.rating || '—'} field="rating" origin={origins.rating} />
            <Field label={t('detail.start')} value={fmtDate(anime.catalog.startDate)} field="startDate" origin={origins.startDate} />
            <Field label={t('detail.end')} value={fmtDate(anime.catalog.endDate)} field="endDate" origin={origins.endDate} />
            {/* No chip on these two: they read a raw MAL slice by nature (K7),
                so there is no precedence question to report. */}
            <Field label={t('detail.addedMal')} value={fmtDate(anime.sources.mal?.created_at)} />
            <Field label={t('detail.updatedMal')} value={fmtDate(anime.sources.mal?.updated_at)} />
          </div>
        </section>

        {/* ---------- AniList tags ---------- */}
        {tags.length > 0 && (
          <section className="section">
            <h2>{t('detail.anilistTagsTitle', { count: tags.length })}</h2>
            <div className="chips">
              {tags.map(tag => (
                <span key={tag.name} className="chip tag" title={tag.category ? t('detail.tagRankCategory', { category: tag.category, rank: tag.rank }) : t('detail.tagRank', { rank: tag.rank })}>
                  {tag.name}<span className="rank">{tag.rank}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ---------- Cross-source id crosswalk ---------- */}
        <section className="section">
          <h2>{t('detail.crosswalk')}</h2>
          <div className="grid ids">
            {idRows.filter(([, v]) => v != null && v !== '').map(([label, value, href]) => (
              <div key={label} className="field">
                <span className="field-label">{label}</span>
                <span className="field-value">
                  {href
                    ? <a href={href} target="_blank" rel="noopener noreferrer">{String(value)}</a>
                    : String(value)}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Background ---------- */}
        {anime.catalog.background && (
          <section className="section">
            <h2>{t('detail.background')}</h2>
            <p className="prose">{anime.catalog.background}</p>
          </section>
        )}

        </main>
        </div>
      </div>

      <style jsx>{`
        .page { position: relative; z-index: 1;
          max-width: 1688px; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; color: var(--text-primary); }

        /* ---------- Page backdrop ---------- */
        /* Knobs. --art-scrim must track --bg-primary. */
        .backdrop {
          --art-scrim: 10, 10, 10;
          --ambient-opacity: 0.55;
          --ambient-blur: 60px;
          --ambient-crop: center 30%;
          /* How far down the viewport the crisp banner reaches before it's gone. */
          --art-fade: 78%;
          --art-opacity: 0.62;
          /* Film grain over the whole backdrop. Set to 0 to remove it entirely. */
          --grain-opacity: 0.22;

          position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
        }
        /* Poster fallback: no crisp layer at all. A portrait cover-cropped to a wide
           viewport is a thin, meaningless band, so it only ever plays the ambient
           role — and there it needs to be stronger, since it's all there is. */
        .backdrop.is-poster {
          --ambient-opacity: 0.9;
          --ambient-blur: 34px;
          --ambient-crop: center 18%;
        }

        /* Ambient fill: covers the viewport, blurred past recognition, pure color. */
        .backdrop .ambient { position: absolute; inset: 0; width: 100%; height: 100%;
          object-fit: cover; object-position: var(--ambient-crop);
          opacity: var(--ambient-opacity);
          filter: blur(var(--ambient-blur)) saturate(1.35) brightness(1.05);
          /* Overflow the edges so the blur doesn't smear the image's own borders inward. */
          transform: scale(1.15); }

        /* Crisp art: natural aspect at full width (AniList banners are ~4.75:1, so at
           any real viewport this downscales — never upscales — and stays sharp).
           It dissolves downward into the ambient layer instead of ending on an edge. */
        .backdrop .art { position: absolute; top: 0; left: 0; width: 100%; height: auto;
          opacity: var(--art-opacity);
          -webkit-mask-image: linear-gradient(to bottom, #000 30%, transparent var(--art-fade));
          mask-image: linear-gradient(to bottom, #000 30%, transparent var(--art-fade)); }
        /* Film grain, blended into the art (and only the art — .backdrop's z-index
           isolates the blend, so page content above is untouched). Sits over the scrim,
           hence the z-index; a fractalNoise turbulence, generated inline, no asset. */
        .grain { position: absolute; inset: 0; z-index: 2; opacity: var(--grain-opacity);
          mix-blend-mode: overlay; background-size: 200px 200px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }

        /* Scrim. The layer is fixed, so this gradient is anchored to the viewport, not
           the document: keep it an even wash (lighter up top, darker down low) rather
           than a page-long fade, or every scroll position gets a bright top edge. */
        .backdrop::after { content: ''; position: absolute; inset: 0; z-index: 1;
          background:
            linear-gradient(to bottom,
              rgba(var(--art-scrim), 0.22) 0%,
              rgba(var(--art-scrim), 0.45) 55%,
              rgba(var(--art-scrim), 0.72) 100%),
            radial-gradient(130% 100% at 50% 0%, rgba(var(--art-scrim), 0) 40%, rgba(var(--art-scrim), 0.55) 100%); }

        /* Panels go translucent so the backdrop tints through instead of being boxed out. */
        .hero, .section { background: rgba(26, 26, 26, 0.62); backdrop-filter: blur(8px); }

        /* Two even columns: discovery blocks on the left, facts on the right. */
        .columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.25rem;
          align-items: start; justify-content: center; }
        .col-main, .col-side { min-width: 0; }
        /* Same even split as .columns below it, so the cast/staff row lines up
           with the aside/main columns it sits directly above. */
        .credits-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 1.25rem;
          align-items: start; justify-content: center; margin-bottom: 1.25rem; }
        .topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
        .back { color: var(--accent-primary); text-decoration: none; font-weight: 600; }
        .back:hover { text-decoration: underline; }
        .ext-links { display: flex; gap: 0.5rem; flex-wrap: wrap; }
        .ext-links a { background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);
          padding: 4px 10px; border-radius: 6px; text-decoration: none; font-size: 0.85rem; }
        .ext-links a:hover { border-color: var(--border-hover); }
        /* "Noter" is a next/link <a> — styled-jsx can't scope it (see .chip.studio note
           below), so it needs its own :global() rule to match the plain <a> siblings. */
        .ext-links :global(.ext-link) { background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);
          padding: 4px 10px; border-radius: 6px; text-decoration: none; font-size: 0.85rem; }
        .ext-links :global(.ext-link):hover { border-color: var(--border-hover); }

        .hero { display: flex; gap: 1.5rem; margin-bottom: 1.25rem; padding: 1.25rem 1.5rem;
          border: 1px solid var(--border-color); border-radius: 12px; }

        .poster { width: 220px; flex: 0 0 220px; border-radius: 10px; object-fit: cover; align-self: flex-start;
          box-shadow: 0 10px 40px rgba(0,0,0,0.65); }
        .poster.noimg { height: 308px; display: flex; align-items: center; justify-content: center;
          background: var(--bg-secondary); color: var(--text-muted); }
        .head-info { flex: 1 1 auto; min-width: 0; }
        .head-meta { flex: 0 0 320px; display: flex; flex-direction: column; gap: 0.6rem; }
        .head-info h1 { margin: 0 0 0.4rem; font-size: 1.9rem; line-height: 1.2; }
        .alt { color: var(--text-secondary); font-size: 1rem; }
        .alt.ja { color: var(--text-muted); }
        .synonyms { color: var(--text-muted); font-size: 0.85rem; margin-top: 0.5rem; }
        .badges { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 1rem; }
        .airing { padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;
          background: var(--bg-tertiary); color: var(--text-secondary); }
        .airing.currently_airing { background: #16a34a; color: #fff; }
        .airing.finished_airing { background: #334155; color: #e2e8f0; }
        .airing.not_yet_aired { background: #b45309; color: #fff; }
        .pill { padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;
          background: var(--bg-secondary); border: 1px solid var(--border-color); }
        .pill.nsfw { color: #f87171; border-color: #7f1d1d; }
        .pill.hidden { color: #fbbf24; border-color: #78350f; }

        .section { border: 1px solid var(--border-color); border-radius: 12px;
          padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
        .section h2 { margin: 0 0 1rem; font-size: 1.15rem; }
        .section h2.h2-row { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap; }
        /* next/link renders its own <a>, which styled-jsx can't scope — same
           :global() escape hatch as .ext-link above. */
        .h2-row :global(.inspect) { margin-left: auto; font-size: 0.78rem; font-weight: 500;
          color: var(--text-secondary); text-decoration: none; border: 1px solid var(--border-color);
          border-radius: 6px; padding: 3px 9px; white-space: nowrap; }
        .h2-row :global(.inspect):hover { color: var(--text-primary); border-color: var(--border-hover); }
        .section h3 { margin: 1rem 0 0.5rem; font-size: 0.95rem; color: var(--text-secondary); }

        .reco-table { width: 100%; border-collapse: collapse; }
        .reco-table th, .reco-table td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border-color); }
        .reco-table th { color: var(--text-muted); font-size: 0.8rem; font-weight: 600; }
        .reco-table .rowlabel { color: var(--text-secondary); font-weight: 600; }
        .reco-table .eff { color: var(--accent-primary); font-weight: 700; }
        .meta-lines { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 0.75rem; color: var(--text-muted); font-size: 0.85rem; }

        .discrepancy { margin-top: 1rem; padding: 0.75rem 1rem; border-radius: 8px;
          background: rgba(180, 83, 9, 0.12); border: 1px solid #92400e; color: #fcd34d; }
        .discrepancy ul { margin: 0.5rem 0 0; padding-left: 1.25rem; }
        .discrepancy b { color: #fff; }

        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem 1.25rem; }
        .grid.ids { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
        .field { display: flex; flex-direction: column; gap: 2px; }
        .field-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
        .field-value { color: var(--text-primary); font-size: 0.95rem; }
        .field-value a { color: var(--accent-primary); text-decoration: none; }
        .field-value a:hover { text-decoration: underline; }

        .chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
        .head-chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.4rem; }
        /* .chip.studio is rendered via next/link (a real <a>), which styled-jsx can't
           scope automatically — reached with :global(), same pattern as .reco-card below. */
        :global(.chip) { background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 999px;
          padding: 3px 10px; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 5px; }
        :global(.chip.tag) .rank { color: var(--text-muted); font-size: 0.7rem; }
        :global(.chip.studio) { color: var(--text-secondary); text-decoration: none; }
        :global(.chip.studio):hover { border-color: var(--border-hover); color: var(--accent-primary); }

        /* ---------- Staff, by importance tier (domain/staffRole.ts) ---------- */
        /* T1: name first and large, role beneath it — the inverse of the crew grid
           below, where the role is the scanning key. Here the NAME is. */
        .staff-headline { display: flex; flex-direction: column; gap: 0.15rem; margin-bottom: 1.1rem; }
        .staff-headline :global(.headline-row) { display: flex; flex-direction: column; gap: 1px;
          padding: 0.3rem 0.6rem; margin: 0 -0.6rem; border-radius: 6px; text-decoration: none; }
        .staff-headline :global(.headline-row):hover { background: rgba(255, 255, 255, 0.045); }
        .staff-headline :global(.headline-row):hover .headline-name { text-decoration: underline; }
        .headline-name { color: var(--text-primary); font-size: 1rem; font-weight: 600; line-height: 1.3; }
        .headline-meta { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
        .headline-role { color: var(--text-secondary); font-size: 0.78rem; }
        /* "12 dans ta liste" — only on unseen titles, only past the threshold, so it
           stays a rare mark. Accent-tinted because it is about the USER, not the show. */
        .affinity { font-size: 0.7rem; padding: 1px 7px; border-radius: 999px; white-space: nowrap;
          color: var(--accent-primary); background: rgba(88, 166, 255, 0.12);
          border: 1px solid rgba(88, 166, 255, 0.3); }

        .staff-group { margin-bottom: 0.9rem; }
        .staff-group-label { margin: 0 0 0.35rem !important; font-size: 0.7rem !important;
          text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted) !important; }

        .staff-more { margin-top: 0.25rem; }
        .staff-more summary { cursor: pointer; font-size: 0.75rem; color: var(--text-muted);
          text-transform: uppercase; letter-spacing: 0.06em; padding: 3px 0; }
        .staff-more summary:hover { color: var(--text-secondary); }
        .staff-more[open] summary { margin-bottom: 0.5rem; }

        .prose { color: var(--text-secondary); line-height: 1.6; white-space: pre-wrap; margin: 0; }
        /* The header spans both columns, so cap the measure rather than the container. */
        .synopsis { margin-top: 1rem; max-width: 100ch; font-size: 0.92rem; }

        .reco-sub { color: var(--text-muted); font-size: 0.85rem; margin: -0.5rem 0 1rem; }
        /* next/link renders the <a>, and styled-jsx only scopes DOM elements it sees in
           this JSX — so the card class must be reached globally, under its scoped parent. */
        .reco-cards { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 1rem; }
        .reco-cards :global(.reco-card) { display: flex; gap: 0.75rem; flex: 1 1 300px; min-width: 0; text-decoration: none;
          color: var(--text-primary); background: var(--bg-tertiary); border: 1px solid var(--border-color);
          border-radius: 10px; padding: 0.6rem; }
        .reco-cards :global(.reco-card):hover { border-color: var(--border-hover); }
        .reco-cards :global(.reco-card) img { width: 70px; height: 99px; flex: 0 0 70px; object-fit: cover; border-radius: 6px; }
        .reco-noimg { width: 70px; height: 99px; flex: 0 0 70px; border-radius: 6px; background: var(--bg-secondary);
          display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
        .reco-body { display: flex; flex-direction: column; gap: 0.4rem; min-width: 0; }
        .reco-title { font-size: 0.9rem; font-weight: 600; line-height: 1.25; overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .reco-cards :global(.reco-card):hover .reco-title { text-decoration: underline; }
        .reco-shared { display: flex; flex-wrap: wrap; gap: 0.3rem; }
        .reco-badge { font-size: 0.72rem; padding: 2px 7px; border-radius: 999px; background: var(--bg-secondary);
          border: 1px solid var(--border-color); color: var(--text-secondary); }
        .reco-badge.studio { color: var(--accent-primary); }
        .reco-badge .reco-role { color: var(--text-muted); }

        .related { display: flex; flex-wrap: wrap; gap: 0.75rem; }
        .related :global(.related-card) { width: 110px; display: flex; flex-direction: column; gap: 4px; text-decoration: none;
          color: var(--text-primary); }
        .related :global(.related-card) img { width: 110px; height: 156px; object-fit: cover; border-radius: 6px; }
        .related-noimg { width: 110px; height: 156px; border-radius: 6px; background: var(--bg-tertiary);
          display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
        .related-rel { font-size: 0.7rem; color: var(--accent-primary); }
        .related-title { font-size: 0.78rem; line-height: 1.25; overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .related :global(.related-card):hover .related-title { text-decoration: underline; }

        @media (max-width: 1100px) {
          .columns { grid-template-columns: minmax(0, 1fr); }
          .credits-row { grid-template-columns: minmax(0, 1fr); }
        }

        @media (max-width: 640px) {
          .hero { flex-direction: column; }
          .poster { width: 160px; flex-basis: auto; }
          .head-meta { flex-basis: auto; }
          .head-chips { justify-content: flex-start; }
        }
      `}</style>
    </>
  );
}

/**
 * The two-column role/name grid used by staff tiers 2-4.
 *
 * Its own component with its own `<style jsx>` — the same reason `Field` below is
 * one: styled-jsx scopes to the JSX it can see, so rows rendered from a child
 * component never match the page's rules. `dim` is a prop rather than a parent
 * class for exactly that reason (a `.tier-3 .staff-row` descendant selector would
 * have to cross the scope boundary via `:global`).
 */
function StaffRows({ credits, dim }: { credits: AniListStaffEntry[]; dim?: boolean }) {
  return (
    <div className={`staff-list ${dim ? 'dim' : ''}`}>
      {credits.map(s => (
        <Link key={`${s.id}-${s.role}`} href={`/credits/staff/${s.id}`} className="staff-row">
          <span className="staff-role">{s.role}</span>
          <span className="staff-name">{s.name}</span>
        </Link>
      ))}
      <style jsx>{`
        .staff-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.4rem 1rem; }
        /* .staff-row is a next/link <a>, which styled-jsx can't scope — reached
           through the parent class rather than a bare :global(.staff-row): a single
           class loses to globals.css's a:hover underline reset, which was
           underlining the whole row instead of just .staff-name. */
        .staff-list :global(.staff-row) { display: flex; justify-content: space-between; gap: 0.75rem; padding: 3px 0;
          border-bottom: 1px dashed var(--border-color); text-decoration: none; }
        .staff-list :global(.staff-row):hover .staff-name { text-decoration: underline; }
        .staff-role { color: var(--text-muted); font-size: 0.8rem; }
        .staff-name { color: var(--text-primary); font-size: 0.85rem; text-align: right; }
        /* Tier 3: present and readable, but visibly subordinate to the tiers above. */
        .staff-list.dim .staff-role { color: #6b6b6b; font-size: 0.75rem; }
        .staff-list.dim .staff-name { color: var(--text-secondary); font-size: 0.8rem; }
        .staff-list.dim :global(.staff-row) { border-bottom-color: transparent; padding: 1px 0; }
      `}</style>
    </div>
  );
}

/**
 * One labelled catalog fact, with its provenance chip beside the label rather
 * than the value — the chip qualifies where the fact came from, and hanging it
 * off the value made it read as part of the value.
 *
 * `field` is the catalog field name, so the chip's tooltip names the same
 * identifier `/precedence` does. Omitting it (the two "on MAL" dates, which read
 * a raw MAL slice by nature — K7) simply renders no chip.
 */
function Field({ label, value, field, origin }: {
  label: string;
  value: string;
  field?: keyof AnimeCatalog;
  origin?: CatalogFieldOrigin;
}) {
  return (
    <div className="field">
      <span className="field-label">
        {label}
        {field && <ProvenanceChip field={field} origin={origin} />}
      </span>
      <span className="field-value">{value}</span>
      <style jsx>{`
        .field { display: flex; flex-direction: column; gap: 2px; }
        .field-label { display: flex; align-items: center; gap: 0.35rem;
          color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
        .field-value { color: var(--text-primary); font-size: 0.95rem; }
      `}</style>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const raw = String(ctx.params?.id);

  // Legacy MAL-id URLs (bookmarks predating the canonical-id flip) resolve and
  // redirect.
  if (/^\d+$/.test(raw)) {
    const canonicalId = resolveByMalId(parseInt(raw, 10));
    if (!canonicalId) return { notFound: true };
    return { redirect: { destination: `/anime/${canonicalId}`, permanent: false } };
  }

  if (!isCanonicalId(raw)) {
    return { notFound: true };
  }
  const anime = getAnimeByCanonicalId(raw);
  if (!anime) {
    return { notFound: true };
  }
  // Similar-by-credits reads catalog fields (studios/staff) only, so the
  // personal-state cache caveat doesn't apply — the shared cached catalog is fine.
  const catalog = getAnimeForDisplay();
  const titleLang = getTitleLanguage();
  const similar = computeSimilarByCredits(anime, catalog, titleLang, 3);
  // Relations resolve against that same array — the page already had it in hand,
  // so both providers' edges cost nothing extra here.
  const related = resolveRelations(anime, buildRelationIndex(catalog)).map(r => ({
    id: r.record.id,
    title: getPrimaryTitle(r.record, titleLang),
    picture: r.record.catalog.mainPicture?.medium,
    relation: r.formatted,
  }));
  // AnimeRecord carries many optional/undefined fields; Next can't serialize
  // `undefined`, so round-trip through JSON to drop them.
  // Cast is read straight from its own slice — never fetched here, so the page
  // render stays free of external calls. A miss (`null`) is filled client-side
  // by CastSection, once, and is cached for every later view.
  const cast = getAnilistCast(raw)?.characters ?? null;
  return {
    props: {
      anime: JSON.parse(JSON.stringify(anime)),
      titleLang,
      similar: JSON.parse(JSON.stringify(similar)),
      related: JSON.parse(JSON.stringify(related)),
      cast: cast ? JSON.parse(JSON.stringify(cast)) : null,
      // Built under the RESOLVED per-field ordering (`/settings` overrides
      // layered over the shipped defaults) — the same map `getAnimeForDisplay`
      // threads into the merge, so a chip cannot name a winner the record was
      // not actually built with.
      origins: JSON.parse(JSON.stringify(catalogFieldOrigins(anime, undefined, getCatalogPrecedenceByField()))),
      // Offered only when every enabled provider declares it can clear a status
      // (`personal.clearStatus` in providerCapabilities.ts) — in practice, when
      // local is the only one on. MAL models a clear as a list DELETE and SIMKL
      // is score-only, so neither can express it without losing the score.
      canClearStatus: canClearStatus(),
      // "N dans ta liste" on the headline credits — deliberately EMPTY once the
      // title is statused. Measured, the mark fires on 56% of T1 rows on a
      // watched title (its staff recur in your list by definition) against 15.8%
      // on an unseen one, where it actually reads as a reason to watch. The
      // index itself is memoized on `catalog`'s identity, so this is a map
      // lookup on all but the first view after a slice changes.
      staffAffinity: getEffectiveStatus(anime)
        ? {}
        : pickStaffAffinity(anime.sources.anilist?.staff || [], getStaffAffinity(catalog)),
      // Only the COUNT — enough to decide whether to offer the watch-order link,
      // and the index is memoized on `catalog`'s identity, so this is a map
      // lookup on all but the first detail view after a slice changes. A title
      // with no in-catalog franchise edges is in no component and is its own
      // franchise of one, which reads as 1 and offers nothing.
      franchiseSize: (getFranchiseIndex(catalog).get(anime.id) ?? [anime]).length,
    },
  };
};
