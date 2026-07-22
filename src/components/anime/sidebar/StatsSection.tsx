import React from 'react';
import styles from './StatsSection.module.css';
import { VisibleColumns, StatsColumn } from '@/models/anime';
import { useT } from '@/lib/i18n';

/**
 * `VisibleColumns` still carries the five MAL stat fields (the URL `cols` param
 * and `recommendations.tsx` both pass the full shape), but the card view — the
 * only list layout left since the table was removed — reads `score` alone. The
 * other four toggled nothing, so they are no longer offered here.
 */

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
        </div>
      </div>
    </div>
  );
};

export default StatsSection;
