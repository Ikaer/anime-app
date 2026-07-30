/**
 * `/graph` — the ego explorer.
 *
 * Its own route with its own lean URL state, for the reason `/tier` and `/stats`
 * are: this page's state is a focal node plus a filter set, which has no place in
 * `AnimeFiltersState`. The focal node lives in the URL too, so every hop is
 * linkable and the back button retraces the browse.
 *
 * Why this is not a catalog map, and why a node is an anime rather than a
 * franchise, is documented where the decisions live — `lib/domain/animeGraph.ts`.
 * Both were measured against the live store before being chosen.
 *
 * It renders `AnimeListHeader` like `/`, `/recommendations` and `/tier` do, with
 * neither the `sort` nor the `display` group: a graph has no sort order (the
 * layout IS the order) and no cards per row. Its own controls go in as children,
 * which is exactly what that slot is for.
 */
import Head from 'next/head';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { getAllAnilistCast, getAnimeForDisplay } from '@/lib/store';
import { getEffectiveScore, getEffectiveStatus } from '@/lib/domain/animeUtils';
import { GRAPH_FOCAL_TYPES, type GraphEgo, type GraphFocalType } from '@/lib/domain/animeGraph';
import { STAFF_ROLE_TIERS, type StaffRoleTier } from '@/lib/domain/staffRole';
import { AnimeListHeader } from '@/components/anime';
import EgoGraph from '@/components/anime/graph/EgoGraph';
import useGraphUrlState, { GRAPH_COLOUR_MODES, type GraphColourMode } from '@/hooks/useGraphUrlState';
import { useT, type TranslationKey } from '@/lib/i18n';
import type { AnimeRecord } from '@/models/anime';

const CHARACTER_ROLES = ['MAIN', 'SUPPORTING', 'BACKGROUND'];

interface SearchHit {
  id: string;
  title: string;
  year?: number;
  poster?: string;
}

interface Props {
  /** Tag vocabulary for the tag filter, most common first. */
  tagOptions: string[];
  mediaTypeOptions: string[];
}

export default function GraphPage({ tagOptions, mediaTypeOptions }: Props) {
  const t = useT();
  const { state, update, recentre, isReady } = useGraphUrlState();

  const [ego, setEgo] = useState<GraphEgo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set('type', state.focalType);
    params.set('id', state.focalKey);
    if (state.roles.length) params.set('roles', state.roles.join(','));
    if (state.tiers.length) params.set('tiers', state.tiers.join(','));
    if (state.mediaTypes.length) params.set('mediaTypes', state.mediaTypes.join(','));
    if (state.tag) params.set('tag', state.tag);
    if (state.inList) params.set('inList', '1');
    return params.toString();
  }, [state]);

  useEffect(() => {
    if (!isReady || !state.focalKey) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/anime/graph?${query}`)
      .then(async res => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body as GraphEgo;
      })
      .then(data => { if (!cancelled) setEgo(data); })
      .catch(err => { if (!cancelled) { setError(err.message); setEgo(null); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isReady, state.focalKey, query]);

  const toggleIn = useCallback(
    <T,>(list: T[], value: T): T[] =>
      list.includes(value) ? list.filter(v => v !== value) : [...list, value],
    []
  );

  const runSweep = async () => {
    setSweeping(true);
    try {
      await fetch('/api/anime/anilist/cast-sweep', { method: 'POST' });
    } finally {
      setSweeping(false);
    }
  };

  const nodeCount = ego ? ego.nodes.length : 0;
  const focalTypeLabel = (type: GraphFocalType) => t(`graph.focalType.${type}` as TranslationKey);

  return (
    <>
      <Head>
        <title>{t('graph.pageTitle')}</title>
        <link rel="icon" href="/anime-favicon.svg" />
      </Head>

      <div className="page">
        <AnimeListHeader
          title={t('graph.heading')}
          count={ego
            ? t(nodeCount === 1 ? 'graph.countOne' : 'graph.countOther', { count: nodeCount })
            : undefined}
        >
          <div className="group">
            <span className="groupLabel">{t('graph.colourBy')}</span>
            <select
              value={state.colour}
              onChange={e => update({ colour: e.target.value as GraphColourMode })}
            >
              {GRAPH_COLOUR_MODES.map(mode => (
                <option key={mode} value={mode}>
                  {t(`graph.colour.${mode}` as TranslationKey)}
                </option>
              ))}
            </select>
          </div>

          <div className="group">
            <label className="check">
              <input
                type="checkbox"
                checked={state.collapseFranchise}
                onChange={e => update({ collapseFranchise: e.target.checked })}
              />
              {t('graph.collapseFranchise')}
            </label>
          </div>
        </AnimeListHeader>

        <div className="body">
          <aside className="sidebar">
            <FocalPicker
              value={state.focalKey}
              focalType={state.focalType}
              onPick={id => recentre('anime', id)}
            />

            <section className="filterBlock">
              <h3>{t('graph.filters.focalType')}</h3>
              <div className="chips">
                {GRAPH_FOCAL_TYPES.map(type => (
                  <button
                    key={type}
                    className={state.focalType === type ? 'chip active' : 'chip'}
                    onClick={() => update({ focalType: type })}
                    // Switching type without a matching id would 404, so the
                    // control only offers the type the current node already is.
                    disabled={state.focalType !== type}
                    title={focalTypeLabel(type)}
                  >
                    {focalTypeLabel(type)}
                  </button>
                ))}
              </div>
            </section>

            <section className="filterBlock">
              <h3>{t('graph.filters.roles')}</h3>
              <div className="chips">
                {CHARACTER_ROLES.map(role => (
                  <button
                    key={role}
                    className={state.roles.includes(role) ? 'chip active' : 'chip'}
                    onClick={() => update({ roles: toggleIn(state.roles, role) })}
                  >
                    {t(`graph.role.${role.toLowerCase()}` as TranslationKey)}
                  </button>
                ))}
              </div>
            </section>

            <section className="filterBlock">
              <h3>{t('graph.filters.tiers')}</h3>
              <div className="chips">
                {STAFF_ROLE_TIERS.map(tier => (
                  <button
                    key={tier}
                    className={state.tiers.includes(tier) ? 'chip active' : 'chip'}
                    onClick={() => update({ tiers: toggleIn(state.tiers, tier) })}
                  >
                    {/* Own keys rather than `detail.staffTier.*`: that set is
                        deliberately partial (the detail page leaves T1 unlabelled
                        and hides T4 behind a summary), and a dynamic key bypasses
                        the missing-key compile check. */}
                    {t(`graph.tier.${tier}` as TranslationKey)}
                  </button>
                ))}
              </div>
              <p className="hint">{t('graph.filters.tierHint')}</p>
            </section>

            <section className="filterBlock">
              <h3>{t('graph.filters.tag')}</h3>
              <select value={state.tag} onChange={e => update({ tag: e.target.value })}>
                <option value="">{t('graph.filters.anyTag')}</option>
                {tagOptions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
              </select>
            </section>

            <section className="filterBlock">
              <h3>{t('graph.filters.mediaTypes')}</h3>
              <div className="chips">
                {mediaTypeOptions.map(type => (
                  <button
                    key={type}
                    className={state.mediaTypes.includes(type) ? 'chip active' : 'chip'}
                    onClick={() => update({ mediaTypes: toggleIn(state.mediaTypes, type) })}
                  >
                    {type.toUpperCase()}
                  </button>
                ))}
              </div>
            </section>

            <section className="filterBlock">
              <label className="check">
                <input
                  type="checkbox"
                  checked={state.inList}
                  onChange={e => update({ inList: e.target.checked })}
                />
                {t('graph.filters.inList')}
              </label>
              {/* The cast slice only covers statused titles, so on a seiyuu ego
                  every anime is in the list by construction and this filter is a
                  no-op. Said rather than hidden — a dead control is worse. */}
              {state.focalType === 'seiyuu' && (
                <p className="hint">{t('graph.filters.inListNoop')}</p>
              )}
            </section>
          </aside>

          <main className="canvas">
            {!state.focalKey && <p className="empty">{t('graph.pickSomething')}</p>}
            {error && <p className="error">{error}</p>}
            {loading && !ego && <p className="empty">{t('graph.loading')}</p>}

            {ego && (
              <>
                <EgoGraph
                  ego={ego}
                  colour={state.colour}
                  collapseFranchise={state.collapseFranchise}
                  onRecentre={(kind, key) => recentre(kind, key)}
                />

                <div className="footer">
                  <Legend colour={state.colour} />

                  <div className="coverage">
                    <p>
                      {t('graph.coverage.cast', {
                        covered: ego.coverage.castTitles,
                        total: ego.coverage.catalogTitles,
                      })}
                      {' · '}
                      {t('graph.coverage.staff', {
                        covered: ego.coverage.staffTitles,
                        total: ego.coverage.catalogTitles,
                      })}
                    </p>
                    {ego.coverage.focalCastMissing && (
                      <p className="warn">{t('graph.coverage.focalMissing')}</p>
                    )}
                    <button className="sweep" onClick={runSweep} disabled={sweeping}>
                      {sweeping ? t('graph.coverage.sweeping') : t('graph.coverage.sweep')}
                    </button>
                  </div>

                  {ego.focalType === 'anime' && (
                    <Link className="detailLink" href={`/anime/${ego.focal.key}`}>
                      {t('graph.openDetail')}
                    </Link>
                  )}
                </div>
              </>
            )}
          </main>
        </div>
      </div>

      <style jsx>{`
        .page { padding: 16px 20px 40px; }
        .body { display: flex; gap: 20px; align-items: flex-start; }
        .sidebar {
          flex: 0 0 260px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .canvas { flex: 1 1 auto; min-width: 0; }
        .filterBlock {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .filterBlock h3 {
          margin: 0 0 8px;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
        }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .hint { margin: 8px 0 0; font-size: 0.72rem; color: var(--text-muted); line-height: 1.4; }
        .check {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 0.82rem;
          color: var(--text-secondary);
          cursor: pointer;
        }
        .group { display: flex; align-items: center; gap: 8px; }
        .groupLabel { font-size: 0.78rem; color: var(--text-muted); }
        .empty, .error { padding: 40px 0; text-align: center; color: var(--text-muted); }
        .error { color: var(--score-3); }
        .footer {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          align-items: flex-start;
          justify-content: space-between;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid var(--border-color);
        }
        .coverage { font-size: 0.76rem; color: var(--text-muted); }
        .coverage p { margin: 0 0 4px; }
        .warn { color: var(--score-6); }
        .sweep, .detailLink {
          margin-top: 4px;
          padding: 5px 11px;
          font-size: 0.78rem;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          cursor: pointer;
          text-decoration: none;
          display: inline-block;
        }
        .sweep:hover:not(:disabled), .detailLink:hover { border-color: var(--border-hover); }
        .sweep:disabled { opacity: 0.5; cursor: default; }
      `}</style>
      <style jsx global>{`
        .chip {
          padding: 4px 9px;
          font-size: 0.75rem;
          background: var(--bg-tertiary);
          color: var(--text-secondary);
          border: 1px solid var(--border-color);
          border-radius: 999px;
          cursor: pointer;
        }
        .chip:hover:not(:disabled) { border-color: var(--border-hover); }
        .chip.active {
          background: var(--accent-primary);
          border-color: var(--accent-primary);
          color: #fff;
        }
        .chip:disabled { opacity: 0.45; cursor: default; }
      `}</style>
    </>
  );
}

/** Colour key. Rendered from the same class names the SVG uses, so it can't drift. */
function Legend({ colour }: { colour: GraphColourMode }) {
  const t = useT();
  const entries: { key: string; label: string; css: string }[] =
    colour === 'status'
      ? [
          { key: 'completed', label: t('status.completed'), css: 'var(--score-9)' },
          { key: 'watching', label: t('status.watching'), css: 'var(--accent-primary)' },
          { key: 'on_hold', label: t('status.on_hold'), css: 'var(--score-6)' },
          { key: 'dropped', label: t('status.dropped'), css: 'var(--score-3)' },
          { key: 'plan_to_watch', label: t('status.plan_to_watch'), css: '#a855f7' },
          { key: 'none', label: t('graph.legend.unseen'), css: 'var(--border-hover)' },
        ]
      : [
          { key: 'anime', label: t('graph.focalType.anime'), css: 'var(--accent-primary)' },
          { key: 'seiyuu', label: t('graph.focalType.seiyuu'), css: '#f472b6' },
          { key: 'staff', label: t('graph.focalType.staff'), css: '#f59e0b' },
          { key: 'studio', label: t('graph.legend.studio'), css: '#14b8a6' },
        ];

  return (
    <div className="legend">
      {entries.map(entry => (
        <span key={entry.key} className="item">
          <span className="swatch" style={{ borderColor: entry.css }} />
          {entry.label}
        </span>
      ))}
      <style jsx>{`
        .legend { display: flex; flex-wrap: wrap; gap: 12px; font-size: 0.76rem; color: var(--text-muted); }
        .item { display: inline-flex; align-items: center; gap: 5px; }
        .swatch {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border-width: 2.5px;
          border-style: solid;
        }
      `}</style>
    </div>
  );
}

/** Search-to-recentre. Reuses `/api/anime/animes` rather than adding an endpoint. */
function FocalPicker({
  value,
  focalType,
  onPick,
}: {
  value: string;
  focalType: GraphFocalType;
  onPick: (id: string) => void;
}) {
  const t = useT();
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const trimmed = term.trim();
    if (trimmed.length < 2) { setHits([]); return; }
    // Debounced: the endpoint scans ~25k rows and returns full records, so a
    // keystroke-per-request would be wasteful for no gain.
    timer.current = setTimeout(() => {
      setSearching(true);
      fetch(`/api/anime/animes?search=${encodeURIComponent(trimmed)}&limit=12&sortBy=mean&sortDir=desc`)
        .then(res => res.json())
        .then((body: { animes?: AnimeRecord[] }) => {
          setHits((body.animes || []).map(a => ({
            id: a.id,
            title: a.catalog.title,
            year: a.catalog.startSeason?.year,
            poster: a.catalog.mainPicture?.medium,
          })));
        })
        .catch(() => setHits([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [term]);

  return (
    <section className="picker">
      <h3>{t('graph.picker.heading')}</h3>
      <input
        type="search"
        value={term}
        placeholder={t('graph.picker.placeholder')}
        onChange={e => setTerm(e.target.value)}
      />
      {searching && <p className="note">{t('graph.loading')}</p>}
      {hits.length > 0 && (
        <ul>
          {hits.map(hit => (
            <li key={hit.id}>
              <button
                className={hit.id === value && focalType === 'anime' ? 'hit current' : 'hit'}
                onClick={() => { onPick(hit.id); setTerm(''); setHits([]); }}
              >
                {hit.poster && <img src={hit.poster} alt="" />}
                <span className="title">
                  {hit.title}
                  {hit.year && <span className="year"> {hit.year}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <style jsx>{`
        .picker {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 10px 12px;
        }
        h3 {
          margin: 0 0 8px;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-muted);
        }
        input {
          width: 100%;
          padding: 6px 9px;
          font-size: 0.84rem;
          background: var(--bg-tertiary);
          color: var(--text-primary);
          border: 1px solid var(--border-color);
          border-radius: 6px;
        }
        ul { list-style: none; margin: 8px 0 0; padding: 0; max-height: 320px; overflow-y: auto; }
        .note { margin: 8px 0 0; font-size: 0.72rem; color: var(--text-muted); }
        .hit {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 4px 5px;
          background: none;
          border: 1px solid transparent;
          border-radius: 6px;
          color: var(--text-secondary);
          font-size: 0.78rem;
          text-align: left;
          cursor: pointer;
        }
        .hit:hover { background: var(--bg-tertiary); }
        .current { border-color: var(--accent-primary); }
        img { width: 28px; height: 40px; object-fit: cover; border-radius: 3px; flex: 0 0 auto; }
        .year { color: var(--text-muted); }
      `}</style>
    </section>
  );
}

/**
 * Resolves a default focal node when the URL has none, so `/graph` is never an
 * empty canvas — the same courtesy `/` extends by redirecting a bare URL to a
 * default preset. The pick is your best-scored title that actually has a cast
 * entry, because a title without one has no person edges to show.
 */
export const getServerSideProps: GetServerSideProps<Props> = async ({ query }) => {
  const records = getAnimeForDisplay();
  const cast = getAllAnilistCast();

  if (typeof query.id !== 'string' || !query.id.trim()) {
    let best: AnimeRecord | undefined;
    let bestScore = -1;
    for (const record of records) {
      if (!getEffectiveStatus(record)) continue;
      const entry = cast[record.id];
      if (!entry || entry.characters.length === 0) continue;
      const score = getEffectiveScore(record) ?? 0;
      if (score > bestScore) { bestScore = score; best = record; }
    }
    if (best) {
      return { redirect: { destination: `/graph?id=${encodeURIComponent(best.id)}`, permanent: false } };
    }
  }

  // Tag vocabulary, most common first — only the store knows which tags are
  // actually carried, same reasoning as `/api/anime/genres`.
  const tagCounts = new Map<string, number>();
  const mediaTypes = new Set<string>();
  for (const record of records) {
    for (const tag of record.sources.anilist?.tags || []) {
      tagCounts.set(tag.name, (tagCounts.get(tag.name) ?? 0) + 1);
    }
    if (record.catalog.mediaType) mediaTypes.add(record.catalog.mediaType);
  }

  return {
    props: {
      tagOptions: [...tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name),
      mediaTypeOptions: [...mediaTypes].sort(),
    },
  };
};
