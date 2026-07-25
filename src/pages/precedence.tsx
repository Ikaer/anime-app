/**
 * `/precedence` — the catalog precedence inspector (docs/DECISIONS.md, E6).
 *
 * Answers, for one title: what value does each catalog field hold, WHICH PROVIDER
 * supplied it, under what ordering, and what did every other provider offer?
 * It is the instrument for verifying a precedence change did what was intended —
 * without it, `CATALOG_PRECEDENCE_BY_FIELD` is a constant nobody can check.
 *
 * A pure READER: `explainCatalogPrecedence` rearranges data already on the
 * record, so there is no bespoke API and no new data path.
 *
 * Providers are SUB-ROWS, not columns. A column per provider made the table
 * wider than the screen (the page's own values are JSON blobs), so comparing
 * what MAL and AniList offered meant scrolling sideways with the field name out
 * of view; stacked under the effective value they compare on a single vertical
 * read. It also means a fourth catalog provider costs a row, not a column —
 * the same reasoning `/discrepancies` and the detail page's personal-state
 * table already follow.
 *
 * Which makes the sub-row ORDER the precedence chain, read downwards, so the
 * chain is not also printed under each field name: that second line aligned
 * with nothing and put every group half a row out of step with its own
 * sub-rows. The default ordering is stated once in the legend, and a field
 * whose ordering genuinely differs from it prints the chain — the exception,
 * not the rule.
 *
 * Deliberately NOT translated, unlike the rest of the app. The content is field
 * identifiers (`numEpisodes`, `airingStatus`), provider ids and raw JSON — none
 * of it translatable — and the doc frames this as a debugging surface favouring
 * "dense raw-JSON legibility over the app's usual card styling". Same standing
 * exception as `/rate`'s rubric.
 */

import { useState, useEffect, useCallback, type KeyboardEvent } from 'react';
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
  /**
   * Fields carrying an explicit ordering — the shipped `CATALOG_PRECEDENCE_BY_FIELD`
   * plus whatever `/settings` overrode (E5). Passed as a prop rather than read
   * from the constant: since precedence is user-configurable, importing the
   * source constant here would make this page report the shipped default while
   * the merge used the user's choice — on the one page whose job is to be
   * trusted about what the merge did.
   */
  pinnedFields: string[];
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

/**
 * Own `<style jsx>` for the same reason `Picker` has one: styled-jsx scopes to
 * the declaring component, so the page-level block never reaches this markup.
 */
function Value({ value, dim }: { value: unknown; dim?: boolean }) {
  const text = render(value);
  const body = text === ''
    ? <span className="absent">—</span>
    : text.length <= LONG
      ? <span className={dim ? 'dim' : undefined}>{text}</span>
      : (
        <details className={dim ? 'dim' : undefined}>
          <summary>{text.slice(0, LONG)}…</summary>
          <pre>{text}</pre>
        </details>
      );
  return (
    <>
      {body}
      <style jsx>{`
        .absent { color: var(--text-secondary); opacity: .6; }
        .dim { opacity: .5; }
        details summary { cursor: pointer; color: var(--text-secondary); }
        pre { white-space: pre-wrap; word-break: break-word; margin: .4rem 0 0; font-size: .78rem; }
      `}</style>
    </>
  );
}

/**
 * Providers to list under a field, in the order that decided it. A provider that
 * offered a value but sits outside that ordering is appended rather than hidden —
 * an off-precedence contribution is exactly the kind of surprise this page is for.
 */
function sourcesOf(r: CatalogFieldExplain): CatalogSource[] {
  const extra = SOURCES.filter(s => r.bySource[s] !== undefined && !r.precedence.includes(s));
  return [...r.precedence, ...extra];
}

/**
 * Whether this field's ordering actually READS differently from the default —
 * `mean` is pinned to an array identical to the default, so comparing content
 * (not identity, and not mere presence in the override map) is what keeps the
 * chain off 24 rows that would all print the same three words.
 */
function overridesDefault(r: CatalogFieldExplain): boolean {
  return r.mergeMode !== 'union' && r.precedence.join('>') !== DEFAULT_CATALOG_PRECEDENCE.join('>');
}

const CANONICAL_ID = /^a_\d+$/;

/**
 * Title picker — reuses `/api/anime/search`, which caps at 8 anime hits.
 *
 * Carries its OWN `<style jsx>` block: styled-jsx scopes to the component that
 * declares it, so the page's styles below never reached this subtree — which is
 * exactly why the search used to render as an unstyled input + bullet list.
 */
function Picker({ current }: { current?: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AnimeSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const term = q.trim();
  const isId = CANONICAL_ID.test(term);

  useEffect(() => {
    if (term.length < 2 || isId) { setHits([]); setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/anime/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) { setHits((await res.json()).animes ?? []); setActive(0); }
      } catch { /* aborted */ }
      finally { setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [term, isId]);

  const pick = useCallback((id: string) => {
    setQ(''); setHits([]); setOpen(false);
    router.push(`/precedence?id=${encodeURIComponent(id)}`);
  }, [router]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setQ(''); setOpen(false); return; }
    if (e.key === 'Enter') {
      if (isId) pick(term);
      else if (hits[active]) pick(hits[active].id);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hits.length === 0) return;
      e.preventDefault();
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    }
  };

  const showHits = open && !isId && (hits.length > 0 || (term.length >= 2 && !loading));

  return (
    <div className="picker">
      <div className="field">
        <span className="icon" aria-hidden="true">⌕</span>
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="Search a title, or paste a canonical id (a_1391)…"
          aria-label="Search a title"
          spellCheck={false}
        />
        {loading && <span className="spin" aria-hidden="true" />}
        {q && <button className="clear" onMouseDown={e => e.preventDefault()} onClick={() => setQ('')} aria-label="Clear">×</button>}
        {isId && <button className="go" onMouseDown={e => e.preventDefault()} onClick={() => pick(term)}>Go →</button>}
      </div>

      {current && <code className="current" title="Currently inspected record">{current}</code>}

      {showHits && (
        <ul className="hits" role="listbox">
          {hits.map((h, i) => (
            <li key={h.id}>
              <button
                type="button"
                className={i === active ? 'hit is-active' : 'hit'}
                onMouseDown={e => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(h.id)}
              >
                {h.poster
                  ? <img src={h.poster} alt="" />
                  : <span className="noimg" aria-hidden="true">?</span>}
                <span className="hitBody">
                  <span className="hitTitle">{h.title}</span>
                  {h.secondary && <span className="hitAlt">{h.secondary}</span>}
                </span>
                <span className="hitMeta">
                  {[h.mediaType?.toUpperCase(), h.year, h.mean != null ? `★ ${h.mean.toFixed(2)}` : null]
                    .filter(Boolean).join(' · ')}
                  <code>{h.id}</code>
                </span>
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="none">No match.</li>}
        </ul>
      )}

      <style jsx>{`
        .picker { position: relative; display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }

        .field {
          display: flex; align-items: center; gap: .5rem;
          background: var(--bg-secondary); border: 1px solid var(--border-color);
          border-radius: 8px; padding: 0 .6rem; min-width: 30rem;
          transition: border-color .15s, box-shadow .15s;
        }
        .field:focus-within { border-color: var(--accent-primary); box-shadow: 0 0 0 3px rgba(59, 130, 246, .18); }
        .icon { color: var(--text-muted); font-size: 1.1rem; line-height: 1; }
        .field input {
          flex: 1; min-width: 0; background: none; border: 0; outline: none;
          color: var(--text-primary); font-size: .95rem; padding: .55rem 0;
        }
        .field input::placeholder { color: var(--text-muted); }

        .clear {
          background: none; border: 0; cursor: pointer; color: var(--text-muted);
          font-size: 1.1rem; line-height: 1; padding: 0 .2rem;
        }
        .clear:hover { color: var(--text-primary); }
        .go {
          background: var(--accent-primary); border: 0; border-radius: 6px; color: #fff;
          font-size: .78rem; font-weight: 600; padding: .25rem .55rem; cursor: pointer;
        }
        .spin {
          width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto;
          border: 2px solid var(--border-hover); border-top-color: var(--accent-primary);
          animation: spin .7s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .current { color: var(--text-secondary); font-size: .8rem; }

        .hits {
          position: absolute; top: 100%; left: 0; z-index: 30; margin: .35rem 0 0; padding: .25rem;
          list-style: none; background: var(--bg-secondary);
          border: 1px solid var(--border-hover); border-radius: 8px; width: 34rem; max-width: 90vw;
          max-height: 60vh; overflow-y: auto; box-shadow: var(--shadow-lg);
        }
        .none { padding: .6rem .5rem; color: var(--text-muted); font-size: .85rem; }
        .hit {
          display: flex; align-items: center; gap: .6rem; width: 100%;
          background: none; border: 0; border-radius: 6px; color: var(--text-primary);
          padding: .35rem .4rem; cursor: pointer; text-align: left; font-size: .9rem;
        }
        .hit.is-active { background: var(--bg-tertiary); }
        .hit img, .hit .noimg {
          width: 32px; height: 44px; flex: 0 0 32px; border-radius: 4px; object-fit: cover;
          background: var(--bg-tertiary);
        }
        .hit .noimg { display: flex; align-items: center; justify-content: center; color: var(--text-muted); }
        .hitBody { display: flex; flex-direction: column; gap: .1rem; min-width: 0; flex: 1; }
        .hitTitle, .hitAlt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .hitAlt { color: var(--text-muted); font-size: .78rem; }
        .hitMeta {
          display: flex; flex-direction: column; align-items: flex-end; gap: .1rem;
          color: var(--text-secondary); font-size: .72rem; white-space: nowrap;
        }
        .hitMeta code { color: var(--text-muted); }
      `}</style>
    </div>
  );
}

export default function PrecedencePage({ anime, rows, pinnedFields, notFound }: Props) {
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
              <span className="legend">
                <span className="key">default ordering <code>{DEFAULT_CATALOG_PRECEDENCE.join(' › ')}</code></span>
                <span className="key"><i className="swatchWon" />winner — supplied the effective value</span>
                <span className="key"><i className="swatchDiff" />contested field · differing value</span>
              </span>
            </h2>
            <div className="scroll">
              <table>
                <thead>
                  <tr>
                    <th className="cField">Field</th>
                    <th className="cSource">Source</th>
                    <th>Value</th>
                  </tr>
                </thead>
                {/* One <tbody> per field: the group's first row is the resolved
                    value, and each provider follows as a SUB-ROW rather than a
                    column. Provider values then sit directly under the effective
                    one, so comparing them is a vertical read of a single column
                    instead of a sideways scan across a table wider than the screen. */}
                {rows.map(r => {
                  const sources = sourcesOf(r);
                  // Sub-rows only where precedence actually arbitrated something.
                  // A settled field has exactly one supplier whose value IS the
                  // effective one — repeating it would be pure noise.
                  const sub = r.contested ? sources : [];
                  const effText = render(r.effective);
                  return (
                    <tbody key={r.field} className={r.contested ? 'contested' : 'settled'}>
                      <tr className="fieldRow">
                        {/* One line, so the field name sits on the same baseline
                            as the effective row it heads. The ordering used to
                            live here as a second line, which pushed every group
                            out of alignment with its own sub-rows for
                            information the numbered sub-rows already carry. */}
                        <th scope="rowgroup" rowSpan={1 + sub.length}>
                          <span className="fname">{r.field}</span>
                          {pinnedFields.includes(r.field) && (
                            <span className="pin" title={`Explicit per-field ordering: ${r.precedence.join(' › ')}`}>pinned</span>
                          )}
                          {overridesDefault(r) && <span className="order">{r.precedence.join(' › ')}</span>}
                        </th>
                        <td className="srcCell">
                          <span className="effLabel">effective</span>
                          {r.mergeMode === 'union'
                            ? <span className="union">union</span>
                            : r.winner
                              ? <span className="won">{r.winner}</span>
                              : <span className="absent">—</span>}
                        </td>
                        <td className="valCell eff"><Value value={r.effective} /></td>
                      </tr>

                      {sub.map(s => {
                        const has = r.bySource[s] !== undefined;
                        const same = has && render(r.bySource[s]) === effText;
                        // The rank IS the precedence chain, read downwards. A
                        // union field has no ranking to state, and a provider
                        // outside the chain has no rank at all — both would be a
                        // lie as a number.
                        const rank = r.mergeMode === 'union'
                          ? '∪'
                          : r.precedence.indexOf(s) < 0 ? '·' : String(r.precedence.indexOf(s) + 1);
                        return (
                          <tr key={s} className="subRow">
                            <td className={`srcCell ${s === r.winner ? 'isWinner' : ''}`}>
                              <span className="rank">{rank}</span>
                              <span className="srcName">{s}</span>
                              {s === r.winner && <span className="check" title="Supplied the effective value">✓</span>}
                              {r.precedence.indexOf(s) < 0 && <span className="offchain" title="Supplied a value but is not in this field's precedence">off-chain</span>}
                            </td>
                            <td className={`valCell ${same ? 'same' : has ? 'diff' : ''}`}>
                              <Value value={r.bySource[s]} dim={same} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })}
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
        .legend { display: flex; gap: .9rem; margin-left: auto; font-size: .75rem; font-weight: 400; color: var(--text-muted); }
        .key { display: inline-flex; align-items: center; gap: .35rem; }
        .key code { color: var(--text-secondary); }
        .key i { width: .55rem; height: .55rem; border-radius: 2px; display: inline-block; }
        .swatchWon { background: #4ade80; }
        .swatchDiff { background: #facc15; }
        .empty { color: var(--text-secondary); padding: 2rem 0; }

        /* Wide content scrolls in its own container — the page must never scroll sideways. */
        .scroll { overflow-x: auto; border: 1px solid var(--border-color); border-radius: 8px; }
        table { border-collapse: collapse; width: 100%; font-size: .82rem; }
        th, td { text-align: left; padding: .4rem .6rem; vertical-align: top; }
        thead th {
          position: sticky; top: 0; background: var(--bg-tertiary);
          font-weight: 600; white-space: nowrap; z-index: 1;
          border-bottom: 1px solid var(--border-color);
        }
        .cField { width: 15rem; }
        .cSource { width: 11rem; }

        /* The group border is on the <tbody>, so a field and its provider
           sub-rows read as one block. */
        tbody { border-bottom: 1px solid var(--border-color); }
        tbody.settled { opacity: .6; }
        tbody.contested .fieldRow > th { border-left: 2px solid #facc15; }

        /* Same padding as the <td>s it sits beside: a .1rem difference is enough
           to make the field name and its effective row read as two lines. */
        tbody th { white-space: nowrap; font-weight: 500; background: rgba(255, 255, 255, .012); }
        .fname { font-family: ui-monospace, monospace; color: var(--text-primary); }
        .pin {
          margin-left: .45rem; padding: 0 .3rem; border-radius: 3px; font-size: .65rem;
          letter-spacing: .03em; text-transform: uppercase; color: #facc15;
          border: 1px solid rgba(250, 204, 21, .4); vertical-align: 1px;
        }
        .order { display: block; margin-top: .15rem; color: #facc15; font-size: .72rem; }

        .srcCell { white-space: nowrap; }
        .effLabel {
          display: inline-block; margin-right: .4rem; font-size: .68rem; letter-spacing: .04em;
          text-transform: uppercase; color: var(--text-muted);
        }
        .rank {
          display: inline-block; width: 1.1rem; color: var(--text-muted);
          font-size: .7rem; font-variant-numeric: tabular-nums;
        }
        .srcName { font-family: ui-monospace, monospace; color: var(--text-secondary); }
        .isWinner .srcName { color: #4ade80; font-weight: 600; }
        .check { color: #4ade80; margin-left: .3rem; }
        .offchain { margin-left: .35rem; color: #facc15; font-size: .65rem; text-transform: uppercase; letter-spacing: .03em; }
        .subRow > td { padding-top: .2rem; padding-bottom: .2rem; }
        .subRow .valCell { border-left: 2px solid var(--border-color); }
        .subRow .valCell.diff { border-left-color: #facc15; }

        .valCell { max-width: 62rem; }
        .valCell.eff { color: var(--text-primary); }

        .won { color: #4ade80; font-weight: 600; }
        .union { color: #facc15; font-weight: 600; }
        .absent { color: var(--text-secondary); opacity: .6; }
        .dim { opacity: .5; }
        details summary { cursor: pointer; color: var(--text-secondary); }
        pre { white-space: pre-wrap; word-break: break-word; margin: .4rem 0 0; font-size: .78rem; }
      `}</style>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ query }) => {
  const id = typeof query.id === 'string' ? query.id : '';
  // Server-only: imported inside getServerSideProps so neither the store nor the
  // settings reader reaches the client bundle. The resolved per-field map is the
  // same one `getAnimeForDisplay` threads into the merge — read it here too, or
  // this page describes an ordering the record wasn't built with.
  const { getCatalogPrecedenceByField } = await import('@/lib/config/settings');
  const byField = getCatalogPrecedenceByField();
  const pinnedFields = Object.keys(byField);

  if (!id) return { props: { anime: null, rows: [], pinnedFields, notFound: false } };

  // One record via the cache-bypassing lookup — cheap, and fresh by construction
  // (see CLAUDE.md on the detail page doing the same).
  const { getAnimeByCanonicalId } = await import('@/lib/store');
  const record: AnimeRecord | undefined = getAnimeByCanonicalId(id);
  if (!record) return { props: { anime: null, rows: [], pinnedFields, notFound: true } };

  return {
    props: {
      anime: { id: record.id, title: getPrimaryTitle(record) },
      // JSON round-trip: `undefined` is not serializable across the SSR boundary,
      // and the explain rows are dense with optional fields.
      rows: JSON.parse(JSON.stringify(explainCatalogPrecedence(record, undefined, byField))),
      pinnedFields,
      notFound: false,
    },
  };
};
