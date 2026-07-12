import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useT } from '@/lib/i18n';
import type { GlobalSearchResults, AnimeSearchHit, CreditSearchHit } from '@/lib/globalSearch';
import { MIN_QUERY_LENGTH } from '@/lib/globalSearch';
import styles from './GlobalSearch.module.css';

const EMPTY: GlobalSearchResults = { animes: [], studios: [], staff: [] };

// A single navigable row in the flattened dropdown (for keyboard arrows).
interface FlatItem {
  href: string;
  key: string;
}

/**
 * Header global search: type a title to jump to a detail page, or a studio /
 * staff name to jump to its credits page. Debounced fetch against
 * `/api/anime/search`; results grouped into Anime / Studios / Staff.
 */
export default function GlobalSearch() {
  const router = useRouter();
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResults>(EMPTY);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1); // index into the flattened item list

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flattened, ordered list of every navigable row — the arrow-key target order.
  const flat = useMemo<FlatItem[]>(() => {
    const items: FlatItem[] = [];
    for (const a of results.animes) items.push({ href: `/anime/${a.id}`, key: `a${a.id}` });
    for (const s of results.studios) items.push({ href: `/credits/studio/${s.id}`, key: `st${s.id}` });
    for (const s of results.staff) items.push({ href: `/credits/staff/${s.id}`, key: `sf${s.id}` });
    return items;
  }, [results]);

  const hasResults = flat.length > 0;
  const showEmpty = open && !loading && query.trim().length >= MIN_QUERY_LENGTH && !hasResults;

  // Debounced fetch.
  useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY_LENGTH) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/anime/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data: GlobalSearchResults = await res.json();
        setResults(data);
        setActive(-1);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Close + clear whenever navigation completes.
  useEffect(() => {
    const done = () => { setOpen(false); setQuery(''); };
    router.events.on('routeChangeComplete', done);
    return () => router.events.off('routeChangeComplete', done);
  }, [router.events]);

  const go = useCallback((href: string) => {
    router.push(href);
    setOpen(false);
  }, [router]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || !hasResults) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(i => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(i => (i <= 0 ? flat.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      const target = active >= 0 ? flat[active] : flat[0];
      if (target) { e.preventDefault(); go(target.href); }
    }
  };

  // Map a group-local index to the flattened index (for the active highlight).
  const animeBase = 0;
  const studioBase = results.animes.length;
  const staffBase = results.animes.length + results.studios.length;

  return (
    <div className={styles.root} ref={rootRef}>
      <span className={styles.icon} aria-hidden="true">🔍</span>
      <input
        ref={inputRef}
        type="search"
        className={styles.input}
        placeholder={t('search.placeholder')}
        value={query}
        aria-label={t('search.placeholder')}
        autoComplete="off"
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open && (hasResults || showEmpty || loading) && (
        <div className={styles.dropdown} role="listbox">
          {results.animes.length > 0 && (
            <div className={styles.group}>
              <div className={styles.groupTitle}>{t('search.group.anime')}</div>
              {results.animes.map((a, i) => (
                <AnimeRow
                  key={`a${a.id}`}
                  hit={a}
                  activeRow={active === animeBase + i}
                  onHover={() => setActive(animeBase + i)}
                  onClick={() => go(`/anime/${a.id}`)}
                />
              ))}
            </div>
          )}

          {results.studios.length > 0 && (
            <div className={styles.group}>
              <div className={styles.groupTitle}>{t('search.group.studios')}</div>
              {results.studios.map((s, i) => (
                <CreditRow
                  key={`st${s.id}`}
                  hit={s}
                  activeRow={active === studioBase + i}
                  countLabel={t('search.animeCount', { count: s.count })}
                  onHover={() => setActive(studioBase + i)}
                  onClick={() => go(`/credits/studio/${s.id}`)}
                />
              ))}
            </div>
          )}

          {results.staff.length > 0 && (
            <div className={styles.group}>
              <div className={styles.groupTitle}>{t('search.group.staff')}</div>
              {results.staff.map((s, i) => (
                <CreditRow
                  key={`sf${s.id}`}
                  hit={s}
                  activeRow={active === staffBase + i}
                  countLabel={s.role || t('search.animeCount', { count: s.count })}
                  onHover={() => setActive(staffBase + i)}
                  onClick={() => go(`/credits/staff/${s.id}`)}
                />
              ))}
            </div>
          )}

          {showEmpty && <div className={styles.empty}>{t('search.noResults')}</div>}
          {loading && !hasResults && <div className={styles.empty}>{t('search.searching')}</div>}
        </div>
      )}
    </div>
  );
}

function AnimeRow({ hit, activeRow, onHover, onClick }: {
  hit: AnimeSearchHit; activeRow: boolean; onHover: () => void; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={activeRow}
      className={`${styles.row} ${activeRow ? styles.rowActive : ''}`}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      {hit.poster
        ? <img className={styles.poster} src={hit.poster} alt="" />
        : <span className={styles.posterFallback}>?</span>}
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{hit.title}</span>
        {hit.secondary && <span className={styles.rowSub}>{hit.secondary}</span>}
      </span>
      <span className={styles.rowMeta}>
        {hit.year && <span>{hit.year}</span>}
        {hit.mediaType && <span>{hit.mediaType.toUpperCase()}</span>}
        {hit.mean != null && <span className={styles.mean}>★ {hit.mean.toFixed(2)}</span>}
      </span>
    </button>
  );
}

function CreditRow({ hit, activeRow, countLabel, onHover, onClick }: {
  hit: CreditSearchHit; activeRow: boolean; countLabel: string; onHover: () => void; onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={activeRow}
      className={`${styles.row} ${styles.creditRow} ${activeRow ? styles.rowActive : ''}`}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      <span className={styles.rowBody}>
        <span className={styles.rowTitle}>{hit.name}</span>
      </span>
      <span className={styles.rowMeta}>{countLabel}</span>
    </button>
  );
}
