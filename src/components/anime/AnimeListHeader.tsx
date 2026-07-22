import React from 'react';
import { SortColumn, SortDirection } from '@/models/anime';
import { useT } from '@/lib/i18n';
import { SortOrderSection, DisplaySection } from './sidebar';
import styles from './AnimeListHeader.module.css';

interface AnimeListHeaderProps {
  animeCount: number;
  sortBy: SortColumn;
  sortDir: SortDirection;
  onSortByChange: (c: SortColumn) => void;
  onSortDirChange: (d: SortDirection) => void;
  cardsPerRow: number | null;
  onCardsPerRowChange: (value: number | null) => void;
}

/**
 * The card grid's own header bar: result count on the left, the controls that
 * shape the grid itself (sort, image size, cards per row) on the right.
 *
 * These used to be three collapsible sections in `AnimeSidebar`, which left the
 * sidebar mixing two unrelated jobs — *which* anime to show (search, views,
 * filters) and *how* to lay them out. The layout controls belong next to what
 * they lay out, so the sidebar now only narrows the set.
 *
 * It renders `SortOrderSection`/`DisplaySection` unchanged rather than
 * reimplementing them inline — `DisplaySection` is still a sidebar section on
 * `/recommendations`, so there is one copy of each control, not two.
 */
const AnimeListHeader: React.FC<AnimeListHeaderProps> = ({
  animeCount,
  sortBy, sortDir, onSortByChange, onSortDirChange,
  cardsPerRow, onCardsPerRowChange,
}) => {
  const t = useT();

  return (
    <div className={styles.header}>
      <span className={styles.count}>{t('stats.totalAnime', { count: animeCount })}</span>

      <SortOrderSection
        variant="inline"
        sortBy={sortBy}
        sortDir={sortDir}
        onSortByChange={onSortByChange}
        onSortDirChange={onSortDirChange}
      />
      <span className={styles.divider} aria-hidden="true" />
      <DisplaySection
        variant="inline"
        cardsPerRow={cardsPerRow}
        onCardsPerRowChange={onCardsPerRowChange}
      />
    </div>
  );
};

export default AnimeListHeader;
