import React, { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import type { AnimeSearchHit } from '@/lib/domain/globalSearch';
import { useT } from '@/lib/i18n';
import styles from './MixAnchorsSection.module.css';

/**
 * The "/mix" anchor picker: a search box that adds anime to the mix, plus the
 * picked set as removable chips. This IS the page's primary control — every
 * add/remove re-ranks the feed — so it sits at the top of the sidebar, above
 * the filters.
 *
 * Search reuses `/api/anime/search` (the header's endpoint, capped at 8 anime
 * hits) rather than a new one; already-picked titles stay visible in the results
 * but are marked and inert, which reads better than silently vanishing.
 */
export interface MixAnchor {
  id: string;
  title: string;
  poster?: string;
}

interface MixAnchorsSectionProps {
  /** Resolved anchors (title + poster come from the API, so a bookmarked mix renders). */
  anchors: MixAnchor[];
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  /** Cap on the anchor set; the input goes read-only once reached. */
  max: number;
}

const MixAnchorsSection: React.FC<MixAnchorsSectionProps> = ({ anchors, onAdd, onRemove, max }) => {
  const t = useT();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AnimeSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const term = q.trim();
  const full = anchors.length >= max;

  useEffect(() => {
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    const ctrl = new AbortController();
    setLoading(true);
    // Debounced: the endpoint scans the whole catalog, so a request per
    // keystroke would be wasteful for no gain.
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/anime/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) { setHits((await res.json()).animes ?? []); setActive(0); }
      } catch { /* aborted */ }
      finally { setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [term]);

  const picked = new Set(anchors.map(a => a.id));

  const pick = useCallback((id: string) => {
    if (picked.has(id)) return;
    onAdd(id);
    setQ('');
    setHits([]);
  }, [onAdd, picked]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setQ(''); setHits([]); return; }
    if (e.key === 'Enter') { if (hits[active]) pick(hits[active].id); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hits.length === 0) return;
      e.preventDefault();
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.field}>
        <span className={styles.icon} aria-hidden="true">⌕</span>
        <input
          className={styles.input}
          value={q}
          onChange={e => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={full ? t('mix.anchorsFull', { max }) : t('mix.searchPlaceholder')}
          aria-label={t('mix.searchPlaceholder')}
          disabled={full}
          spellCheck={false}
        />
        {q && (
          <button className={styles.clear} onClick={() => { setQ(''); setHits([]); }} aria-label={t('common.clear')}>
            ×
          </button>
        )}
      </div>

      {loading && <p className={styles.note}>{t('common.loading')}</p>}
      {!loading && term.length >= 2 && hits.length === 0 && <p className={styles.note}>{t('mix.noHits')}</p>}

      {hits.length > 0 && (
        <ul className={styles.hits} role="listbox">
          {hits.map((h, i) => {
            const already = picked.has(h.id);
            return (
              <li key={h.id}>
                <button
                  type="button"
                  className={`${styles.hit} ${i === active ? styles.hitActive : ''} ${already ? styles.hitPicked : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(h.id)}
                  disabled={already}
                  title={already ? t('mix.alreadyPicked') : t('mix.addAnchor')}
                >
                  {h.poster ? (
                    <Image src={h.poster} alt="" width={28} height={40} className={styles.hitPoster} unoptimized />
                  ) : (
                    <span className={styles.hitPosterEmpty} aria-hidden="true" />
                  )}
                  <span className={styles.hitText}>
                    <span className={styles.hitTitle}>{h.title}</span>
                    <span className={styles.hitMeta}>
                      {h.year ?? '—'}
                      {h.mediaType ? ` · ${h.mediaType.toUpperCase()}` : ''}
                      {h.mean ? ` · ★ ${h.mean.toFixed(2)}` : ''}
                    </span>
                  </span>
                  <span className={styles.hitAdd} aria-hidden="true">{already ? '✓' : '+'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className={styles.chips}>
        {anchors.length === 0 ? (
          <p className={styles.empty}>{t('mix.emptyAnchors')}</p>
        ) : (
          anchors.map(a => (
            <span key={a.id} className={styles.chip}>
              {a.poster && <Image src={a.poster} alt="" width={22} height={31} className={styles.chipPoster} unoptimized />}
              <span className={styles.chipTitle} title={a.title}>{a.title}</span>
              <button
                className={styles.chipRemove}
                onClick={() => onRemove(a.id)}
                aria-label={t('mix.removeAnchor', { title: a.title })}
                title={t('mix.removeAnchor', { title: a.title })}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      {anchors.length > 0 && (
        <p className={styles.note}>{t('mix.anchorCount', { count: anchors.length, max })}</p>
      )}
    </div>
  );
};

export default MixAnchorsSection;
