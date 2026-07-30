import React, { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
 *
 * ⚠️ **The results panel is `position: fixed`, measured off the input**, and that
 * is not decoration. Constrained to the 280px sidebar its rows truncated to
 * `KonoSuba: God's Blessing on This…` — six identical-looking rows for six
 * different seasons, which makes the control unusable for exactly the franchise
 * case it exists to serve. It cannot escape the sidebar in flow either:
 * `AnimePageLayout`'s `.sidebar` sets `overflow-y: auto`, which turns the other
 * axis into a scrollport too, so an absolutely-positioned panel is clipped at
 * 280px just the same. Fixed positioning is the one option that overlays the
 * main content; the cost is measuring on open, scroll and resize.
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

/** Panel geometry, in viewport coordinates (it is `position: fixed`). */
interface PanelPos {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/** Wide enough for a full franchise title on two lines; clamped to the viewport. */
const PANEL_MIN_WIDTH = 460;
const PANEL_MAX_WIDTH = 620;
const VIEWPORT_MARGIN = 12;

const MixAnchorsSection: React.FC<MixAnchorsSectionProps> = ({ anchors, onAdd, onRemove, max }) => {
  const t = useT();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<AnimeSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);

  const fieldRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  const term = q.trim();
  const full = anchors.length >= max;
  const showPanel = open && term.length >= 2;

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

  /** Anchor the panel under the input, widened past the sidebar and kept on screen. */
  const measure = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(r.left, window.innerWidth - width - VIEWPORT_MARGIN));
    const top = r.bottom + 6;
    setPos({ top, left, width, maxHeight: Math.max(200, window.innerHeight - top - VIEWPORT_MARGIN) });
  }, []);

  // Re-measure while the panel is up: the sidebar scrolls independently, so a
  // `scroll` listener in CAPTURE phase is what catches it (scroll events on a
  // nested scroller do not bubble).
  useEffect(() => {
    if (!showPanel) { setPos(null); return; }
    measure();
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [showPanel, hits.length, measure]);

  // Click-outside closes. A fixed panel is not inside the field's subtree, so
  // `onBlur` alone would fire before a row's click lands.
  useEffect(() => {
    if (!showPanel) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (fieldRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showPanel]);

  // Keep the keyboard-selected row visible — the list is scrollable now.
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const picked = new Set(anchors.map(a => a.id));

  const pick = useCallback((id: string) => {
    if (picked.has(id)) return;
    onAdd(id);
    setQ('');
    setHits([]);
    setOpen(false);
  }, [onAdd, picked]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'Enter') { if (hits[active]) pick(hits[active].id); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hits.length === 0) return;
      e.preventDefault();
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    }
  };

  return (
    <div className={styles.section}>
      <div className={styles.field} ref={fieldRef}>
        <span className={styles.icon} aria-hidden="true">⌕</span>
        <input
          className={styles.input}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
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

      {showPanel && pos && (
        <div
          className={styles.panel}
          ref={panelRef}
          style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        >
          {loading && <p className={styles.panelNote}>{t('common.loading')}</p>}
          {!loading && hits.length === 0 && <p className={styles.panelNote}>{t('mix.noHits')}</p>}

          {hits.length > 0 && (
            <ul className={styles.hits} role="listbox">
              {hits.map((h, i) => {
                const already = picked.has(h.id);
                // The full title IS the tooltip: with six near-identical
                // franchise entries, "Ajouter au mix" answers a question nobody
                // was asking. The season is what the row must disambiguate.
                const label = already ? `${h.title} — ${t('mix.alreadyPicked')}` : h.title;
                return (
                  <li key={h.id} ref={i === active ? activeRef : undefined}>
                    <button
                      type="button"
                      className={`${styles.hit} ${i === active ? styles.hitActive : ''} ${already ? styles.hitPicked : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(h.id)}
                      disabled={already}
                      title={label}
                    >
                      {h.poster ? (
                        <Image src={h.poster} alt="" width={34} height={48} className={styles.hitPoster} unoptimized />
                      ) : (
                        <span className={styles.hitPosterEmpty} aria-hidden="true" />
                      )}
                      <span className={styles.hitText}>
                        <span className={styles.hitTitle}>{h.title}</span>
                        {h.secondary && <span className={styles.hitSecondary}>{h.secondary}</span>}
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
        </div>
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
