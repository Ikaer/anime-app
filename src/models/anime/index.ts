/**
 * Anime-related interfaces and types
 * Based on MyAnimeList API structure and user extensions
 */

import { LiteralSubset } from "../shared";

// Base MAL anime data (from API)
export interface MALAnime {
  id: number;
  title: string;
  main_picture?: {
    medium: string;
    large: string;
  };
  alternative_titles?: {
    synonyms: string[];
    en: string;
    ja: string;
  };
  start_date?: string;
  end_date?: string;
  synopsis?: string;
  mean?: number; // MAL score rating
  rank?: number;
  popularity?: number;
  num_list_users?: number;
  num_scoring_users?: number;
  nsfw?: string;
  genres: Genre[];
  created_at?: string;
  updated_at?: string;
  media_type?: string;
  status?: string; // 'finished_airing' | 'currently_airing' | 'not_yet_aired'
  my_list_status?: {
    status: string; // 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch'
    score: number;
    num_episodes_watched: number;
    is_rewatching: boolean;
    updated_at: string;
  };
  num_episodes?: number;
  start_season?: {
    year: number;
    season: string; // 'winter' | 'spring' | 'summer' | 'fall'
  };
  broadcast?: {
    day_of_the_week: string;
    start_time: string;
  };
  source?: string;
  average_episode_duration?: number;
  rating?: string;
  pictures: Picture[];
  background?: string;
  related_anime: RelatedAnime[];
  studios: Studio[];
}

export interface Genre {
  id: number;
  name: string;
}

export interface Picture {
  medium: string;
  large: string;
}

export interface RelatedAnime {
  node: {
    id: number;
    title: string;
    main_picture?: {
      medium: string;
      large: string;
    };
  };
  relation_type: string;
  relation_type_formatted: string;
}

export type UserAnimeStatus = 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch';

export interface Studio {
  id: number;
  name: string;
}

// User extension data
export interface AnimeProvider {
  name: string;
  url: string;
}

export interface AnimeExtension {
  providers: AnimeProvider[];
  notes: string;
}

// Combined data for display
export interface AnimeWithExtensions extends MALAnime {
  extensions?: AnimeExtension;
  hidden?: boolean;
}

// MAL Authentication
export interface MALAuthData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  created_at: number; // timestamp
}

export interface MALUser {
  id: number;
  name: string;
  picture?: string;
}

export interface MALAuthState {
  isAuthenticated: boolean;
  user?: MALUser;
  token?: MALAuthData;
}

// API Response types
export interface AnimeSeasonResponse {
  data: Array<{
    node: MALAnime;
  }>;
  paging?: {
    next?: string;
    previous?: string;
  };
}

// Sync metadata
export interface SyncMetadata {
  lastSyncDate: string;
  currentSeason: {
    year: number;
    season: string;
  };
  previousSeason: {
    year: number;
    season: string;
  };
  totalAnimeCount: number;
}

// Filter and sort options
export type SortColumn = 'title' | 'mean' | 'start_date' | 'status' | 'num_episodes' | 'rank' | 'popularity' | 'num_list_users' | 'num_scoring_users';
export type SortDirection = 'asc' | 'desc';

// Seasons & media types (shared across API and UI)
export type SeasonName = 'winter' | 'spring' | 'summer' | 'fall';
export interface SeasonInfo { year: number; season: SeasonName }
export type MediaType = 'tv' | 'movie' | 'ona' | 'ova' | 'special' | 'music';

// View types
export type AnimeLayoutType = 'table' | 'card';
export type AnimeView = 'new_season' | 'new_season_strict' | 'next_season' | 'find_shows' | 'watching' | 'completed' | 'hidden' | 'dropped' | 'on_hold' | 'plan_to_watch';

export type CalendarAnimeView = LiteralSubset<AnimeView, 'new_season' | 'new_season_strict' | 'next_season'>;

export class AnimeViewHelper {
  private _exhausterAll: { [key in AnimeView]: AnimeView } = {
    new_season_strict: 'new_season_strict',
    new_season: 'new_season',
    next_season: 'next_season',
    find_shows: 'find_shows',
    watching: 'watching',
    completed: 'completed',
    hidden: 'hidden',
    dropped: 'dropped',
    on_hold: 'on_hold',
    plan_to_watch: 'plan_to_watch'
  }
  private _exhausterCalendar: { [key in CalendarAnimeView]: CalendarAnimeView } = {
    new_season_strict: 'new_season_strict',
    new_season: 'new_season',
    next_season: 'next_season',
  }

  public readonly keys: AnimeView[] = Object.keys(this._exhausterAll) as AnimeView[];

  public readonly calendarViews: CalendarAnimeView[] = Object.keys(this._exhausterCalendar) as CalendarAnimeView[];

  public isValid(view: string): view is AnimeView {
    return view in this._exhausterAll;
  }
}
export const animeViewsHelper = new AnimeViewHelper();


export interface AnimeFilters {
  search?: string;
  genres?: string[];
  status?: (UserAnimeStatus | 'not_defined')[];
  minScore?: number;
  maxScore?: number;
  season?: SeasonInfo[];
  mediaType?: MediaType[];
  hidden?: boolean;
}

export interface AnimeSortOptions {
  column: SortColumn;
  direction: SortDirection;
}

// Display options
export type ImageSize = 0 | 1 | 2 | 3;

// Stats columns that can be shown/hidden
export type StatsColumn =
  | 'score'
  | 'rank'
  | 'popularity'
  | 'users'
  | 'scorers';

export interface VisibleColumns {
  score: boolean;
  rank: boolean;
  popularity: boolean;
  users: boolean;
  scorers: boolean;
}

export interface AnimeDisplayState {
  imageSize: ImageSize;
  visibleColumns: VisibleColumns;
  sidebarExpanded: Record<string, boolean>;
  layout: AnimeLayoutType;
}

// User preferences for persistent state
export interface AnimeUserPreferences {
  // Legacy: currentView now deprecated (fire-and-forget presets)
  currentView?: AnimeView;

  // Sort preferences
  sortBy: SortColumn;
  sortDir: SortDirection;

  // Filter preferences
  statusFilters: (UserAnimeStatus | 'not_defined')[];
  searchQuery: string;
  seasons: Array<{ year: number; season: 'winter' | 'spring' | 'summer' | 'fall' }>;
  mediaTypes: string[];
  hiddenOnly: boolean;
  minScore: number | null;
  maxScore: number | null;

  // Display preferences
  imageSize: ImageSize; // 1x, 2x, or 3x
  visibleColumns: VisibleColumns; // Stats columns visibility
  layout: AnimeLayoutType;

  // UI state (optional - sidebar collapse is localStorage only)
  sidebarExpanded?: Record<string, boolean>;

  lastUpdated: string;
}

// API response model for anime list endpoint
export interface AnimeListResponse {
  animes: AnimeWithExtensions[];
  total: number;
  // Filters echoed back as strings as they appear in query for traceability
  filters: {
    search: string | null;
    season: string | null;
    mediaType: string | null;
    hidden: string | null;
    genres: string | null;
    status: string | null;
    minScore: string | null;
    maxScore: string | null;
  };
  sort: { column: SortColumn; direction: SortDirection };
  page: { limit: number | 'all'; offset: number; count: number };
  mode: 'full' | 'compact';
}
