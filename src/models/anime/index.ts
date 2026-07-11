/**
 * Anime-related interfaces and types
 * Based on MyAnimeList API structure
 */

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

// SIMKL personal data (read-only, one-way sync). Keyed by MAL id in animes_simkl.json.
export interface SimklPersonalEntry {
  simkl_id: number;          // kept for deletion reconciliation (diff on ids.simkl)
  mal_id: number;
  status: UserAnimeStatus;   // normalized to MAL vocabulary at write time
  score: number | null;      // SIMKL user rating, 1-10; null if unrated
  num_episodes_watched: number | null;
  total_episodes: number | null;
  watched_at?: string;       // SIMKL last_watched
  ids?: SourceIds;           // full cross-source id block from SIMKL's show.ids
}

/**
 * Cross-source id crosswalk. SIMKL's all-items response carries a rich `ids`
 * block (mal, anilist, anidb, kitsu, tmdb, imdb, tvdb…); we store it verbatim.
 * `mal` may arrive as a string from SIMKL. Kept deliberately open-ended.
 */
export interface SourceIds {
  simkl?: number;
  mal?: number | string;
  anilist?: number | string;
  anidb?: number | string;
  kitsu?: number | string;
  tmdb?: number | string;
  imdb?: string;
  [key: string]: number | string | undefined;
}

// A detected MAL vs SIMKL mismatch for one title. `null` fields = that dimension agrees.
export interface Discrepancy {
  status?: { mal: UserAnimeStatus | null; simkl: UserAnimeStatus };
  score?: { mal: number | null; simkl: number | null };
  progress?: { mal: number | null; simkl: number | null };
  presence?: 'simkl_only'; // soft: synced from SIMKL but absent from your MAL list
}

// AniList catalog metadata (read-only, public API). Keyed by MAL id in
// animes_anilist_meta.json. The interface name still says "Tag" for historical
// reasons; the entry has held staff and banner art for a while now.
export interface AniListTagEntry {
  name: string;
  rank: number;       // AniList relevance rank, 0-100
  category?: string;
}
// A staff credit from AniList (Director, Character Design, Music…). The `id` is
// a stable cross-anime AniList staff id — it's the key the reco source matches on.
export interface AniListStaffEntry {
  id: number;
  name: string;
  role: string;
}
export interface AniListMetaEntry {
  mal_id: number;
  anilist_id: number;
  tags: AniListTagEntry[];
  // Top-relevance staff credits. Optional so entries written before staff was
  // added stay valid; a missing `staff` field is the signal to backfill.
  staff?: AniListStaffEntry[];
  /**
   * AniList's landscape banner art — the one thing MAL has no equivalent of, and
   * what the detail page uses as its page backdrop. AniList genuinely has none for
   * many titles, so a fetched-but-absent banner is stored as `null`; `undefined`
   * means never fetched, and is the backfill signal (same pattern as `staff`).
   */
  banner_image?: string | null;
  fetched_at: string; // ISO timestamp of last successful fetch
}

// Combined data for display
export interface AnimeForDisplay extends MALAnime {
  hidden?: boolean;
  simkl?: SimklPersonalEntry;       // joined at display time by MAL id
  discrepancy?: Discrepancy | null; // computed at display / filter time
  anilistMeta?: AniListMetaEntry;   // joined at display time by MAL id
  /**
   * Unified cross-source id crosswalk, assembled at display time from every
   * pipe (MAL self-id + SIMKL's ids block + AniList's id). Materially
   * source-independent identity: the join KEY is still the MAL id today, but
   * the crosswalk carried here is what a future canonical/internal key would be
   * promoted from — no re-derivation needed. Non-load-bearing for now.
   */
  crosswalk?: SourceIds;
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

// Seasons (shared across API and UI)
export type SeasonName = 'winter' | 'spring' | 'summer' | 'fall';
export interface SeasonInfo { year: number; season: SeasonName }

// View types
export type AnimeLayoutType = 'table' | 'card';

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
  | 'anilistCrowd' // AniList crowd recommendations from the user's high-scored seeds
  | 'suggestions'  // MAL personal "suggestions" endpoint
  | 'feedback'     // taste-profile affinity on the user's 👍 "bonne pioche" set
  | 'genre'        // taste-profile affinity on genres (IDF-weighted)
  | 'studio'       // taste-profile affinity on studios (IDF-weighted)
  | 'nsfw'         // taste-profile affinity on the nsfw flag (IDF-weighted)
  | 'rating'       // taste-profile affinity on the age rating (IDF-weighted)
  | 'anilistTags'  // taste-profile affinity on AniList catalog tags (IDF-weighted)
  | 'anilistStaff' // taste-profile affinity on AniList staff/creators (IDF-weighted)
  | 'rejection'    // overlap with the "disliked" profile (dropped / low-scored / 👎)
  | 'popularity';  // MAL popularity — negative weight makes the feed nichier

/** Per-source weight configuration (the tunable knobs, all live in the URL). */
export type SourceWeights = Record<RecoSource, number>;

/** A user's explicit thumb on a recommendation: 👍 keep / 👎 not for me. */
export type RecoVerdict = 'up' | 'down';

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
  /** Total number of seeds (liked/list anime) whose crowd recos point at this candidate. */
  totalSeeds: number;
  fromSuggestions: boolean;
  /** Per-source decomposition of the score, for the on-demand explain. */
  breakdown: RecoContribution[];
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
    discrepancies: string | null;
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
