import React from 'react';
import styles from './StatsSection.module.css';
import { VisibleColumns, StatsColumn } from '@/models/anime';

interface StatsSectionProps {
  animeCount: number;
  visibleColumns: VisibleColumns;
  onVisibleColumnsChange: (column: StatsColumn, isVisible: boolean) => void;
}

const StatsSection: React.FC<StatsSectionProps> = ({
  animeCount,
  visibleColumns,
  onVisibleColumnsChange,
}) => {
  return (
    <div className={styles.statsSection}>
      <span className={styles.animeCount}>Total Anime: {animeCount}</span>

      <div className={styles.columnsVisibility}>
        <label className={styles.columnsLabel}>Visible Columns:</label>
        <div className={styles.columnCheckboxes}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.score ?? true}
              onChange={(e) => onVisibleColumnsChange('score', e.target.checked)}
            />
            Score
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.rank ?? true}
              onChange={(e) => onVisibleColumnsChange('rank', e.target.checked)}
            />
            Rank
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.popularity ?? true}
              onChange={(e) => onVisibleColumnsChange('popularity', e.target.checked)}
            />
            Popularity
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.users ?? true}
              onChange={(e) => onVisibleColumnsChange('users', e.target.checked)}
            />
            Users
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.scorers ?? true}
              onChange={(e) => onVisibleColumnsChange('scorers', e.target.checked)}
            />
            Scorers
          </label>
        </div>
      </div>
    </div>
  );
};

export default StatsSection;
