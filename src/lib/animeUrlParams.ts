/**
 * URL Parameter encoding/decoding for anime filters and display settings
 * 
 * All state is controlled via URL - this is the single source of truth.
 * Short param keys and values are used for compact, shareable URLs.
 */

import {
  UserAnimeStatus,
  SortColumn,
  SortDirection,
  ImageSize,
  VisibleColumns,
  SeasonName
} from '@/models/anime';
import { getSeasonInfos } from './animeUtils';

// ============================================================================
// Types
// ============================================================================

export interface SeasonInfo {
  year: number;
  season: SeasonName;
}

export interface AnimeFiltersState {
  statusFilters: (UserAnimeStatus | 'not_defined')[];
  searchQuery: string;
  seasons: SeasonInfo[];
  mediaTypes: string[];
  hiddenOnly: boolean;
  minScore: number | null;
  maxScore: number | null;
  sortBy: SortColumn;
  sortDir: SortDirection;
}

export interface AnimeDisplayState {
  imageSize: ImageSize;
  visibleColumns: VisibleColumns;
  sidebarExpanded: Record<string, boolean>;
  layout: 'table' | 'card';
}

export interface AnimeUrlState extends AnimeFiltersState, AnimeDisplayState { }

// ============================================================================
// Short Code Mappings
// ============================================================================

// Status codes: w=watching, c=completed, h=on_hold, d=dropped, p=plan_to_watch, n=not_defined
const STATUS_TO_CODE: Record<UserAnimeStatus | 'not_defined', string> = {
  watching: 'w',
  completed: 'c',
  on_hold: 'h',
  dropped: 'd',
  plan_to_watch: 'p',
  not_defined: 'n',
};
const CODE_TO_STATUS: Record<string, UserAnimeStatus | 'not_defined'> = {
  w: 'watching',
  c: 'completed',
  h: 'on_hold',
  d: 'dropped',
  p: 'plan_to_watch',
  n: 'not_defined',
};

// Season codes: w=winter, sp=spring, su=summer, f=fall
const SEASON_TO_CODE: Record<SeasonName, string> = {
  winter: 'w',
  spring: 'sp',
  summer: 'su',
  fall: 'f',
};
const CODE_TO_SEASON: Record<string, SeasonName> = {
  w: 'winter',
  sp: 'spring',
  su: 'summer',
  f: 'fall',
};

// Sort column codes
const SORT_TO_CODE: Record<SortColumn, string> = {
  title: 't',
  mean: 'm',
  start_date: 'sd',
  status: 'st',
  num_episodes: 'ep',
  rank: 'r',
  popularity: 'p',
  num_list_users: 'lu',
  num_scoring_users: 'su',
};

const CODE_TO_SORT: Record<string, SortColumn> = Object.fromEntries(
  Object.entries(SORT_TO_CODE).map(([k, v]) => [v, k as SortColumn])
);
const DIR_TO_CODE: Record<SortDirection, string> = { asc: 'a', desc: 'd' };
const CODE_TO_DIR: Record<string, SortDirection> = { a: 'asc', d: 'desc' };

// Visible columns codes
const COLUMN_TO_CODE: Record<keyof VisibleColumns, string> = {
  score: 'sc',
  rank: 'r',
  popularity: 'p',
  users: 'u',
  scorers: 'sr',
};
const CODE_TO_COLUMN: Record<string, keyof VisibleColumns> = Object.fromEntries(
  Object.entries(COLUMN_TO_CODE).map(([k, v]) => [v, k as keyof VisibleColumns])
);

// Sidebar section codes
const SIDEBAR_TO_CODE: Record<string, string> = {
  account: 'a',
  sync: 'sy',
  views: 'v',
  display: 'd',
  filters: 'f',
  sort: 'so',
  stats: 'st',
};
const CODE_TO_SIDEBAR: Record<string, string> = Object.fromEntries(
  Object.entries(SIDEBAR_TO_CODE).map(([k, v]) => [v, k])
);

// ============================================================================
// Default Values
// ============================================================================

const ALL_STATUSES: (UserAnimeStatus | 'not_defined')[] = [
  'watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch', 'not_defined'
];

const DEFAULT_VISIBLE_COLUMNS: VisibleColumns = {
  score: true,
  rank: false,
  popularity: false,
  users: false,
  scorers: false,
};

const DEFAULT_SIDEBAR_EXPANDED: Record<string, boolean> = {
  account: true,
  sync: true,
  views: true,
  display: true,
  filters: true,
  sort: true,
  stats: true,
};

export const DEFAULT_FILTERS: AnimeFiltersState = {
  statusFilters: ALL_STATUSES,
  searchQuery: '',
  seasons: [],
  mediaTypes: [],
  hiddenOnly: false,
  minScore: null,
  maxScore: null,
  sortBy: 'mean',
  sortDir: 'desc',
};

export const DEFAULT_DISPLAY: AnimeDisplayState = {
  imageSize: 3,
  visibleColumns: DEFAULT_VISIBLE_COLUMNS,
  sidebarExpanded: DEFAULT_SIDEBAR_EXPANDED,
  layout: 'card',
};

// ============================================================================
// Default Preset URL (new_season_strict)
// ============================================================================

export function getDefaultPresetUrl(): string {
  const seasonInfos = getSeasonInfos();
  const currentSeason = `${seasonInfos.current.year}${SEASON_TO_CODE[seasonInfos.current.season as SeasonName]}`;
  return `/?sn=${currentSeason}&mt=tv&so=m&d=d`;
}

// ============================================================================
// URL Parameter Keys
// ============================================================================

const PARAM_KEYS = {
  // Filters
  status: 's',
  search: 'q',
  seasons: 'sn',
  mediaType: 'mt',
  hidden: 'h',
  minScore: 'min',
  maxScore: 'max',
  sort: 'so',
  direction: 'd',
  // Display
  imageSize: 'img',
  columns: 'cols',
  sidebar: 'sb',
  layout: 'lt',
} as const;

// ============================================================================
// Encoding Functions
// ============================================================================

function encodeStatuses(statuses: (UserAnimeStatus | 'not_defined')[]): string | null {
  // If all statuses selected, omit from URL
  if (statuses.length === ALL_STATUSES.length &&
    ALL_STATUSES.every(s => statuses.includes(s))) {
    return null;
  }
  if (statuses.length === 0) return '';
  return statuses.map(s => STATUS_TO_CODE[s]).join(',');
}

function encodeSeasons(seasons: SeasonInfo[]): string | null {
  if (seasons.length === 0) return null;
  return seasons.map(s => `${s.year}${SEASON_TO_CODE[s.season]}`).join(',');
}

function encodeMediaTypes(types: string[]): string | null {
  if (types.length === 0) return null;
  return types.join(',');
}

function encodeVisibleColumns(cols: VisibleColumns): string | null {
  // Encode only visible columns; if all visible, omit
  const visibleCodes = Object.entries(cols)
    .filter(([, v]) => v)
    .map(([k]) => COLUMN_TO_CODE[k as keyof VisibleColumns]);

  if (visibleCodes.length === Object.keys(DEFAULT_VISIBLE_COLUMNS).length) {
    return null; // All visible = default
  }
  return visibleCodes.join(',');
}

function encodeSidebarExpanded(expanded: Record<string, boolean>): string | null {
  // Encode only expanded sections; if all expanded, omit
  const expandedCodes = Object.entries(expanded)
    .filter(([, v]) => v)
    .map(([k]) => SIDEBAR_TO_CODE[k] || k);

  if (expandedCodes.length === Object.keys(DEFAULT_SIDEBAR_EXPANDED).length) {
    return null; // All expanded = default
  }
  return expandedCodes.join(',');
}

export function encodeFiltersToParams(filters: Partial<AnimeFiltersState>): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.statusFilters !== undefined) {
    const encoded = encodeStatuses(filters.statusFilters);
    if (encoded !== null) params.set(PARAM_KEYS.status, encoded);
  }

  if (filters.searchQuery) {
    params.set(PARAM_KEYS.search, filters.searchQuery);
  }

  if (filters.seasons !== undefined) {
    const encoded = encodeSeasons(filters.seasons);
    if (encoded) params.set(PARAM_KEYS.seasons, encoded);
  }

  if (filters.mediaTypes !== undefined) {
    const encoded = encodeMediaTypes(filters.mediaTypes);
    if (encoded) params.set(PARAM_KEYS.mediaType, encoded);
  }

  if (filters.hiddenOnly) {
    params.set(PARAM_KEYS.hidden, '1');
  }

  if (filters.minScore !== null && filters.minScore !== undefined) {
    params.set(PARAM_KEYS.minScore, filters.minScore.toString());
  }

  if (filters.maxScore !== null && filters.maxScore !== undefined) {
    params.set(PARAM_KEYS.maxScore, filters.maxScore.toString());
  }

  if (filters.sortBy) {
    params.set(PARAM_KEYS.sort, SORT_TO_CODE[filters.sortBy]);
  }

  if (filters.sortDir) {
    params.set(PARAM_KEYS.direction, DIR_TO_CODE[filters.sortDir]);
  }

  return params;
}

export function encodeDisplayToParams(display: Partial<AnimeDisplayState>): URLSearchParams {
  const params = new URLSearchParams();

  if (display.imageSize !== undefined && display.imageSize !== DEFAULT_DISPLAY.imageSize) {
    params.set(PARAM_KEYS.imageSize, display.imageSize.toString());
  }

  if (display.visibleColumns !== undefined) {
    const encoded = encodeVisibleColumns(display.visibleColumns);
    if (encoded !== null) params.set(PARAM_KEYS.columns, encoded);
  }

  if (display.sidebarExpanded !== undefined) {
    const encoded = encodeSidebarExpanded(display.sidebarExpanded);
    if (encoded !== null) params.set(PARAM_KEYS.sidebar, encoded);
  }

  if (display.layout !== undefined && display.layout !== DEFAULT_DISPLAY.layout) {
    params.set(PARAM_KEYS.layout, display.layout);
  }

  return params;
}

export function encodeStateToUrl(state: Partial<AnimeUrlState>): string {
  const filterParams = encodeFiltersToParams(state);
  const displayParams = encodeDisplayToParams(state);

  // Merge params
  displayParams.forEach((value, key) => {
    filterParams.set(key, value);
  });

  const queryString = filterParams.toString()
    // Decode safe characters for readability
    .replace(/%2C/g, ',');

  return queryString ? `/?${queryString}` : '/';
}

// ============================================================================
// Decoding Functions
// ============================================================================

function decodeStatuses(value: string | null): (UserAnimeStatus | 'not_defined')[] {
  if (value === null) return ALL_STATUSES;
  if (value === '') return [];
  return value.split(',')
    .map(code => CODE_TO_STATUS[code])
    .filter((s): s is UserAnimeStatus | 'not_defined' => s !== undefined);
}

function decodeSeasons(value: string | null): SeasonInfo[] {
  if (!value) return [];
  const result: SeasonInfo[] = [];

  for (const token of value.split(',')) {
    // Parse format: YYYYx where x is w/sp/su/f
    const match = token.match(/^(\d{4})(w|sp|su|f)$/);
    if (match) {
      const year = parseInt(match[1], 10);
      const season = CODE_TO_SEASON[match[2]];
      if (season) {
        result.push({ year, season });
      }
    }
  }

  return result;
}

function decodeMediaTypes(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').filter(Boolean);
}

function decodeVisibleColumns(value: string | null): VisibleColumns {
  if (!value) return { ...DEFAULT_VISIBLE_COLUMNS };

  // Start with all false, then enable specified columns
  const result: VisibleColumns = {
    score: false,
    rank: false,
    popularity: false,
    users: false,
    scorers: false,
  };

  for (const code of value.split(',')) {
    const column = CODE_TO_COLUMN[code];
    if (column) {
      result[column] = true;
    }
  }

  return result;
}

function decodeSidebarExpanded(value: string | null): Record<string, boolean> {
  if (!value) return { ...DEFAULT_SIDEBAR_EXPANDED };

  // Start with all false, then enable specified sections
  const result: Record<string, boolean> = {
    account: false,
    sync: false,
    views: false,
    display: false,
    filters: false,
    sort: false,
    stats: false,
  };

  for (const code of value.split(',')) {
    const section = CODE_TO_SIDEBAR[code];
    if (section) {
      result[section] = true;
    }
  }

  return result;
}

export function decodeUrlToFilters(params: URLSearchParams): AnimeFiltersState {
  return {
    statusFilters: decodeStatuses(params.get(PARAM_KEYS.status)),
    searchQuery: params.get(PARAM_KEYS.search) || '',
    seasons: decodeSeasons(params.get(PARAM_KEYS.seasons)),
    mediaTypes: decodeMediaTypes(params.get(PARAM_KEYS.mediaType)),
    hiddenOnly: params.get(PARAM_KEYS.hidden) === '1',
    minScore: params.has(PARAM_KEYS.minScore) ? parseFloat(params.get(PARAM_KEYS.minScore)!) : null,
    maxScore: params.has(PARAM_KEYS.maxScore) ? parseFloat(params.get(PARAM_KEYS.maxScore)!) : null,
    sortBy: CODE_TO_SORT[params.get(PARAM_KEYS.sort) || ''] || DEFAULT_FILTERS.sortBy,
    sortDir: CODE_TO_DIR[params.get(PARAM_KEYS.direction) || ''] || DEFAULT_FILTERS.sortDir,
  };
}

export function decodeUrlToDisplay(params: URLSearchParams): AnimeDisplayState {
  const imgSize = params.get(PARAM_KEYS.imageSize);

  return {
    imageSize: imgSize ? (parseInt(imgSize, 10) as ImageSize) : DEFAULT_DISPLAY.imageSize,
    visibleColumns: params.has(PARAM_KEYS.columns)
      ? decodeVisibleColumns(params.get(PARAM_KEYS.columns))
      : { ...DEFAULT_VISIBLE_COLUMNS },
    sidebarExpanded: params.has(PARAM_KEYS.sidebar)
      ? decodeSidebarExpanded(params.get(PARAM_KEYS.sidebar))
      : { ...DEFAULT_SIDEBAR_EXPANDED },
    layout: (params.get(PARAM_KEYS.layout) as any) || DEFAULT_DISPLAY.layout,
  };
}

export function decodeUrlToState(params: URLSearchParams): AnimeUrlState {
  return {
    ...decodeUrlToFilters(params),
    ...decodeUrlToDisplay(params),
  };
}

// ============================================================================
// URL State Detection
// ============================================================================

export function hasAnyParams(params: URLSearchParams): boolean {
  // Check if URL has any of our recognized params
  const allKeys = Object.values(PARAM_KEYS);
  for (const key of allKeys) {
    if (params.has(key)) return true;
  }
  return false;
}

// ============================================================================
// Preset URL Generation
// ============================================================================

export interface PresetConfig {
  key: string;
  label: string;
  description: string;
  getState: () => Partial<AnimeUrlState>;
}

export const PERSISTENT_UI_KEYS: (keyof AnimeUrlState)[] = [
  'imageSize',
  'minScore',
  'maxScore',
  'visibleColumns',
  'sidebarExpanded'
];

export const VIEW_PRESETS: PresetConfig[] = [
  {
    key: 'new_season_strict',
    label: 'New Season (Strict)',
    description: 'Current season only',
    getState: () => {
      const { current } = getSeasonInfos();
      return {
        seasons: [{ year: current.year, season: current.season as SeasonName }],
        mediaTypes: ['tv'],
        sortBy: 'mean',
        sortDir: 'desc',
      };
    },
  },
  {
    key: 'new_season',
    label: 'New Season',
    description: 'Current & previous season',
    getState: () => {
      const { current, previous } = getSeasonInfos();
      return {
        seasons: [
          { year: current.year, season: current.season as SeasonName },
          { year: previous.year, season: previous.season as SeasonName }
        ],
        mediaTypes: ['tv'],
        sortBy: 'mean',
        sortDir: 'desc',
      };
    },
  },
  {
    key: 'next_season',
    label: 'Next Season',
    description: 'Upcoming season',
    getState: () => {
      const { next } = getSeasonInfos();
      return {
        seasons: [{ year: next.year, season: next.season as SeasonName }],
        mediaTypes: ['tv'],
        sortBy: 'mean',
        sortDir: 'desc',
      };
    },
  },
  {
    key: 'find_shows',
    label: 'Find Shows',
    description: 'TV shows not in your list',
    getState: () => ({
      statusFilters: ['not_defined'],
      mediaTypes: ['tv'],
      sortBy: 'mean',
      sortDir: 'desc',
    }),
  },
  {
    key: 'watching',
    label: 'Watching',
    description: 'Currently watching',
    getState: () => ({
      statusFilters: ['watching'],
      sortBy: 'title',
      sortDir: 'asc',
    }),
  },
  {
    key: 'completed',
    label: 'Completed',
    description: 'Completed shows',
    getState: () => ({
      statusFilters: ['completed'],
      sortBy: 'title',
      sortDir: 'asc',
    }),
  },
  {
    key: 'on_hold',
    label: 'On Hold',
    description: 'Shows on hold',
    getState: () => ({
      statusFilters: ['on_hold'],
      sortBy: 'title',
      sortDir: 'asc',
    }),
  },
  {
    key: 'dropped',
    label: 'Dropped',
    description: 'Dropped shows',
    getState: () => ({
      statusFilters: ['dropped'],
      sortBy: 'title',
      sortDir: 'asc',
    }),
  },
  {
    key: 'plan_to_watch',
    label: 'Plan to Watch',
    description: 'Planned shows',
    getState: () => ({
      statusFilters: ['plan_to_watch'],
      sortBy: 'title',
      sortDir: 'asc',
    }),
  },
  {
    key: 'hidden',
    label: 'Hidden',
    description: 'Hidden shows only',
    getState: () => ({
      hiddenOnly: true,
      sortBy: 'title',
      sortDir: 'asc',
    }),
  },
];
