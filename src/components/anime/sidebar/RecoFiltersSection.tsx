import React from 'react';
import styles from './RecoFiltersSection.module.css';

/**
 * Narrowing filters that make sense on the ranked recommendations feed:
 * search, media type and MAL `mean` score range. Deliberately omits status,
 * season and hidden — those are governed by the feed's hard filters / ranking.
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
}

const MEDIA_TYPES = ['tv', 'movie', 'ona', 'ova', 'special', 'music'];

const RecoFiltersSection: React.FC<RecoFiltersSectionProps> = ({
  search,
  onSearchChange,
  mediaTypes,
  onMediaTypesChange,
  minScore,
  onMinScoreChange,
  maxScore,
  onMaxScoreChange,
}) => {
  return (
    <div className={styles.filtersSection}>
      <input
        type="text"
        placeholder="Rechercher..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className={styles.searchInput}
      />

      <div className={styles.filterGroup}>
        <label className={styles.label}>Type:</label>
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
        <label className={styles.label}>Note MAL (mean):</label>
        <div className={styles.scoreRangeInputs}>
          <input
            type="number"
            placeholder="Min"
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
            placeholder="Max"
            min="0"
            max="10"
            step="0.1"
            value={maxScore ?? ''}
            onChange={(e) => onMaxScoreChange(e.target.value ? parseFloat(e.target.value) : null)}
            className={styles.scoreInput}
          />
        </div>
      </div>
    </div>
  );
};

export default RecoFiltersSection;
