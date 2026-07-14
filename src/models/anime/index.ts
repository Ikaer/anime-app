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
 * AniList personal-list data (read-only, anonymous public import by username —
 * docs/PROVIDER-FREE.md Phase 3 "P3b"). Keyed by MAL id in
 * animes_anilist_personal.json. It is the LOWEST personal-state fallback tier
 * (SIMKL > MAL > AniList) — see `getEffective*` in animeUtils.ts — so an
 * existing MAL/SIMKL user is unaffected, while an AniList-only user still gets
 * their state. Deliberately the locked 4-field shape (no `mal_id`): the store
 * keys the record by MAL id externally, so the entry itself stays source-pure.
 */
export interface AniListPersonalEntry {
  status?: UserAnimeStatus;  // normalized to MAL vocabulary at import time
  score?: number;            // 1-10 scale (AniList POINT_10); 0/undefined = unrated
  progress?: number;         // episodes watched
  anilist_id: number;        // AniList media id
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
  /**
   * Absent for an AniList-only title (no MAL id) — the crawler mints a bare
   * canonical id for those (see `performAnilistCatalogCrawl`) and this entry
   * carries only `catalog`/`anilist_id`. Presence of `mal_id` is what lets the
   * tags/staff enrichment sync (which IS MAL-id-keyed) find this entry.
   */
  mal_id?: number;
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
  /**
   * AniList's OWN catalog view of this title (docs/PROVIDER-FREE.md Phase 3),
   * populated by the season/popularity crawler in anilistSync.ts — distinct
   * from `tags`/`staff`/`banner_image`, which come from the per-MAL-id
   * enrichment sync. Optional as a whole: `undefined` means "never crawled",
   * the backfill signal (same pattern as `staff`/`banner_image`). Deliberately
   * a NARROW subset (title + mean only) — genres/studios carry incompatible
   * shapes from MAL's (`Genre[]`/`Studio[]` with ids) and are left MAL-only
   * until a real cross-source genre/studio identity exists.
   */
  catalog?: {
    title: string;
    /** AniList's romaji title, kept as the `alternative_titles`-less fallback secondary. */
    titleRomaji?: string;
    /** AniList's English title — mapped onto `alternative_titles.en` at hydration. */
    titleEnglish?: string;
    mean?: number; // AniList averageScore/10, on MAL's 1-10 scale
    /**
     * AniList genres (Phase 3 P3a). AniList exposes genres as NAMES only (no
     * id), so these carry a synthetic `id: 0` — safe because every genre
     * consumer keys off `name` (filters, the reco genre IDF profile). Merged
     * via catalog precedence in `toAnimeRecord`; MAL-first by default, so this
     * only wins for AniList-only titles or a future anilist-first flip.
     */
    genres?: Genre[];
    /**
     * AniList studios (Phase 3 P3a). Ids are AniList's namespace, NOT MAL's —
     * so a title present on BOTH keeps MAL studios under the default MAL-first
     * precedence. Caveat if precedence ever flips to anilist-first: the reco
     * studio IDF profile keys off studio `id`, so cross-source id mismatch
     * would fragment studio affinity. Not a problem today (MAL wins for
     * MAL-linked titles; AniList-only titles have no MAL studio profile anyway).
     */
    studios?: Studio[];
    // ── Wider catalog fields (added so an AniList-only title renders a full row
    // with no MAL record behind it). All optional and normalized to MAL's
    // vocabulary at crawl time (see anilistSync.ts): `mediaType` lowercase like
    // MAL's; `airingStatus` = finished_airing|currently_airing|not_yet_aired;
    // `startSeason.season` lowercase; `startDate` = "YYYY-MM-DD". ──
    coverImage?: { medium: string; large: string };
    synopsis?: string;
    mediaType?: string;
    airingStatus?: string;
    numEpisodes?: number;
    startDate?: string;
    startSeason?: { year: number; season: string };
    /** AniList `popularity` is a member count (not MAL's rank), so it maps onto `num_list_users`. */
    numListUsers?: number;
  };
  fetched_at: string; // ISO timestamp of last successful fetch
}

// ============================================================================
// AnimeRecord — the provider-neutral local record (docs/PROVIDER-FREE.md Phase 2,
// collapsed to the sole record shape in docs/PROVIDER-FREE-CUTOVER.md Phase E)
// ============================================================================
//
// NO `extends MALAnime`: every catalog/personal field is read via
// `.catalog.*` / `.personal.*` (hydrated across providers by `toAnimeRecord`
// in animeUtils.ts), never as a raw top-level MAL field. `.sources.mal` is the
// one place a reader that genuinely wants MAL's raw value (not the
// merged/effective one) can still reach it — see `AnimeSources`'s doc comment.

/**
 * Per-field catalog authority order (docs/PROVIDER-FREE-CUTOVER.md Phase C).
 * Reuses `ProvenanceSource` — any provider the hydration engine knows about can
 * appear in a precedence list, including `simkl` (a no-op catalog contributor
 * today, wired uniformly so a future SIMKL catalog field needs no type change).
 */
export type CatalogSource = ProvenanceSource;

/**
 * Catalog-authority fields. Currently sourced MAL-first (mirrors `MALAnime`
 * 1:1 today); the doc's plan is a per-field precedence list that can flip to
 * `['anilist','mal']` once an AniList catalog crawler exists (Phase 3) — this
 * type is what makes that flip a projection change, not a field rename at 150
 * call sites.
 *
 * Field names are deliberately camelCase, NOT a mirror of MAL's snake_case
 * (`MALAnime`). That is a conscious choice, not an oversight: this type
 * should read as source-neutral, and camelCase is the rest of this
 * codebase's convention outside raw MAL payloads. The cost is real — any
 * shared helper that takes both shapes needs a twin (see
 * `getCatalogPrimaryTitle` next to `getPrimaryTitle` in animeUtils.ts) — but
 * a snake_case mirror would read as "still secretly MAL", which is the exact
 * coupling this type exists to shed. Future consumer migrations should
 * expect one-off adapter functions like that, not a pure find-replace.
 */
export interface AnimeCatalog {
  title: string;
  alternativeTitles?: MALAnime['alternative_titles'];
  mainPicture?: MALAnime['main_picture'];
  pictures: Picture[];
  synopsis?: string;
  background?: string;
  startDate?: string;
  endDate?: string;
  mean?: number;
  rank?: number;
  popularity?: number;
  numListUsers?: number;
  numScoringUsers?: number;
  nsfw?: string;
  genres: Genre[];
  mediaType?: string;
  /** Airing status: 'finished_airing' | 'currently_airing' | 'not_yet_aired'. Named to not collide with `AnimePersonal.status`. */
  airingStatus?: string;
  numEpisodes?: number;
  startSeason?: MALAnime['start_season'];
  broadcast?: MALAnime['broadcast'];
  source?: string;
  averageEpisodeDuration?: number;
  rating?: string;
  relatedAnime: RelatedAnime[];
  studios: Studio[];
}

/**
 * Personal-state fields, already provider-neutral: SIMKL-first / MAL-fallback,
 * exactly the `getEffective*` precedence in animeUtils.ts. `undefined` score
 * means unrated (0 and null both collapse here, same as `getEffectiveScore`).
 */
export interface AnimePersonal {
  status?: UserAnimeStatus;
  score?: number;
  progress?: number;
}

/**
 * Raw, verbatim per-provider slices — nothing is lost in the catalog/personal
 * merge. Needed for reads that deliberately want ONE source's raw value, not
 * the effective/merged one (e.g. `computeDiscrepancy` compares raw MAL vs raw
 * SIMKL; the card's "MAL status" label is intentionally not flipped to
 * effective — see CLAUDE.md "Local cache authority").
 */
export interface AnimeSources {
  mal?: MALAnime;
  simkl?: SimklPersonalEntry;
  anilist?: AniListMetaEntry;
  anilistPersonal?: AniListPersonalEntry;
}

/** The providers the hydration engine can pull a field from. */
export type ProvenanceSource = 'mal' | 'anilist' | 'simkl';

/** Per-field origin of the hydrated `catalog` block: which provider's value won. */
export type CatalogProvenance = Partial<Record<keyof AnimeCatalog, ProvenanceSource>>;

/** Per-field origin of the hydrated `personal` block: which provider's value won. */
export type PersonalProvenance = Partial<Record<keyof AnimePersonal, ProvenanceSource>>;

/**
 * Per-field origin map produced by the hydration engine (docs/PROVIDER-FREE-CUTOVER.md
 * Phase C) alongside `catalog`/`personal`. A field absent from the map means no
 * source had a value for it (stayed `undefined`/default).
 */
export interface RecordProvenance {
  catalog: CatalogProvenance;
  personal: PersonalProvenance;
}

/**
 * The provider-neutral local record (docs/PROVIDER-FREE.md target model).
 * `id` is the SYNTHETIC canonical id minted by the Phase 1 registry — tied to
 * no provider. It is also the OUTWARD id (URLs, API route params, React keys,
 * hidden/feedback keys — docs/PROVIDER-FREE-CUTOVER.md Phase D). A provider's
 * own id, when genuinely needed (a MAL/AniList/SIMKL API call, an external
 * link), is reachable via `crosswalk.mal` / `sources.mal.id` etc.
 */
export interface AnimeRecord {
  id: string;
  crosswalk: SourceIds;
  catalog: AnimeCatalog;
  personal: AnimePersonal;
  sources: AnimeSources;
  provenance: RecordProvenance;
  hidden?: boolean;
  discrepancy?: Discrepancy | null;
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
  animes: AnimeRecord[];
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
