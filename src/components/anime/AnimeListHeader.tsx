import React from 'react';
import { SortColumn, SortDirection } from '@/models/anime';
import { SortOrderSection, DisplaySection } from './sidebar';
import styles from './AnimeListHeader.module.css';

/** The sort group, or `undefined` on a list whose order isn't the user's to pick. */
export interface HeaderSortControls {
  sortBy: SortColumn;
  sortDir: SortDirection;
  onSortByChange: (c: SortColumn) => void;
  onSortDirChange: (d: SortDirection) => void;
}

/** The cards-per-row group, or `undefined` on a page that isn't a card grid. */
export interface HeaderDisplayControls {
  cardsPerRow: number | null;
  onCardsPerRowChange: (value: number | null) => void;
}

interface AnimeListHeaderProps {
  /** Page heading. `/` has none; `/recommendations` names the feed or review list. */
  title?: React.ReactNode;
  /** The result count — or whatever replaces it (`/recommendations` swaps in a back button). */
  count?: React.ReactNode;
  sort?: HeaderSortControls;
  display?: HeaderDisplayControls;
  /** Page-specific controls, appended after the shared groups. */
  children?: React.ReactNode;
}

/**
 * The bar above a card grid — the one header both `/` and `/recommendations`
 * render, so the two pages look like the same app rather than two takes on it.
 *
 * It exists because the sidebar used to mix two jobs: *which* anime to show
 * (search, views, filters — still the sidebar's) and *how* to lay them out
 * (this). Layout controls belong next to what they lay out.
 *
 * Everything a page legitimately differs on is a slot: `/` has no `title` and
 * passes `sort`; `/recommendations` has a title, no sort (its order IS the
 * affinity ranking, so offering one would contradict the page) and appends its
 * "show all explains" toggle as a child; `/tier` has no `display` (its rows are
 * wrapped thumbnails, not a card grid, so cards-per-row means nothing there)
 * and passes its axis/versus/thumbnail groups as children. The shell — panel,
 * typography, spacing, divider — is not negotiable, which is the whole point.
 *
 * It renders `SortOrderSection`/`DisplaySection` with `variant="inline"` rather
 * than reimplementing them, so the controls stay identical to their stacked
 * sidebar form elsewhere.
 *
 * **Layout is one flat wrapping flex row**, not title/count plus a nested
 * control block: nested, a narrow viewport drops the whole block onto its own
 * line instead of breaking between the groups. `.spacer` is what right-aligns
 * the controls, and it simply absorbs the slack when a row does wrap.
 *
 * Dividers are placed *between* whichever groups a page actually filled, rather
 * than hardcoded after `sort` — with two optional groups, a fixed divider is
 * either orphaned or missing depending on the combination.
 */
const AnimeListHeader: React.FC<AnimeListHeaderProps> = ({
  title,
  count,
  sort,
  display,
  children,
}) => {
  const groups = [
    sort && (
      <SortOrderSection
        variant="inline"
        sortBy={sort.sortBy}
        sortDir={sort.sortDir}
        onSortByChange={sort.onSortByChange}
        onSortDirChange={sort.onSortDirChange}
      />
    ),
    display && (
      <DisplaySection
        variant="inline"
        cardsPerRow={display.cardsPerRow}
        onCardsPerRowChange={display.onCardsPerRowChange}
      />
    ),
    children,
  ].filter(Boolean);

  return (
    <div className={styles.header}>
      {title && <h1 className={styles.title}>{title}</h1>}
      {count && <span className={styles.count}>{count}</span>}

      <span className={styles.spacer} aria-hidden="true" />

      {groups.map((group, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className={styles.divider} aria-hidden="true" />}
          {group}
        </React.Fragment>
      ))}
    </div>
  );
};

export default AnimeListHeader;
