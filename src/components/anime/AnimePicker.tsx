import React, { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Image from 'next/image';
import type { AnimeSearchHit } from '@/lib/domain/globalSearch';
import { useT } from '@/lib/i18n';
import styles from './AnimePicker.module.css';

/**
 * A search field that resolves to one anime — the app's single "pick a title"
 * control.
 *
 * Extracted from `MixAnchorsSection` when the « boîtes » landing cards and the
 * group blade needed the same thing. Adding a title deliberately (rather than
 * accepting whatever a ranker proposed) is a wanted feature on all three
 * surfaces, and the geometry notes below are the kind of hard-won detail that
 * silently rots when it exists in three copies.
 *
 * Search reuses `/api/anime/search` (the header's endpoint, capped at 8 anime
 * hits) rather than a new one; already-picked titles stay visible in the results
 * but are marked and inert, which reads better than silently vanishing.
 *
 * ⚠️ **The results panel is `position: fixed`, measured off the input**, and that
 * is not decoration. Constrained to the 280px sidebar its rows truncated to
 * `KonoSuba: God's Blessing on This…` — six identical-looking rows for six
 * different seasons, which makes the control unusable for exactly the franchise
 * case it exists to serve. It cannot escape a scroll container in flow either:
 * `AnimePageLayout`'s `.sidebar` sets `overflow-y: auto`, which turns the other
 * axis into a scrollport too, so an absolutely-positioned panel is clipped just
 * the same. Fixed positioning is the one option that overlays the main content;
 * the cost is measuring on open, scroll and resize — and the scroll listener
 * must be in CAPTURE phase, because scroll events on a nested scroller do not
 * bubble.
 */
export interface AnimePickerProps {
  /** Ids already chosen — shown marked and inert rather than filtered out. */
  picked: Set<string>;
  onPick: (hit: AnimeSearchHit) => void;
  placeholder?: string;
  /** Read-only mode, e.g. an anchor set at its cap. */
  disabled?: boolean;
  /** Rendered inside the field when disabled — usually "why". */
  disabledPlaceholder?: string;
  /** Keeps the field mounted but starts closed; the box cards reveal it with a `+`. */
  autoFocus?: boolean;
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
const MIN_TERM = 2;

const AnimePicker: React.FC<AnimePickerProps> = ({
  picked, onPick, placeholder, disabled, disabledPlaceholder, autoFocus,
}) => {
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
  const inputRef = useRef<HTMLInputElement>(null);

  const term = q.trim();
  const showPanel = open && term.length >= MIN_TERM;

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  useEffect(() => {
    if (term.length < MIN_TERM) { setHits([]); setLoading(false); return; }
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

  /** Anchor the panel under the input, widened past its container and kept on screen. */
  const measure = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, PANEL_MIN_WIDTH), PANEL_MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(r.left, window.innerWidth - width - VIEWPORT_MARGIN));
    const top = r.bottom + 6;
    setPos({ top, left, width, maxHeight: Math.max(200, window.innerHeight - top - VIEWPORT_MARGIN) });
  }, []);

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

  // Keep the keyboard-selected row visible — the list is scrollable.
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [active]);

  const pick = useCallback((hit: AnimeSearchHit) => {
    if (picked.has(hit.id)) return;
    onPick(hit);
    setQ('');
    setHits([]);
    setOpen(false);
  }, [onPick, picked]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'Enter') { if (hits[active]) pick(hits[active]); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (hits.length === 0) return;
      e.preventDefault();
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
    }
  };

  return (
    <>
      <div className={styles.field} ref={fieldRef}>
        <span className={styles.icon} aria-hidden="true">⌕</span>
        <input
          ref={inputRef}
          className={styles.input}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={disabled ? (disabledPlaceholder ?? '') : (placeholder ?? t('mix.searchPlaceholder'))}
          aria-label={placeholder ?? t('mix.searchPlaceholder')}
          disabled={disabled}
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
                // franchise entries, "Ajouter" answers a question nobody was
                // asking. The season is what the row must disambiguate.
                const label = already ? `${h.title} — ${t('mix.alreadyPicked')}` : h.title;
                return (
                  <li key={h.id} ref={i === active ? activeRef : undefined}>
                    <button
                      type="button"
                      className={`${styles.hit} ${i === active ? styles.hitActive : ''} ${already ? styles.hitPicked : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(h)}
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
    </>
  );
};

export default AnimePicker;
