/**
 * URL Parameter encoding/decoding for anime FILTERS.
 *
 * Filter state is controlled via the URL — this is the single source of truth,
 * and every key here is absolute: an absent `mt` means *no media-type filter*,
 * never "whatever the user prefers". Short param keys and values are used for
 * compact, shareable URLs.
 *
 * Display settings (cards per row, sidebar sections) used to live here too, as
 * the `cpr` and `sb` keys. They are gone: those are preferences, not view state,
 * and they now come from [viewDefaults.ts](./viewDefaults.ts) via `settings.json`.
 * An old `?cpr=6` bookmark simply ignores the param.
 *
 * What the defaults DO shape here is the landing state — `getDefaultViewUrl`,
 * the URL an empty `/` redirects to, and the `applyPreset` baseline.
 */

import {
  UserAnimeStatus,
  SortColumn,
  SortDirection,
  SeasonName,
  SeasonInfo
} from '@/models/anime';
import { getSeasonInfos } from '@/lib/domain/animeUtils';
import { SHIPPED_VIEW_DEFAULTS, ViewDefaults, ViewFilterDefaults } from '@/lib/url/viewDefaults';

// ============================================================================
// Types
// ============================================================================

export interface AnimeFiltersState {
  statusFilters: (UserAnimeStatus | 'not_defined')[];
  searchQuery: string;
  seasons: SeasonInfo[];
  mediaTypes: string[];
  /**
   * Genre NAMES to match, OR'd together (a title matches if it carries any).
   * Names rather than ids because genres are name-keyed everywhere in this app —
   * AniList supplies no real ids (synthetic `0`) and `unionGenres` dedupes on
   * the name, so the name IS the identity. Carries all three axes; the split
   * into genre/theme/demographic is presentation, see `domain/genreAxis.ts`.
   */
  genres: string[];
  hiddenOnly: boolean;
  discrepanciesOnly: boolean;
  unratedOnly: boolean;
  minScore: number | null;
  maxScore: number | null;
  sortBy: SortColumn;
  sortDir: SortDirection;
}

/**
 * Display state, sourced from the user's view defaults rather than the URL.
 * Kept as a named type because pages still receive it as one block.
 */
export interface AnimeDisplayState {
  sidebarExpanded: Record<string, boolean>;
  /** Forced cards per row; null = adaptive (auto-fill). */
  cardsPerRow: number | null;
}

/** Only filters live in the URL now — the alias is kept for the many call sites. */
export type AnimeUrlState = AnimeFiltersState;

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

// ============================================================================
// Default Values
// ============================================================================

const ALL_STATUSES: (UserAnimeStatus | 'not_defined')[] = [
  'watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch', 'not_defined'
];

/**
 * The media-type vocabulary, shared by the sidebar filter and the view-defaults
 * editor on `/settings` so the two cannot offer different sets. Values are MAL's
 * own `media_type` strings, which is what the API filters on.
 */
export const MEDIA_TYPES = ['tv', 'movie', 'ona', 'ova', 'special', 'music'] as const;

export const DEFAULT_FILTERS: AnimeFiltersState = {
  statusFilters: ALL_STATUSES,
  searchQuery: '',
  seasons: [],
  mediaTypes: [],
  genres: [],
  hiddenOnly: false,
  discrepanciesOnly: false,
  unratedOnly: false,
  minScore: null,
  maxScore: null,
  sortBy: 'mean',
  sortDir: 'desc',
};

/** The shipped display block, for SSR and the first render before defaults load. */
export const DEFAULT_DISPLAY: AnimeDisplayState = {
  sidebarExpanded: SHIPPED_VIEW_DEFAULTS.sidebarExpanded,
  cardsPerRow: SHIPPED_VIEW_DEFAULTS.cardsPerRow,
};

// ============================================================================
// Landing state
// ============================================================================

/**
 * Apply the user's sparse filter defaults ON TOP of a preset's own state.
 *
 * On top rather than underneath because four of the eleven presets pin
 * `mediaTypes` themselves — underneath, a media-type default would be shadowed
 * exactly where it is most wanted. Sparse, so a key the user never set leaves
 * every preset's own choice intact.
 */
export function withFilterDefaults(
  state: Partial<AnimeUrlState>,
  filters: ViewFilterDefaults
): Partial<AnimeUrlState> {
  const out = { ...state };
  if (filters.mediaTypes !== undefined) out.mediaTypes = filters.mediaTypes;
  if (filters.minScore !== undefined) out.minScore = filters.minScore;
  if (filters.maxScore !== undefined) out.maxScore = filters.maxScore;
  return out;
}

/**
 * The URL an empty `/` redirects to: the user's chosen landing preset with their
 * filter defaults layered over it. An unknown stored preset key falls back to
 * the shipped one rather than landing on an empty view.
 */
export function getDefaultViewUrl(defaults: ViewDefaults = SHIPPED_VIEW_DEFAULTS): string {
  const preset =
    VIEW_PRESETS.find(p => p.key === defaults.preset) ??
    VIEW_PRESETS.find(p => p.key === SHIPPED_VIEW_DEFAULTS.preset) ??
    VIEW_PRESETS[0];

  return encodeStateToUrl({
    ...DEFAULT_FILTERS,
    ...withFilterDefaults(preset.getState(), defaults.filters),
  });
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
  genres: 'g',
  hidden: 'h',
  discrepancies: 'disc',
  unrated: 'ur',
  minScore: 'min',
  maxScore: 'max',
  sort: 'so',
  direction: 'd',
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

/**
 * Genre names, comma-joined. Unlike statuses/seasons/sorts there is no short
 * code table: the vocabulary is ~78 open-ended values that grow whenever a
 * provider adds one, so a code map would be a second place to keep in sync for
 * a URL nobody hand-writes. Commas inside a name would break the join, and none
 * exist — `encodeStateToUrl` un-escapes `%2C` for readability, so a genre
 * containing one would be ambiguous on decode; worth knowing if a provider ever
 * ships one.
 */
function encodeGenres(genres: string[]): string | null {
  if (genres.length === 0) return null;
  return genres.join(',');
}

function encodeFiltersToParams(filters: Partial<AnimeFiltersState>): URLSearchParams {
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

  if (filters.genres !== undefined) {
    const encoded = encodeGenres(filters.genres);
    if (encoded) params.set(PARAM_KEYS.genres, encoded);
  }

  if (filters.hiddenOnly) {
    params.set(PARAM_KEYS.hidden, '1');
  }

  if (filters.discrepanciesOnly) {
    params.set(PARAM_KEYS.discrepancies, '1');
  }

  if (filters.unratedOnly) {
    params.set(PARAM_KEYS.unrated, '1');
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

export function encodeStateToUrl(state: Partial<AnimeUrlState>): string {
  const queryString = encodeFiltersToParams(state)
    .toString()
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

function decodeGenres(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map(g => g.trim()).filter(Boolean);
}

function decodeUrlToFilters(params: URLSearchParams): AnimeFiltersState {
  return {
    statusFilters: decodeStatuses(params.get(PARAM_KEYS.status)),
    searchQuery: params.get(PARAM_KEYS.search) || '',
    seasons: decodeSeasons(params.get(PARAM_KEYS.seasons)),
    mediaTypes: decodeMediaTypes(params.get(PARAM_KEYS.mediaType)),
    genres: decodeGenres(params.get(PARAM_KEYS.genres)),
    hiddenOnly: params.get(PARAM_KEYS.hidden) === '1',
    discrepanciesOnly: params.get(PARAM_KEYS.discrepancies) === '1',
    unratedOnly: params.get(PARAM_KEYS.unrated) === '1',
    minScore: params.has(PARAM_KEYS.minScore) ? parseFloat(params.get(PARAM_KEYS.minScore)!) : null,
    maxScore: params.has(PARAM_KEYS.maxScore) ? parseFloat(params.get(PARAM_KEYS.maxScore)!) : null,
    sortBy: CODE_TO_SORT[params.get(PARAM_KEYS.sort) || ''] || DEFAULT_FILTERS.sortBy,
    sortDir: CODE_TO_DIR[params.get(PARAM_KEYS.direction) || ''] || DEFAULT_FILTERS.sortDir,
  };
}

export function decodeUrlToState(params: URLSearchParams): AnimeUrlState {
  return decodeUrlToFilters(params);
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

/**
 * Filter keys a preset switch preserves rather than resetting. `sidebarExpanded`
 * and `cardsPerRow` were here until they stopped being URL state — they are now
 * defaults, which survive a preset switch by construction.
 */
export const PERSISTENT_UI_KEYS: (keyof AnimeUrlState)[] = [
  'minScore',
  'maxScore',
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
    key: 'to_rate',
    label: 'To Rate',
    description: 'Completed shows you haven\'t scored yet',
    getState: () => ({
      statusFilters: ['completed'],
      unratedOnly: true,
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
