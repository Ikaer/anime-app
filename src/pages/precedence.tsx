/**
 * `/precedence` — the catalog precedence inspector (docs/FULL Precedence, E6).
 *
 * Answers, for one title: what value does each catalog field hold, WHICH PROVIDER
 * supplied it, under what ordering, and what did every other provider offer?
 * It is the instrument for verifying a precedence change did what was intended —
 * without it, `CATALOG_PRECEDENCE_BY_FIELD` is a constant nobody can check.
 *
 * A pure READER: `explainCatalogPrecedence` rearranges data already on the
 * record, so there is no bespoke API and no new data path.
 *
 * Deliberately NOT translated, unlike the rest of the app. The content is field
 * identifiers (`numEpisodes`, `airingStatus`), provider ids and raw JSON — none
 * of it translatable — and the doc frames this as a debugging surface favouring
 * "dense raw-JSON legibility over the app's usual card styling". Same standing
 * exception as `/rate`'s rubric.
 */

import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import type { AnimeRecord, CatalogSource } from '@/models/anime';
import {
  explainCatalogPrecedence,
  getPrimaryTitle,
  DEFAULT_CATALOG_PRECEDENCE,
  type CatalogFieldExplain,
} from '@/lib/domain/animeUtils';
import type { AnimeSearchHit } from '@/lib/domain/globalSearch';

/** Every provider that can contribute a catalog field, in default order. */
const SOURCES: CatalogSource[] = DEFAULT_CATALOG_PRECEDENCE;

interface Props {
  anime: { id: string; title: string } | null;
  rows: CatalogFieldExplain[];
  notFound: boolean;
}

/** Compact JSON, with strings unquoted so a synopsis reads as prose. */
function render(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

const LONG = 160;

function Value({ value, dim }: { value: unknown; dim?: boolean }) {
  const text = render(value);
  if (text === '') return <span className="absent">—</span>;
  if (text.length <= LONG) return <span className={dim ? 'dim' : undefined}>{text}</span>;
  return (
    <details className={dim ? 'dim' : undefined}>
      <summary>{text.slice(0, LONG)}…</summary>
      <pre>{text}</pre>
    </details>
  );
}

/** Title picker — reuses `/api/anime/search`, which caps at 8 anime hits. */
function Picker({ current }: { current?: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AnimeSearchHit[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/anime/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) setHits((await res.json()).animes ?? []);
      } catch { /* aborted */ }
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);

  const pick = useCallback((id: string) => {
    setQ(''); setHits([]);
    router.push(`/precedence?id=${encodeURIComponent(id)}`);
  }, [router]);

  return (
    <div className="picker">
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search a title, or paste a canonical id (a_1391)…"
        onKeyDown={e => {
          if (e.key === 'Enter' && /^a_\d+$/.test(q.trim())) pick(q.trim());
        }}
        spellCheck={false}
      />
      {current && <code className="current">{current}</code>}
      {hits.length > 0 && (
        <ul className="hits">
          {hits.map(h => (
            <li key={h.id}>
              <button onClick={() => pick(h.id)}>
                <span>{h.title}</span>
                <code>{h.id}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PrecedencePage({ anime, rows, notFound }: Props) {
  const contested = rows.filter(r => r.contested).length;

  return (
    <>
      <Head><title>{anime ? `${anime.title} — Precedence` : 'Precedence inspector'}</title></Head>
      <div className="wrap">
        <header>
          <h1>Catalog precedence inspector</h1>
          <p className="sub">
            Which provider filled each catalog field, and what the others offered.
            Contested fields first.
          </p>
          <Picker current={anime?.id} />
        </header>

        {notFound && <p className="empty">No record for that id.</p>}
        {!anime && !notFound && <p className="empty">Pick a title to inspect.</p>}

        {anime && (
          <>
            <h2>
              <Link href={`/anime/${anime.id}`}>{anime.title}</Link>
              <span className="meta">{contested} contested / {rows.length} fields</span>
            </h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Winner</th>
                    <th>Ordering</th>
                    <th>Effective value</th>
                    {SOURCES.map(s => <th key={s}>{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.field} className={r.contested ? 'contested' : undefined}>
                      <th scope="row">{r.field}</th>
                      <td>
                        {r.mergeMode === 'union'
                          ? <span className="union">union</span>
                          : r.winner
                            ? <span className={`won won-${r.winner}`}>{r.winner}</span>
                            : <span className="absent">—</span>}
                      </td>
                      <td className="order">
                        {r.mergeMode === 'union'
                          ? <span className="absent">all providers merged</span>
                          : r.precedence.map((s, i) => (
                              <span key={s} className={s === r.winner ? 'won' : undefined}>
                                {i > 0 && ' › '}{s}
                              </span>
                            ))}
                      </td>
                      <td><Value value={r.effective} /></td>
                      {SOURCES.map(s => (
                        <td key={s} className={s === r.winner ? 'winnerCell' : undefined}>
                          <Value value={r.bySource[s]} dim={r.mergeMode === 'precedence' && s !== r.winner} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <style jsx>{`
        .wrap { padding: 1rem 1.5rem 3rem; max-width: 100%; }
        h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
        .sub { color: var(--text-secondary); margin: 0 0 1rem; font-size: .9rem; }
        h2 { font-size: 1.1rem; margin: 1.25rem 0 .5rem; display: flex; gap: .75rem; align-items: baseline; flex-wrap: wrap; }
        h2 :global(a) { color: var(--text-primary); }
        .meta { color: var(--text-secondary); font-size: .8rem; font-weight: 400; }
        .empty { color: var(--text-secondary); padding: 2rem 0; }

        .picker { position: relative; display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
        .picker input {
          background: var(--bg-secondary); color: var(--text-primary);
          border: 1px solid var(--border-color); border-radius: 6px;
          padding: .5rem .75rem; min-width: 26rem; font-size: .9rem;
        }
        .current { color: var(--text-secondary); font-size: .8rem; }
        .hits {
          position: absolute; top: 100%; left: 0; z-index: 20; margin: .25rem 0 0; padding: .25rem;
          list-style: none; background: var(--bg-secondary);
          border: 1px solid var(--border-color); border-radius: 6px; min-width: 26rem;
          max-height: 60vh; overflow-y: auto;
        }
        .hits button {
          display: flex; justify-content: space-between; gap: 1rem; width: 100%;
          background: none; border: 0; color: var(--text-primary);
          padding: .4rem .5rem; cursor: pointer; text-align: left; font-size: .9rem;
        }
        .hits button:hover { background: var(--bg-tertiary); }
        .hits code { color: var(--text-secondary); font-size: .75rem; }

        /* Wide content scrolls in its own container — the page must never scroll sideways. */
        .scroll { overflow-x: auto; border: 1px solid var(--border-color); border-radius: 8px; }
        table { border-collapse: collapse; width: 100%; font-size: .82rem; }
        th, td {
          text-align: left; padding: .4rem .6rem; vertical-align: top;
          border-bottom: 1px solid var(--border-color);
        }
        thead th {
          position: sticky; top: 0; background: var(--bg-tertiary);
          font-weight: 600; white-space: nowrap; z-index: 1;
        }
        tbody th { font-family: ui-monospace, monospace; white-space: nowrap; font-weight: 500; }
        td { max-width: 34rem; }
        tr.contested tbody th { color: var(--text-primary); }
        tr:not(.contested) { opacity: .62; }
        .order { white-space: nowrap; color: var(--text-secondary); font-size: .78rem; }
        .order .won, .won { color: var(--accent-color, #4ade80); font-weight: 600; }
        .union { color: #facc15; font-weight: 600; }
        .absent { color: var(--text-secondary); opacity: .6; }
        .dim { opacity: .55; }
        .winnerCell { background: rgba(74, 222, 128, .07); }
        details summary { cursor: pointer; color: var(--text-secondary); }
        pre { white-space: pre-wrap; word-break: break-word; margin: .4rem 0 0; font-size: .78rem; }
      `}</style>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ query }) => {
  const id = typeof query.id === 'string' ? query.id : '';
  if (!id) return { props: { anime: null, rows: [], notFound: false } };

  // Server-only: imported inside getServerSideProps so the store never reaches
  // the client bundle. One record via the cache-bypassing lookup — cheap, and
  // fresh by construction (see CLAUDE.md on the detail page doing the same).
  const { getAnimeByCanonicalId } = await import('@/lib/store');
  const record: AnimeRecord | undefined = getAnimeByCanonicalId(id);
  if (!record) return { props: { anime: null, rows: [], notFound: true } };

  return {
    props: {
      anime: { id: record.id, title: getPrimaryTitle(record) },
      // JSON round-trip: `undefined` is not serializable across the SSR boundary,
      // and the explain rows are dense with optional fields.
      rows: JSON.parse(JSON.stringify(explainCatalogPrecedence(record))),
      notFound: false,
    },
  };
};
