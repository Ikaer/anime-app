import React from 'react';
import styles from './StatsSection.module.css';
import { VisibleColumns, StatsColumn } from '@/models/anime';
import { useT } from '@/lib/i18n';

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
  const t = useT();
  return (
    <div className={styles.statsSection}>
      <span className={styles.animeCount}>{t('stats.totalAnime', { count: animeCount })}</span>

      <div className={styles.columnsVisibility}>
        <label className={styles.columnsLabel}>{t('stats.visibleColumns')}</label>
        <div className={styles.columnCheckboxes}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.score ?? true}
              onChange={(e) => onVisibleColumnsChange('score', e.target.checked)}
            />
            {t('field.score')}
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.rank ?? true}
              onChange={(e) => onVisibleColumnsChange('rank', e.target.checked)}
            />
            {t('field.rank')}
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.popularity ?? true}
              onChange={(e) => onVisibleColumnsChange('popularity', e.target.checked)}
            />
            {t('field.popularity')}
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.users ?? true}
              onChange={(e) => onVisibleColumnsChange('users', e.target.checked)}
            />
            {t('field.users')}
          </label>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={visibleColumns?.scorers ?? true}
              onChange={(e) => onVisibleColumnsChange('scorers', e.target.checked)}
            />
            {t('field.scorers')}
          </label>
        </div>
      </div>
    </div>
  );
};

export default StatsSection;
