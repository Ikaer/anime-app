import React, { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import styles from './SeasonPicker.module.css';
import { listSeasonsDesc, sameSeason, seasonKey } from '@/lib/domain/animeUtils';
import { useT, type TranslationKey, type TFunction } from '@/lib/i18n';
import type { SeasonInfo } from '@/models/anime';

/**
 * The simple season control: ONE season, picked from a searchable dropdown
 * ordered newest-first, flanked by "previous"/"next" buttons that walk the
 * seasons around it. The multi-season chip list still exists as
 * `SeasonSelector`; `SeasonFilter` toggles between the two.
 *
 * It writes the same `SeasonInfo[]` the filter state has always carried — a
 * one-element array, or an empty one, which is what drops `sn` from the URL.
 * Only `value[0]` is ever shown, so switching over from a multi-season
 * selection keeps the first and says so rather than silently discarding it.
 *
 * ⚠️ The results panel is `position: fixed`, measured off the field, for the
 * reason spelled out in `MixAnchorsSection`: `AnimePageLayout`'s `.sidebar` is
 * `overflow-y: auto`, so an absolutely-positioned list is clipped to the
 * sidebar instead of overlaying the grid. Here it also matters vertically —
 * the list is ~270 rows, and in flow it would push the sidebar's own scroll.
 */
interface SeasonPickerProps {
  value: SeasonInfo[];
  onChange: (v: SeasonInfo[]) => void;
}

/**
 * Panel geometry, in viewport coordinates (it is `position: fixed`). Exactly
 * one of `top`/`bottom` is set — see the flip in `measure`.
 */
interface PanelPos {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
}

const PANEL_MIN_WIDTH = 200;
const VIEWPORT_MARGIN = 12;
const PANEL_GAP = 6;
/** Below this much room underneath, the panel opens upward instead. */
const PANEL_MIN_HEIGHT = 220;

/**
 * Year first (`2026 Automne`), unlike `formatSeason`'s prose form. The list is
 * ordered by year, so the varying part has to be the tail — with the season
 * word leading, the years no longer line up down the column.
 */
const seasonLabel = (s: SeasonInfo, t: TFunction) =>
  `${s.year} ${t(`seasonName.${s.season}` as TranslationKey)}`;

/** Accent- and case-insensitive, so "ete" finds "Été" and "aut" finds "Automne". */
const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const SeasonPicker: React.FC<SeasonPickerProps> = ({ value, onChange }) => {
  const t = useT();
  const seasons = useMemo(() => listSeasonsDesc(), []);
  const selected = value[0] ?? null;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<PanelPos | null>(null);

  const fieldRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  // Every whitespace-separated token must appear, in any order — the haystack
  // holds the localized name AND the English one (the stored vocabulary), so
  // "summer 2020" and "2020 ete" both land on the same row. A single-substring
  // match would fail both, since neither word order matches the haystack's.
  const terms = useMemo(
    () => normalize(query).split(/\s+/).filter(Boolean),
    [query],
  );
  const options = useMemo(() => {
    if (terms.length === 0) return seasons;
    return seasons.filter(s => {
      const hay = normalize(`${t(`seasonName.${s.season}` as TranslationKey)} ${s.year} ${s.season}`);
      return terms.every(term => hay.includes(term));
    });
  }, [seasons, terms, t]);

  /** Index of the current selection in the full list — also the prev/next cursor. */
  const selectedIdx = useMemo(
    () => (selected ? seasons.findIndex(s => sameSeason(s, selected)) : -1),
    [seasons, selected],
  );

  /**
   * Closing always drops the search term: the field falls back to showing the
   * selection, so a term left behind would silently pre-filter the next open.
   */
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const pick = useCallback((s: SeasonInfo) => {
    onChange([s]);
    close();
    inputRef.current?.blur();
  }, [onChange, close]);

  /**
   * One control, two steps — the conventional combobox behaviour: while a term
   * is being typed it clears the term (the panel stays up), otherwise it drops
   * the season, which is what removes `sn` from the URL.
   */
  const clear = useCallback(() => {
    if (query) { setQuery(''); inputRef.current?.focus(); return; }
    onChange([]);
    close();
  }, [onChange, close, query]);

  /**
   * Anchor the panel to the field and keep it on screen. It opens downward,
   * and flips above when there is not enough room below — the season filter
   * sits low in a long sidebar, where a downward panel is a 40px sliver.
   */
  const measure = useCallback(() => {
    const el = fieldRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, PANEL_MIN_WIDTH), window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = Math.max(VIEWPORT_MARGIN, Math.min(r.left, window.innerWidth - width - VIEWPORT_MARGIN));
    const below = window.innerHeight - r.bottom - PANEL_GAP - VIEWPORT_MARGIN;
    const above = r.top - PANEL_GAP - VIEWPORT_MARGIN;
    const flip = below < PANEL_MIN_HEIGHT && above > below;
    setPos({
      left,
      width,
      maxHeight: Math.max(120, flip ? above : below),
      ...(flip
        ? { bottom: window.innerHeight - r.top + PANEL_GAP }
        : { top: r.bottom + PANEL_GAP }),
    });
  }, []);

  // Capture phase: the sidebar is its own scrollport, and scroll events on a
  // nested scroller do not bubble.
  useEffect(() => {
    if (!open) { setPos(null); return; }
    measure();
    const onScroll = () => measure();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, measure]);

  // Click-outside closes: a fixed panel is not in the field's subtree, so
  // `onBlur` would fire before a row's click lands.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (fieldRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  useEffect(() => { if (open) activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [active, open]);

  const openPanel = () => {
    // Opening with no term lands on the current selection rather than on 2027.
    setActive(selectedIdx >= 0 ? selectedIdx : 0);
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter') {
      if (!open) { openPanel(); return; }
      if (options[active]) pick(options[active]);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) { openPanel(); return; }
      if (options.length === 0) return;
      e.preventDefault();
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    }
  };

  const canPrev = selectedIdx >= 0 && selectedIdx < seasons.length - 1;
  const canNext = selectedIdx > 0;

  return (
    <div className={styles.picker}>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.step}
          onClick={() => canPrev && pick(seasons[selectedIdx + 1])}
          disabled={!canPrev}
          title={t('season.prevSeason')}
          aria-label={t('season.prevSeason')}
        >
          ‹
        </button>

        <div className={styles.field} ref={fieldRef}>
          <input
            ref={inputRef}
            className={styles.input}
            // Closed, the field IS the selection; open, it is the search term.
            value={open ? query : (selected ? seasonLabel(selected, t) : '')}
            onChange={e => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
            onFocus={openPanel}
            // Tabbing away must close it — the click-outside listener only
            // covers the mouse. Guarded on `relatedTarget` so a click landing
            // on an option (which blurs the input first) is left to `pick`.
            onBlur={e => {
              const to = e.relatedTarget as Node | null;
              if (!to) return;
              if (fieldRef.current?.contains(to) || panelRef.current?.contains(to)) return;
              close();
            }}
            onKeyDown={onKeyDown}
            placeholder={t('season.pickPlaceholder')}
            aria-label={t('filters.season')}
            role="combobox"
            aria-expanded={open}
            aria-controls="season-picker-list"
            spellCheck={false}
          />
          {(selected || query) && (
            <button
              type="button"
              className={styles.clear}
              // `onMouseDown` rather than `onClick`: the input's blur fires
              // first and would close the panel out from under the button.
              onMouseDown={e => { e.preventDefault(); clear(); }}
              title={t('common.clear')}
              aria-label={t('common.clear')}
            >
              ×
            </button>
          )}
        </div>

        <button
          type="button"
          className={styles.step}
          onClick={() => canNext && pick(seasons[selectedIdx - 1])}
          disabled={!canNext}
          title={t('season.nextSeason')}
          aria-label={t('season.nextSeason')}
        >
          ›
        </button>
      </div>

      {value.length > 1 && (
        <p className={styles.note}>{t('season.simpleExtraIgnored', { count: value.length - 1 })}</p>
      )}

      {open && pos && (
        <div
          className={styles.panel}
          ref={panelRef}
          style={{ top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
        >
          {options.length === 0 ? (
            <p className={styles.panelNote}>{t('season.noMatch')}</p>
          ) : (
            <ul className={styles.options} role="listbox" id="season-picker-list">
              {options.map((s, i) => {
                const isSelected = selected != null && sameSeason(s, selected);
                return (
                  <li key={seasonKey(s)} ref={i === active ? activeRef : undefined}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`${styles.option} ${i === active ? styles.optionActive : ''} ${isSelected ? styles.optionSelected : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(s)}
                    >
                      {seasonLabel(s, t)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default SeasonPicker;
