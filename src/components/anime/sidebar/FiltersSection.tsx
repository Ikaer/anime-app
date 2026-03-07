import React from 'react';
import styles from './FiltersSection.module.css';
import { UserAnimeStatus } from '@/models/anime';
import SeasonSelector, { SeasonInfo } from '../SeasonSelector';

const ALL_STATUSES: (UserAnimeStatus | 'not_defined')[] = [
  "watching", 
  "completed", 
  "on_hold", 
  "dropped", 
  "plan_to_watch", 
  "not_defined"
];

interface FiltersSectionProps {
  statusFilters: (UserAnimeStatus | 'not_defined')[];
  onStatusFilterChange: (status: UserAnimeStatus | 'not_defined', isChecked: boolean) => void;
  seasons: SeasonInfo[];
  onSeasonsChange: (seasons: SeasonInfo[]) => void;
  mediaTypes: string[];
  onMediaTypesChange: (mediaTypes: string[]) => void;
  hiddenOnly: boolean;
  onHiddenOnlyChange: (hiddenOnly: boolean) => void;
  minScore: number | null;
  onMinScoreChange: (score: number | null) => void;
  maxScore: number | null;
  onMaxScoreChange: (score: number | null) => void;
}

const FiltersSection: React.FC<FiltersSectionProps> = ({
  statusFilters,
  onStatusFilterChange,
  seasons,
  onSeasonsChange,
  mediaTypes,
  onMediaTypesChange,
  hiddenOnly,
  onHiddenOnlyChange,
  minScore,
  onMinScoreChange,
  maxScore,
  onMaxScoreChange,
}) => {
  return (
    <div className={styles.filtersSection}>
      <div className={styles.filterGroup}>
        {ALL_STATUSES.map((status) => (
          <label key={status} className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={statusFilters.includes(status)}
              onChange={(e) => onStatusFilterChange(status, e.target.checked)}
            />
            {status === 'not_defined' ? 'No Status' : status.replace(/_/g, ' ')}
          </label>
        ))}
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.label}>Season:</label>
        <SeasonSelector value={seasons} onChange={onSeasonsChange} />
      </div>

      <div className={styles.filterGroup}>
        <label className={styles.label}>Media Type:</label>
        {['tv', 'movie', 'ona', 'ova', 'special', 'music'].map(mt => (
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

      <div className={styles.filterGroup}>
        <label className={styles.checkboxLabel}>
          <input 
            type="checkbox" 
            checked={hiddenOnly} 
            onChange={(e) => onHiddenOnlyChange(e.target.checked)} 
          /> Hidden only
        </label>
      </div>

      <div className={styles.fieldGroup}>
        <label className={styles.label}>Score Range:</label>
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

export default FiltersSection;
