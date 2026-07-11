import React from 'react';
import styles from './AnimeSidebar.module.css';
import { UserAnimeStatus, ImageSize, VisibleColumns, StatsColumn, SortColumn, SortDirection, AnimeLayoutType } from '@/models/anime';
import type { SeasonInfo } from '@/models/anime';
import { Button, CollapsibleSection, DebouncedSearchInput } from '@/components/shared';
import { useT } from '@/lib/i18n';
import {
  SortOrderSection,
  ViewsSection,
  DisplaySection,
  FiltersSection,
  StatsSection
} from './sidebar';

interface AnimeSidebarProps {
  // Display
  imageSize: ImageSize;
  onImageSizeChange: (size: ImageSize) => void;
  cardsPerRow: number | null;
  onCardsPerRowChange: (value: number | null) => void;

  // Filters
  statusFilters: (UserAnimeStatus | 'not_defined')[];
  onStatusFilterChange: (status: UserAnimeStatus | 'not_defined', isChecked: boolean) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  seasons: SeasonInfo[];
  onSeasonsChange: (v: SeasonInfo[]) => void;
  mediaTypes: string[];
  onMediaTypesChange: (v: string[]) => void;
  hiddenOnly: boolean;
  onHiddenOnlyChange: (v: boolean) => void;
  discrepanciesOnly: boolean;
  onDiscrepanciesOnlyChange: (v: boolean) => void;
  minScore: number | null;
  onMinScoreChange: (v: number | null) => void;
  maxScore: number | null;
  onMaxScoreChange: (v: number | null) => void;

  // Stats
  animeCount: number;
  visibleColumns: VisibleColumns;
  onVisibleColumnsChange: (column: StatsColumn, isVisible: boolean) => void;

  // Sidebar UI state
  sidebarExpanded: Record<string, boolean>;
  onSidebarExpandedChange: (section: string, isExpanded: boolean) => void;

  // Sort
  sortBy: SortColumn;
  sortDir: SortDirection;
  onSortByChange: (c: SortColumn) => void;
  onSortDirChange: (d: SortDirection) => void;

  // Layout
  layout: AnimeLayoutType;
  onLayoutChange: (l: AnimeLayoutType) => void;
}

const AnimeSidebar: React.FC<AnimeSidebarProps> = ({
  imageSize, onImageSizeChange,
  cardsPerRow, onCardsPerRowChange,
  statusFilters, onStatusFilterChange,
  searchQuery, onSearchChange,
  seasons, onSeasonsChange,
  mediaTypes, onMediaTypesChange,
  hiddenOnly, onHiddenOnlyChange,
  discrepanciesOnly, onDiscrepanciesOnlyChange,
  minScore, onMinScoreChange,
  maxScore, onMaxScoreChange,
  animeCount,
  visibleColumns, onVisibleColumnsChange,
  sidebarExpanded, onSidebarExpandedChange,
  sortBy, sortDir, onSortByChange, onSortDirChange,
  layout, onLayoutChange,
}) => {
  const t = useT();
  // Section toggle now uses URL state
  const toggle = (key: string) => {
    onSidebarExpandedChange(key, !sidebarExpanded[key]);
  };

  return (
    <div className={styles.sidebar}>
      <div className={styles.topRow}>
        <DebouncedSearchInput
          placeholder={t('filters.searchPlaceholder')}
          value={searchQuery}
          onChange={onSearchChange}
          className={styles.searchInput}
        />
        <div className={styles.layoutSelector}>
          <Button
            className={`${styles.layoutBtn}`}
            onClick={() => onLayoutChange('table')}
            title={t('display.tableView')}
            variant={layout === 'table' ? 'primary' : 'secondary'}
          >
            {t('layout.table')}
          </Button>
          <Button
            className={`${styles.layoutBtn}`}
            onClick={() => onLayoutChange('card')}
            title={t('display.cardView')}
            variant={layout === 'card' ? 'primary' : 'secondary'}
          >
            {t('layout.card')}
          </Button>
        </div>
      </div>

      <CollapsibleSection
        title={t('section.views')}
        isExpanded={sidebarExpanded.views}
        onToggle={() => toggle('views')}
      >
        <ViewsSection />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('section.display')}
        isExpanded={sidebarExpanded.display}
        onToggle={() => toggle('display')}
      >
        <DisplaySection
          imageSize={imageSize}
          onImageSizeChange={onImageSizeChange}
          cardsPerRow={cardsPerRow}
          onCardsPerRowChange={onCardsPerRowChange}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('section.filters')}
        isExpanded={sidebarExpanded.filters}
        onToggle={() => toggle('filters')}
      >
        <FiltersSection
          statusFilters={statusFilters}
          onStatusFilterChange={onStatusFilterChange}
          seasons={seasons}
          onSeasonsChange={onSeasonsChange}
          mediaTypes={mediaTypes}
          onMediaTypesChange={onMediaTypesChange}
          hiddenOnly={hiddenOnly}
          onHiddenOnlyChange={onHiddenOnlyChange}
          discrepanciesOnly={discrepanciesOnly}
          onDiscrepanciesOnlyChange={onDiscrepanciesOnlyChange}
          minScore={minScore}
          onMinScoreChange={onMinScoreChange}
          maxScore={maxScore}
          onMaxScoreChange={onMaxScoreChange}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('section.sortOrder')}
        isExpanded={sidebarExpanded.sort}
        onToggle={() => toggle('sort')}
      >
        <SortOrderSection
          sortBy={sortBy}
          sortDir={sortDir}
          onSortByChange={onSortByChange}
          onSortDirChange={onSortDirChange}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('section.stats')}
        isExpanded={sidebarExpanded.stats}
        onToggle={() => toggle('stats')}
      >
        <StatsSection
          animeCount={animeCount}
          visibleColumns={visibleColumns}
          onVisibleColumnsChange={onVisibleColumnsChange}
        />
      </CollapsibleSection>
    </div>
  );
};

export default AnimeSidebar;