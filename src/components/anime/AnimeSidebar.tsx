import React from 'react';
import styles from './AnimeSidebar.module.css';
import { UserAnimeStatus } from '@/models/anime';
import type { SeasonInfo } from '@/models/anime';
import { CollapsibleSection, DebouncedSearchInput } from '@/components/shared';
import { useT } from '@/lib/i18n';
import {
  ViewsSection,
  FiltersSection
} from './sidebar';

/**
 * The sidebar narrows *which* anime are shown — search, views, filters. The
 * controls that shape *how* the grid looks (sort, image size, cards per row)
 * live in `AnimeListHeader`, above the cards they affect.
 */
interface AnimeSidebarProps {
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

  // Sidebar UI state
  sidebarExpanded: Record<string, boolean>;
  onSidebarExpandedChange: (section: string, isExpanded: boolean) => void;
}

const AnimeSidebar: React.FC<AnimeSidebarProps> = ({
  statusFilters, onStatusFilterChange,
  searchQuery, onSearchChange,
  seasons, onSeasonsChange,
  mediaTypes, onMediaTypesChange,
  hiddenOnly, onHiddenOnlyChange,
  discrepanciesOnly, onDiscrepanciesOnlyChange,
  minScore, onMinScoreChange,
  maxScore, onMaxScoreChange,
  sidebarExpanded, onSidebarExpandedChange,
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
      </div>

      <CollapsibleSection
        title={t('section.views')}
        isExpanded={sidebarExpanded.views}
        onToggle={() => toggle('views')}
      >
        <ViewsSection />
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
    </div>
  );
};

export default AnimeSidebar;