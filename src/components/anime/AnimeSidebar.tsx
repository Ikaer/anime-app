import React from 'react';
import styles from './AnimeSidebar.module.css';
import { StatusFilterValue } from '@/models/anime';
import type { SeasonInfo } from '@/models/anime';
import { CollapsibleSection, DebouncedSearchInput } from '@/components/shared';
import { useT } from '@/lib/i18n';
import {
  ViewsSection,
  FiltersSection,
  GenresSection,
  TagsSection
} from './sidebar';

/**
 * The sidebar narrows *which* anime are shown — search, views, filters. The
 * controls that shape *how* the grid looks (sort, image size, cards per row)
 * live in `AnimeListHeader`, above the cards they affect.
 */
interface AnimeSidebarProps {
  // Filters
  statusFilters: StatusFilterValue[];
  onStatusFilterChange: (status: StatusFilterValue, isChecked: boolean) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  seasons: SeasonInfo[];
  onSeasonsChange: (v: SeasonInfo[]) => void;
  mediaTypes: string[];
  onMediaTypesChange: (v: string[]) => void;
  nsfw: string[];
  onNsfwChange: (v: string[]) => void;
  genres: string[];
  onGenresChange: (v: string[]) => void;
  tags: string[];
  onTagsChange: (v: string[]) => void;
  hiddenOnly: boolean;
  onHiddenOnlyChange: (v: boolean) => void;
  discrepanciesOnly: boolean;
  onDiscrepanciesOnlyChange: (v: boolean) => void;
  favSeiyuuOnly: boolean;
  onFavSeiyuuOnlyChange: (v: boolean) => void;
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
  nsfw, onNsfwChange,
  genres, onGenresChange,
  tags, onTagsChange,
  hiddenOnly, onHiddenOnlyChange,
  discrepanciesOnly, onDiscrepanciesOnlyChange,
  favSeiyuuOnly, onFavSeiyuuOnlyChange,
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
          nsfw={nsfw}
          onNsfwChange={onNsfwChange}
          hiddenOnly={hiddenOnly}
          onHiddenOnlyChange={onHiddenOnlyChange}
          discrepanciesOnly={discrepanciesOnly}
          onDiscrepanciesOnlyChange={onDiscrepanciesOnlyChange}
          favSeiyuuOnly={favSeiyuuOnly}
          onFavSeiyuuOnlyChange={onFavSeiyuuOnlyChange}
          minScore={minScore}
          onMinScoreChange={onMinScoreChange}
          maxScore={maxScore}
          onMaxScoreChange={onMaxScoreChange}
        />
      </CollapsibleSection>

      {/* Its own section rather than a block inside Filters: it is the longest
          control in the sidebar (78 values across three axes) and collapsing it
          independently is what keeps the rest of the filters reachable. */}
      <CollapsibleSection
        title={t('section.genres')}
        isExpanded={sidebarExpanded.genres}
        onToggle={() => toggle('genres')}
      >
        <GenresSection genres={genres} onGenresChange={onGenresChange} />
      </CollapsibleSection>

      {/* AniList tags: ~400 values, so its own collapsible section too. */}
      <CollapsibleSection
        title={t('section.tags')}
        isExpanded={sidebarExpanded.tags}
        onToggle={() => toggle('tags')}
      >
        <TagsSection tags={tags} onTagsChange={onTagsChange} />
      </CollapsibleSection>
    </div>
  );
};

export default AnimeSidebar;