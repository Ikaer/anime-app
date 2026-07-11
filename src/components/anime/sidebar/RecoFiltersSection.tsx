import React, { useState, useEffect, useRef } from 'react';
import styles from './RecoFiltersSection.module.css';
import { useT } from '@/lib/i18n';

/**
 * Narrowing filters that make sense on the ranked recommendations feed:
 * search, media type, MAL `mean` score range and release-year range.
 * Deliberately omits status, season and hidden — those are governed by the
 * feed's hard filters / ranking.
 */
interface RecoFiltersSectionProps {
  search: string;
  onSearchChange: (v: string) => void;
  mediaTypes: string[];
  onMediaTypesChange: (v: string[]) => void;
  minScore: number | null;
  onMinScoreChange: (v: number | null) => void;
  maxScore: number | null;
  onMaxScoreChange: (v: number | null) => void;
  minYear: number | null;
  maxYear: number | null;
  /** Both bounds committed together (single URL update — avoids clobbering). */
  onYearChange: (min: number | null, max: number | null) => void;
}

const MEDIA_TYPES = ['tv', 'movie', 'ona', 'ova', 'special', 'music'];

// Year-slider bounds: 1960 (historical-crawl floor) to next year (upcoming).
const MIN_YEAR = 1960;
const MAX_YEAR = new Date().getFullYear() + 1;

/**
 * Dual-handle release-year range slider. A value pinned to a bound means "no
 * bound" (emits null), so the URL stays clean. Commits on release (pointer up /
 * key up), not per tick, to avoid flooding the router with history entries —
 * same pattern as the weight sliders.
 */
const YearRange: React.FC<{
  minYear: number | null;
  maxYear: number | null;
  onYearChange: (min: number | null, max: number | null) => void;
}> = ({ minYear, maxYear, onYearChange }) => {
  const t = useT();
  const lo = minYear ?? MIN_YEAR;
  const hi = maxYear ?? MAX_YEAR;
  const [draft, setDraft] = useState<[number, number]>([lo, hi]);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Re-sync when the URL (props) changes from outside this component.
  useEffect(() => { setDraft([lo, hi]); }, [lo, hi]);

  const [dMin, dMax] = draft;
  const pct = (y: number) => ((y - MIN_YEAR) / (MAX_YEAR - MIN_YEAR)) * 100;

  // Commit both bounds in one call. The lower bound is emitted verbatim (the
  // 2000 default vs. the 1960 floor are distinct, so 1960 must stay explicit —
  // the URL layer omits it when it equals the default). The upper bound at its
  // extreme still means "no bound".
  const commit = () => {
    const [mn, mx] = draftRef.current;
    onYearChange(mn, mx >= MAX_YEAR ? null : mx);
  };

  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label}>
        {t('reco.year')} <span className={styles.yearValue}>{dMin} – {dMax}</span>
      </label>
      <div className={styles.yearSlider}>
        <div className={styles.yearTrack} />
        <div
          className={styles.yearFill}
          style={{ left: `${pct(dMin)}%`, right: `${100 - pct(dMax)}%` }}
        />
        <input
          type="range" min={MIN_YEAR} max={MAX_YEAR} value={dMin}
          onChange={(e) => setDraft(([, mx]) => [Math.min(parseInt(e.target.value, 10), mx), mx])}
          onPointerUp={commit} onKeyUp={commit}
          className={`${styles.yearInput} ${styles.yearInputMin}`}
          aria-label={t('reco.yearMin')}
        />
        <input
          type="range" min={MIN_YEAR} max={MAX_YEAR} value={dMax}
          onChange={(e) => setDraft(([mn]) => [mn, Math.max(parseInt(e.target.value, 10), mn)])}
          onPointerUp={commit} onKeyUp={commit}
          className={`${styles.yearInput} ${styles.yearInputMax}`}
          aria-label={t('reco.yearMax')}
        />
      </div>
    </div>
  );
};

const RecoFiltersSection: React.FC<RecoFiltersSectionProps> = ({
  search,
  onSearchChange,
  mediaTypes,
  onMediaTypesChange,
  minScore,
  onMinScoreChange,
  maxScore,
  onMaxScoreChange,
  minYear,
  maxYear,
  onYearChange,
}) => {
  const t = useT();
  return (
    <div className={styles.filtersSection}>
      <input
        type="text"
        placeholder={t('reco.searchPlaceholder')}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className={styles.searchInput}
      />

      <div className={styles.filterGroup}>
        <label className={styles.label}>{t('reco.type')}</label>
        {MEDIA_TYPES.map(mt => (
          <label key={mt} className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={mediaTypes.includes(mt)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...mediaTypes, mt]
                  : mediaTypes.filter(x => x !== mt);
                onMediaTypesChange(next);
              }}
            /> {mt.toUpperCase()}
          </label>
        ))}
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.label}>{t('reco.malMean')}</label>
        <div className={styles.scoreRangeInputs}>
          <input
            type="number"
            placeholder={t('common.min')}
            min="0"
            max="10"
            step="0.1"
            value={minScore ?? ''}
            onChange={(e) => onMinScoreChange(e.target.value ? parseFloat(e.target.value) : null)}
            className={styles.scoreInput}
          />
          <span className={styles.rangeSeparator}>-</span>
          <input
            type="number"
            placeholder={t('common.max')}
            min="0"
            max="10"
            step="0.1"
            value={maxScore ?? ''}
            onChange={(e) => onMaxScoreChange(e.target.value ? parseFloat(e.target.value) : null)}
            className={styles.scoreInput}
          />
        </div>
      </div>

      <YearRange
        minYear={minYear}
        maxYear={maxYear}
        onYearChange={onYearChange}
      />
    </div>
  );
};

export default RecoFiltersSection;
