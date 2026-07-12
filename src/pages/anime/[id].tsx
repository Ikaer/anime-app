import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { getAnimeByIdForDisplay, getAnimeRecordById, getAnimeRecords } from '@/lib/store';
import type { AnimeForDisplay } from '@/models/anime';
import { getEffectiveStatus, getEffectiveScore, getEffectiveProgress, formatUserStatus, formatSeason, getPrimaryTitle, getSecondaryTitle } from '@/lib/animeUtils';
import { generateGoogleORQuery, generateJustWatchQuery } from '@/lib/searchLinks';
import { computeSimilarByCredits, type SimilarByCredits } from '@/lib/similarByCredits';
import { RefreshButton } from '@/components/shared';
import { MoreLikeThis } from '@/components/anime';
import { useT, type TFunction, type TranslationKey } from '@/lib/i18n';

interface Props {
  anime: AnimeForDisplay;
  similar: SimilarByCredits[];
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

export default function AnimeDetailPage({ anime, similar }: Props) {
  const t = useT();
  const router = useRouter();
  const poster = anime.main_picture?.large || anime.main_picture?.medium || '';
  const en = anime.alternative_titles?.en;
  const ja = anime.alternative_titles?.ja;
  const synonyms = anime.alternative_titles?.synonyms || [];
  const primaryTitle = getPrimaryTitle(anime);
  const secondaryTitle = getSecondaryTitle(anime);

  const mal = anime.my_list_status;
  const simkl = anime.simkl;
  const disc = anime.discrepancy;
  const tags = anime.anilistMeta?.tags || [];
  const staff = anime.anilistMeta?.staff || [];
  const crosswalk = anime.crosswalk || {};

  const effStatus = getEffectiveStatus(anime);
  const effScore = getEffectiveScore(anime);
  const effProgress = getEffectiveProgress(anime);

  const searchTitle = en || anime.title;
  const anilistId = anime.anilistMeta?.anilist_id ?? crosswalk.anilist;

  // Page backdrop. AniList's landscape banner is the real thing (it's what Plex
  // shows); the portrait poster is the fallback and needs a heavier blur, since
  // cover-cropping it to a wide viewport leaves only a thin, meaningless band.
  const banner = anime.anilistMeta?.banner_image || '';
  const backdrop = banner || poster;

  // Cross-source id rows worth surfacing, in a stable order.
  const idRows: Array<[string, string | number | undefined, string | undefined]> = [
    ['MAL', anime.id, `https://myanimelist.net/anime/${anime.id}`],
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
            <Link href={`/rate?id=${anime.id}`} className="ext-link">{t('detail.rate')}</Link>
            <RefreshButton
              animeId={anime.id}
              onRefreshed={() => {
                router.replace(router.asPath, undefined, { scroll: false })
              }}
            />
            <a href={`https://myanimelist.net/anime/${anime.id}`} target="_blank" rel="noopener noreferrer">MAL</a>
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
            <h1>{primaryTitle}</h1>
            {secondaryTitle && <div className="alt">{secondaryTitle}</div>}
            {ja && <div className="alt ja">{ja}</div>}
            {synonyms.length > 0 && <div className="synonyms">{t('detail.alsoKnown', { names: synonyms.join(' · ') })}</div>}
            <div className="badges">
              <span className={`airing ${anime.status || ''}`}>{airingLabel(anime.status, t)}</span>
              {anime.media_type && <span className="pill">{anime.media_type.toUpperCase()}</span>}
              {anime.start_season && (
                <span className="pill" style={{ color: formatSeason(anime.start_season.year, anime.start_season.season, t).color }}>
                  {formatSeason(anime.start_season.year, anime.start_season.season, t).label}
                </span>
              )}
              {anime.nsfw && anime.nsfw !== 'white' && <span className="pill nsfw">NSFW: {anime.nsfw}</span>}
              {anime.hidden && <span className="pill hidden">{t('detail.hidden')}</span>}
            </div>
            {anime.synopsis && <p className="prose synopsis">{anime.synopsis}</p>}
          </div>
          {/* Third column, sitting under the action buttons of the topbar. */}
          {((anime.genres && anime.genres.length > 0) || (anime.studios && anime.studios.length > 0)) && (
            <div className="head-meta">
              {anime.genres && anime.genres.length > 0 && (
                <div className="head-chips">
                  {anime.genres.map(g => <span key={g.id} className="chip">{g.name}</span>)}
                </div>
              )}
              {anime.studios && anime.studios.length > 0 && (
                <div className="head-chips">
                  {anime.studios.map(s => (
                    <Link key={s.id} href={`/credits/studio/${s.id}`} className="chip studio">🎬 {s.name}</Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </header>

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
          {anime.related_anime && anime.related_anime.length > 0 && (
            <section className="section">
              <h2>{t('detail.relatedAnime')}</h2>
              <div className="related">
                {anime.related_anime.map(r => (
                  <Link key={r.node.id} href={`/anime/${r.node.id}`} className="related-card" title={r.node.title}>
                    {r.node.main_picture?.medium
                      ? <img src={r.node.main_picture.medium} alt="" />
                      : <div className="related-noimg">?</div>}
                    <span className="related-rel">{r.relation_type_formatted || r.relation_type}</span>
                    <span className="related-title">{r.node.title}</span>
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
          <table className="reco-table">
            <thead>
              <tr><th></th><th>MAL</th><th>SIMKL</th><th>{t('detail.effective')}</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="rowlabel">{t('detail.status')}</td>
                <td>{statusLabel(mal?.status, t)}</td>
                <td>{statusLabel(simkl?.status, t)}</td>
                <td className="eff">{statusLabel(effStatus, t)}</td>
              </tr>
              <tr>
                <td className="rowlabel">{t('detail.score')}</td>
                <td>{fmtScore(mal?.score)}</td>
                <td>{fmtScore(simkl?.score)}</td>
                <td className="eff">{effScore ?? '—'}</td>
              </tr>
              <tr>
                <td className="rowlabel">{t('detail.progress')}</td>
                <td>{mal?.num_episodes_watched ?? '—'}{anime.num_episodes ? ` / ${anime.num_episodes}` : ''}</td>
                <td>{simkl?.num_episodes_watched ?? '—'}{simkl?.total_episodes ? ` / ${simkl.total_episodes}` : ''}</td>
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
                {disc.presence === 'simkl_only' && <li>{t('detail.discSimklOnly')}</li>}
                {disc.status && <li>{t('detail.status')} : MAL <b>{statusLabel(disc.status.mal, t)}</b> vs SIMKL <b>{statusLabel(disc.status.simkl, t)}</b></li>}
                {disc.score && <li>{t('detail.score')} : MAL <b>{disc.score.mal ?? '—'}</b> vs SIMKL <b>{disc.score.simkl ?? '—'}</b></li>}
                {disc.progress && <li>{t('detail.progress')} : MAL <b>{disc.progress.mal ?? '—'}</b> vs SIMKL <b>{disc.progress.simkl ?? '—'}</b></li>}
              </ul>
            </div>
          )}
        </section>

        {/* ---------- Catalog facts (MAL authority) ---------- */}
        <section className="section">
          <h2>{t('detail.catalogSheet')}</h2>
          <div className="grid">
            <Field label={t('detail.meanScore')} value={anime.mean != null ? anime.mean.toFixed(2) : '—'} />
            <Field label={t('field.rank')} value={anime.rank != null ? `#${anime.rank}` : '—'} />
            <Field label={t('field.popularity')} value={anime.popularity != null ? `#${anime.popularity}` : '—'} />
            <Field label={t('field.users')} value={fmtNum(anime.num_list_users)} />
            <Field label={t('field.scorers')} value={fmtNum(anime.num_scoring_users)} />
            <Field label={t('field.episodes')} value={anime.num_episodes ? String(anime.num_episodes) : t('common.tba')} />
            <Field label={t('detail.durationPerEp')} value={fmtDuration(anime.average_episode_duration)} />
            <Field label={t('detail.source')} value={anime.source ? formatUserStatus(anime.source) : '—'} />
            <Field label={t('detail.rating')} value={anime.rating || '—'} />
            <Field label={t('detail.start')} value={fmtDate(anime.start_date)} />
            <Field label={t('detail.end')} value={fmtDate(anime.end_date)} />
            <Field label={t('detail.addedMal')} value={fmtDate(anime.created_at)} />
            <Field label={t('detail.updatedMal')} value={fmtDate(anime.updated_at)} />
          </div>
        </section>

        {/* ---------- AniList tags & staff ---------- */}
        {(tags.length > 0 || staff.length > 0) && (
          <section className="section">
            <h2>AniList</h2>
            {tags.length > 0 && (
              <>
                <h3>{t('detail.tagsCount', { count: tags.length })}</h3>
                <div className="chips">
                  {tags.map(tag => (
                    <span key={tag.name} className="chip tag" title={tag.category ? t('detail.tagRankCategory', { category: tag.category, rank: tag.rank }) : t('detail.tagRank', { rank: tag.rank })}>
                      {tag.name}<span className="rank">{tag.rank}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
            {staff.length > 0 && (
              <>
                <h3>{t('detail.staffCount', { count: staff.length })}</h3>
                <div className="staff-list">
                  {staff.map(s => (
                    <Link key={`${s.id}-${s.role}`} href={`/credits/staff/${s.id}`} className="staff-row">
                      <span className="staff-role">{s.role}</span>
                      <span className="staff-name">{s.name}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
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
        {anime.background && (
          <section className="section">
            <h2>{t('detail.background')}</h2>
            <p className="prose">{anime.background}</p>
          </section>
        )}

        </main>
        </div>
      </div>

      <style jsx>{`
        /* 520 (side) + 20 (gap) + 1100 (main) + the 1.5rem padding on each side, so the
           hero and the topbar line up exactly with the two columns underneath. */
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

        /* Two columns: discovery blocks on the left, facts on the right. The side
           column is capped so the recommendation cards never stretch at 4K. */
        .columns { display: grid; grid-template-columns: minmax(340px, 520px) minmax(0, 1100px); gap: 1.25rem;
          align-items: start; justify-content: center; }
        .col-main, .col-side { min-width: 0; }
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

        .staff-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.4rem 1rem; }
        /* .staff-row is a next/link <a> too — see .chip.studio note above. Scoped through
           the parent class rather than bare :global(.staff-row): a single class has lower
           specificity than globals.css's a:hover underline reset, which was winning on
           hover and underlining the whole row instead of just .staff-name below. */
        .staff-list :global(.staff-row) { display: flex; justify-content: space-between; gap: 0.75rem; padding: 3px 0;
          border-bottom: 1px dashed var(--border-color); text-decoration: none; }
        .staff-list :global(.staff-row):hover .staff-name { text-decoration: underline; }
        .staff-role { color: var(--text-muted); font-size: 0.8rem; }
        .staff-name { color: var(--text-primary); font-size: 0.85rem; text-align: right; }

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <span className="field-value">{value}</span>
      <style jsx>{`
        .field { display: flex; flex-direction: column; gap: 2px; }
        .field-label { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.03em; }
        .field-value { color: var(--text-primary); font-size: 0.95rem; }
      `}</style>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const id = parseInt(String(ctx.params?.id), 10);
  if (!Number.isInteger(id)) {
    return { notFound: true };
  }
  const anime = getAnimeByIdForDisplay(id);
  if (!anime) {
    return { notFound: true };
  }
  // Similar-by-credits reads catalog fields (studios/staff) only, so the
  // personal-state cache caveat doesn't apply — the shared cached catalog is fine.
  const targetRecord = getAnimeRecordById(id)!;
  const similar = computeSimilarByCredits(targetRecord, getAnimeRecords(), 3);
  // AnimeForDisplay carries many optional/undefined fields; Next can't serialize
  // `undefined`, so round-trip through JSON to drop them.
  return {
    props: {
      anime: JSON.parse(JSON.stringify(anime)),
      similar: JSON.parse(JSON.stringify(similar)),
    },
  };
};
