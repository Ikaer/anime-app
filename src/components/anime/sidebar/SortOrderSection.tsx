import React from 'react';
import styles from './SortOrderSection.module.css';
import { SortColumn, SortDirection } from '@/models/anime';

const SORT_OPTIONS: Array<{ key: SortColumn; label: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'mean', label: 'Score' },
  { key: 'start_date', label: 'Start Date' },
  { key: 'status', label: 'Status' },
  { key: 'num_episodes', label: 'Episodes' },
  { key: 'rank', label: 'Rank' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'num_list_users', label: 'Users' },
  { key: 'num_scoring_users', label: 'Scorers' },
];

interface SortOrderSectionProps {
  sortBy: SortColumn;
  sortDir: SortDirection;
  onSortByChange: (column: SortColumn) => void;
  onSortDirChange: (direction: SortDirection) => void;
}

const SortOrderSection: React.FC<SortOrderSectionProps> = ({
  sortBy,
  sortDir,
  onSortByChange,
  onSortDirChange,
}) => {
  return (
    <div className={styles.sortOrderSection}>
      <label className={styles.label}>Sort by:</label>
      <select
        value={sortBy}
        onChange={(e) => onSortByChange(e.target.value as SortColumn)}
        className={styles.select}
      >
        {SORT_OPTIONS.map(opt => (
          <option key={opt.key} value={opt.key}>{opt.label}</option>
        ))}
      </select>
      <div className={styles.directionButtons}>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="sortDir"
            checked={sortDir === 'asc'}
            onChange={() => onSortDirChange('asc')}
          /> Asc
        </label>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="sortDir"
            checked={sortDir === 'desc'}
            onChange={() => onSortDirChange('desc')}
          /> Desc
        </label>
      </div>
    </div>
  );
};

export default SortOrderSection;
