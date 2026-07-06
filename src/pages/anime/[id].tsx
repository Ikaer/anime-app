import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useState } from 'react';
import type { GetServerSideProps } from 'next';
import { getAnimeForDisplay } from '@/lib/anime';
import type { AnimeForDisplay } from '@/models/anime';
import { getEffectiveStatus, getEffectiveScore, getEffectiveProgress, formatUserStatus, formatSeason } from '@/lib/animeUtils';
import { generateGoogleORQuery, generateJustWatchQuery } from '@/lib/searchLinks';

interface Props {
  anime: AnimeForDisplay;
}

// ---------------------------------------------------------------------------
// Small formatting helpers (local-only, no dependencies on the app's UI kit)
// ---------------------------------------------------------------------------

function fmtDate(d?: string): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString();
}

function fmtDuration(seconds?: number): string {
  if (!seconds) return '—';
  const min = Math.round(seconds / 60);
  return `${min} min`;
}

function fmtNum(n?: number): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function fmtScore(n?: number | null): string {
  return n != null && n > 0 ? String(n) : '—';
}

function airingLabel(status?: string): string {
  switch (status) {
    case 'currently_airing': return 'En diffusion';
    case 'finished_airing': return 'Terminé';
    case 'not_yet_aired': return 'À venir';
    default: return status || '—';
  }
}

export default function AnimeDetailPage({ anime }: Props) {
  const poster = anime.main_picture?.large || anime.main_picture?.medium || '';
  const en = anime.alternative_titles?.en;
  const ja = anime.alternative_titles?.ja;
  const synonyms = anime.alternative_titles?.synonyms || [];

  const mal = anime.my_list_status;
  const simkl = anime.simkl;
  const disc = anime.discrepancy;
  const tags = anime.anilistTags?.tags || [];
  const staff = anime.anilistTags?.staff || [];
  const crosswalk = anime.crosswalk || {};

  const effStatus = getEffectiveStatus(anime);
  const effScore = getEffectiveScore(anime);
  const effProgress = getEffectiveProgress(anime);

  const searchTitle = en || anime.title;
  const anilistId = anime.anilistTags?.anilist_id ?? crosswalk.anilist;

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
        <title>{anime.title} — Détails locaux</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>

      <div className="page">
        <div className="topbar">
          <Link href="/" className="back">← Retour</Link>
          <div className="ext-links">
            <RefreshButton animeId={anime.id} />
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
        <header className="header">
          {poster
            ? <img className="poster" src={poster} alt={anime.title} />
            : <div className="poster noimg">No image</div>}
          <div className="head-info">
            <h1>{anime.title}</h1>
            {en && en !== anime.title && <div className="alt">{en}</div>}
            {ja && <div className="alt ja">{ja}</div>}
            {synonyms.length > 0 && <div className="synonyms">Aussi : {synonyms.join(' · ')}</div>}
            <div className="badges">
              <span className={`airing ${anime.status || ''}`}>{airingLabel(anime.status)}</span>
              {anime.media_type && <span className="pill">{anime.media_type.toUpperCase()}</span>}
              {anime.start_season && (
                <span className="pill" style={{ color: formatSeason(anime.start_season.year, anime.start_season.season).color }}>
                  {formatSeason(anime.start_season.year, anime.start_season.season).label}
                </span>
              )}
              {anime.nsfw && anime.nsfw !== 'white' && <span className="pill nsfw">NSFW: {anime.nsfw}</span>}
              {anime.hidden && <span className="pill hidden">Masqué</span>}
            </div>
          </div>
        </header>

        {/* ---------- Personal state reconciliation (the point of this page) ---------- */}
        <section className="section">
          <h2>État personnel (MAL vs SIMKL vs effectif)</h2>
          <table className="reco-table">
            <thead>
              <tr><th></th><th>MAL</th><th>SIMKL</th><th>Effectif</th></tr>
            </thead>
            <tbody>
              <tr>
                <td className="rowlabel">Statut</td>
                <td>{mal?.status ? formatUserStatus(mal.status) : '—'}</td>
                <td>{simkl?.status ? formatUserStatus(simkl.status) : '—'}</td>
                <td className="eff">{effStatus ? formatUserStatus(effStatus) : '—'}</td>
              </tr>
              <tr>
                <td className="rowlabel">Note</td>
                <td>{fmtScore(mal?.score)}</td>
                <td>{fmtScore(simkl?.score)}</td>
                <td className="eff">{effScore ?? '—'}</td>
              </tr>
              <tr>
                <td className="rowlabel">Progression</td>
                <td>{mal?.num_episodes_watched ?? '—'}{anime.num_episodes ? ` / ${anime.num_episodes}` : ''}</td>
                <td>{simkl?.num_episodes_watched ?? '—'}{simkl?.total_episodes ? ` / ${simkl.total_episodes}` : ''}</td>
                <td className="eff">{effProgress ?? '—'}</td>
              </tr>
            </tbody>
          </table>
          <div className="meta-lines">
            {mal?.is_rewatching && <span>🔁 En re-visionnage (MAL)</span>}
            {mal?.updated_at && <span>MAL mis à jour : {fmtDate(mal.updated_at)}</span>}
            {simkl?.watched_at && <span>SIMKL vu le : {fmtDate(simkl.watched_at)}</span>}
          </div>

          {disc && (
            <div className="discrepancy">
              <strong>⚠ Divergence MAL / SIMKL détectée</strong>
              <ul>
                {disc.presence === 'simkl_only' && <li>Présent sur SIMKL mais absent de ta liste MAL</li>}
                {disc.status && <li>Statut : MAL <b>{disc.status.mal ? formatUserStatus(disc.status.mal) : '—'}</b> vs SIMKL <b>{formatUserStatus(disc.status.simkl)}</b></li>}
                {disc.score && <li>Note : MAL <b>{disc.score.mal ?? '—'}</b> vs SIMKL <b>{disc.score.simkl ?? '—'}</b></li>}
                {disc.progress && <li>Progression : MAL <b>{disc.progress.mal ?? '—'}</b> vs SIMKL <b>{disc.progress.simkl ?? '—'}</b></li>}
              </ul>
            </div>
          )}
        </section>

        {/* ---------- Catalog facts (MAL authority) ---------- */}
        <section className="section">
          <h2>Fiche catalogue (MAL)</h2>
          <div className="grid">
            <Field label="Score moyen" value={anime.mean != null ? anime.mean.toFixed(2) : '—'} />
            <Field label="Rang" value={anime.rank != null ? `#${anime.rank}` : '—'} />
            <Field label="Popularité" value={anime.popularity != null ? `#${anime.popularity}` : '—'} />
            <Field label="Membres" value={fmtNum(anime.num_list_users)} />
            <Field label="Votants" value={fmtNum(anime.num_scoring_users)} />
            <Field label="Épisodes" value={anime.num_episodes ? String(anime.num_episodes) : 'TBA'} />
            <Field label="Durée / ép." value={fmtDuration(anime.average_episode_duration)} />
            <Field label="Source" value={anime.source ? formatUserStatus(anime.source) : '—'} />
            <Field label="Classification" value={anime.rating || '—'} />
            <Field label="Début" value={fmtDate(anime.start_date)} />
            <Field label="Fin" value={fmtDate(anime.end_date)} />
            <Field label="Ajouté (MAL)" value={fmtDate(anime.created_at)} />
            <Field label="Maj (MAL)" value={fmtDate(anime.updated_at)} />
          </div>
        </section>

        {/* ---------- Genres & studios ---------- */}
        {((anime.genres && anime.genres.length > 0) || (anime.studios && anime.studios.length > 0)) && (
          <section className="section">
            <h2>Genres & studios</h2>
            {anime.genres && anime.genres.length > 0 && (
              <div className="chips">
                {anime.genres.map(g => <span key={g.id} className="chip">{g.name}</span>)}
              </div>
            )}
            {anime.studios && anime.studios.length > 0 && (
              <div className="chips studios">
                {anime.studios.map(s => <span key={s.id} className="chip studio">🎬 {s.name}</span>)}
              </div>
            )}
          </section>
        )}

        {/* ---------- AniList tags & staff ---------- */}
        {(tags.length > 0 || staff.length > 0) && (
          <section className="section">
            <h2>AniList</h2>
            {tags.length > 0 && (
              <>
                <h3>Tags ({tags.length})</h3>
                <div className="chips">
                  {tags.map(t => (
                    <span key={t.name} className="chip tag" title={t.category ? `${t.category} · rang ${t.rank}` : `rang ${t.rank}`}>
                      {t.name}<span className="rank">{t.rank}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
            {staff.length > 0 && (
              <>
                <h3>Staff ({staff.length})</h3>
                <div className="staff-list">
                  {staff.map(s => (
                    <div key={`${s.id}-${s.role}`} className="staff-row">
                      <span className="staff-role">{s.role}</span>
                      <span className="staff-name">{s.name}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* ---------- Cross-source id crosswalk ---------- */}
        <section className="section">
          <h2>Identifiants (crosswalk)</h2>
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

        {/* ---------- Synopsis / background ---------- */}
        {anime.synopsis && (
          <section className="section">
            <h2>Synopsis</h2>
            <p className="prose">{anime.synopsis}</p>
          </section>
        )}
        {anime.background && (
          <section className="section">
            <h2>Contexte</h2>
            <p className="prose">{anime.background}</p>
          </section>
        )}

        {/* ---------- Related anime ---------- */}
        {anime.related_anime && anime.related_anime.length > 0 && (
          <section className="section">
            <h2>Anime liés</h2>
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
      </div>

      <style jsx>{`
        .page { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.5rem 4rem; color: var(--text-primary); }
        .topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
        .back { color: var(--accent-primary); text-decoration: none; font-weight: 600; }
        .back:hover { text-decoration: underline; }
        .ext-links { display: flex; gap: 0.5rem; flex-wrap: wrap; }
        .ext-links a { background: var(--bg-secondary); border: 1px solid var(--border-color); color: var(--text-primary);
          padding: 4px 10px; border-radius: 6px; text-decoration: none; font-size: 0.85rem; }
        .ext-links a:hover { border-color: var(--border-hover); }

        .header { display: flex; gap: 1.5rem; margin-bottom: 2rem; }
        .poster { width: 220px; flex: 0 0 220px; border-radius: 10px; object-fit: cover; align-self: flex-start;
          box-shadow: 0 8px 30px rgba(0,0,0,0.5); }
        .poster.noimg { height: 308px; display: flex; align-items: center; justify-content: center;
          background: var(--bg-secondary); color: var(--text-muted); }
        .head-info { flex: 1 1 auto; min-width: 0; }
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

        .section { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px;
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
        .chips.studios { margin-top: 0.6rem; }
        .chip { background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 999px;
          padding: 3px 10px; font-size: 0.82rem; display: inline-flex; align-items: center; gap: 5px; }
        .chip.tag .rank { color: var(--text-muted); font-size: 0.7rem; }
        .chip.studio { color: var(--text-secondary); }

        .staff-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.4rem 1rem; }
        .staff-row { display: flex; justify-content: space-between; gap: 0.75rem; padding: 3px 0;
          border-bottom: 1px dashed var(--border-color); }
        .staff-role { color: var(--text-muted); font-size: 0.8rem; }
        .staff-name { color: var(--text-primary); font-size: 0.85rem; text-align: right; }

        .prose { color: var(--text-secondary); line-height: 1.6; white-space: pre-wrap; margin: 0; }

        .related { display: flex; flex-wrap: wrap; gap: 0.75rem; }
        .related-card { width: 110px; display: flex; flex-direction: column; gap: 4px; text-decoration: none;
          color: var(--text-primary); }
        .related-card img { width: 110px; height: 156px; object-fit: cover; border-radius: 6px; }
        .related-noimg { width: 110px; height: 156px; border-radius: 6px; background: var(--bg-tertiary);
          display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
        .related-rel { font-size: 0.7rem; color: var(--accent-primary); }
        .related-title { font-size: 0.78rem; line-height: 1.25; overflow: hidden; display: -webkit-box;
          -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
        .related-card:hover .related-title { text-decoration: underline; }

        @media (max-width: 640px) {
          .header { flex-direction: column; }
          .poster { width: 160px; flex-basis: auto; }
        }
      `}</style>
    </>
  );
}

type RefreshOutcome = {
  mal: { ok: boolean; error?: string };
  anilist: { ok: boolean; tagged: number; error?: string };
  simkl: { ok: boolean; phase: string; added: number; removed: number; error?: string };
};

/**
 * Triggers the per-anime refresh (MAL single-title + AniList tags/staff + SIMKL
 * incremental delta), then re-runs getServerSideProps to show the fresh data.
 * Reports a compact per-source outcome so a failed pipe is visible, not silent.
 */
function RefreshButton({ animeId }: { animeId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RefreshOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/anime/animes/${animeId}/refresh`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as RefreshOutcome;
      setResult(data);
      // Re-run getServerSideProps in place so the page reflects the new data.
      await router.replace(router.asPath, undefined, { scroll: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec du rafraîchissement');
    } finally {
      setBusy(false);
    }
  }

  const flag = (ok: boolean) => (ok ? '✓' : '✗');

  return (
    <span className="refresh-wrap">
      <button className="refresh-btn" onClick={refresh} disabled={busy}>
        {busy ? '⏳ Rafraîchissement…' : '🔄 Rafraîchir'}
      </button>
      {result && (
        <span className="refresh-status" title="MAL · AniList · SIMKL">
          MAL {flag(result.mal.ok)} · AniList {flag(result.anilist.ok)} · SIMKL {flag(result.simkl.ok)}
        </span>
      )}
      {error && <span className="refresh-status err">{error}</span>}
      <style jsx>{`
        .refresh-wrap { display: inline-flex; align-items: center; gap: 0.5rem; }
        .refresh-btn { background: var(--accent-primary); border: 1px solid var(--accent-primary);
          color: #fff; padding: 4px 12px; border-radius: 6px; font-size: 0.85rem; cursor: pointer; font-weight: 600; }
        .refresh-btn:hover:not(:disabled) { filter: brightness(1.1); }
        .refresh-btn:disabled { opacity: 0.6; cursor: default; }
        .refresh-status { font-size: 0.78rem; color: var(--text-muted); }
        .refresh-status.err { color: #f87171; }
      `}</style>
    </span>
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
  const anime = getAnimeForDisplay().find(a => a.id === id);
  if (!anime) {
    return { notFound: true };
  }
  // AnimeForDisplay carries many optional/undefined fields; Next can't serialize
  // `undefined`, so round-trip through JSON to drop them.
  return { props: { anime: JSON.parse(JSON.stringify(anime)) } };
};
