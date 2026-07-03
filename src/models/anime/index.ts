/**
 * Anime-related interfaces and types
 * Based on MyAnimeList API structure
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

// Combined data for display
export interface AnimeForDisplay extends MALAnime {
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

// ---------------------------------------------------------------------------
// Recommendations ("Pour toi") scoring model
// ---------------------------------------------------------------------------

/**
 * The individually-weighted signals that compose a recommendation's score.
 * Each contributes a normalized value in [0,1]; the final score is the
 * weighted sum `Σ weight · value`. `rejection` and `popularity` default to
 * negative weights (they push a candidate down).
 */
export type RecoSource =
  | 'crowd'        // MAL crowd recommendations from the user's high-scored seeds
  | 'suggestions'  // MAL personal "suggestions" endpoint
  | 'genre'        // taste-profile affinity on genres (IDF-weighted)
  | 'studio'       // taste-profile affinity on studios (IDF-weighted)
  | 'nsfw'         // taste-profile affinity on the nsfw flag (IDF-weighted)
  | 'rating'       // taste-profile affinity on the age rating (IDF-weighted)
  | 'rejection'    // overlap with the "disliked" profile (dropped / low-scored)
  | 'popularity';  // MAL popularity — negative weight makes the feed nichier

/** Per-source weight configuration (the tunable knobs, all live in the URL). */
export type SourceWeights = Record<RecoSource, number>;

/** One line of the on-demand "Pourquoi ?" breakdown for a recommendation. */
export interface RecoContribution {
  source: RecoSource;
  /** Normalized source score in [0,1]. */
  value: number;
  /** The weight applied to this source at ranking time. */
  weight: number;
  /** `weight · value` — the signed contribution to the final score. */
  contribution: number;
  /** Human-readable French detail (matched genres, top seeds, rating, …). */
  detail?: string;
}

// Recommendation match metadata attached to each card in the "Pour toi" feed.
export interface RecoMeta {
  affinityScore: number;
  topSeeds: { id: number; title: string; backers: number }[];
  fromSuggestions: boolean;
  /** Per-source decomposition of the score, for the on-demand explain. */
  breakdown: RecoContribution[];
}

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
    plan_to_watch: 'plan_to_watch',
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
  animes: AnimeForDisplay[];
  total: number;
  // Filters echoed back as strings as they appear in query for traceability
  filters: {
    search: string | null;
    season: string | null;
    mediaType: string | null;
    hidden: string | null;
    unrated: string | null;
    genres: string | null;
    status: string | null;
    minScore: string | null;
    maxScore: string | null;
  };
  sort: { column: SortColumn; direction: SortDirection };
  page: { limit: number | 'all'; offset: number; count: number };
  mode: 'full' | 'compact';
}
