import React from 'react';
import styles from './SortOrderSection.module.css';
import { SortColumn, SortDirection } from '@/models/anime';
import { useT, type TranslationKey } from '@/lib/i18n';

const SORT_OPTIONS: Array<{ key: SortColumn; labelKey: TranslationKey }> = [
  { key: 'title', labelKey: 'field.title' },
  { key: 'mean', labelKey: 'field.score' },
  { key: 'start_date', labelKey: 'field.startDate' },
  { key: 'status', labelKey: 'field.status' },
  { key: 'num_episodes', labelKey: 'field.episodes' },
  { key: 'rank', labelKey: 'field.rank' },
  { key: 'popularity', labelKey: 'field.popularity' },
  { key: 'num_list_users', labelKey: 'field.users' },
  { key: 'num_scoring_users', labelKey: 'field.scorers' },
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
  const t = useT();
  return (
    <div className={styles.sortOrderSection}>
      <label className={styles.label}>{t('sort.sortBy')}</label>
      <select
        value={sortBy}
        onChange={(e) => onSortByChange(e.target.value as SortColumn)}
        className={styles.select}
      >
        {SORT_OPTIONS.map(opt => (
          <option key={opt.key} value={opt.key}>{t(opt.labelKey)}</option>
        ))}
      </select>
      <div className={styles.directionButtons}>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="sortDir"
            checked={sortDir === 'asc'}
            onChange={() => onSortDirChange('asc')}
          /> {t('sort.asc')}
        </label>
        <label className={styles.radioLabel}>
          <input
            type="radio"
            name="sortDir"
            checked={sortDir === 'desc'}
            onChange={() => onSortDirChange('desc')}
          /> {t('sort.desc')}
        </label>
      </div>
    </div>
  );
};

export default SortOrderSection;
