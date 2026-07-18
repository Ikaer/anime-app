import type {
  AnimeRecord, AnimeCatalog, AnimePersonal, CatalogSource,
  ProvenanceSource, SeasonName, SeasonInfo, MALAnime, SimklPersonalEntry, AniListMetaEntry, AniListPersonalEntry,
  LocalPersonalEntry, SourceIds, Discrepancy,
} from '@/models/anime';
import type { TFunction, TranslationKey } from '@/lib/i18n';

// ============================================================================
// Display titles (English-first)
// ============================================================================

type TitleFields = Pick<AnimeRecord, 'catalog'>;
type CatalogTitleFields = { title: string; alternativeTitles?: { en: string } };

/** Primary display title: the English title when present, else the original (romaji) title. */
export function getPrimaryTitle(a: TitleFields): string {
  return getCatalogPrimaryTitle(a.catalog);
}

/** Secondary title: the original (romaji) title, returned only when it differs from the primary. */
export function getSecondaryTitle(a: TitleFields): string | undefined {
  const primary = getPrimaryTitle(a);
  return a.catalog.title && a.catalog.title !== primary ? a.catalog.title : undefined;
}

/** `getPrimaryTitle` for `AnimeRecord.catalog` (camelCase field names). */
export function getCatalogPrimaryTitle(c: CatalogTitleFields): string {
  return c.alternativeTitles?.en || c.title;
}

// ============================================================================
// Narrowing filters (shared by /api/anime/animes and /api/anime/recommendations)
// ============================================================================

export interface NarrowingFilters {
  mediaTypes?: string[];
  search?: string;
  minScore?: number | null;
  maxScore?: number | null;
  minYear?: number | null;
  maxYear?: number | null;
  /** MAL genre names (not AniList tags) — AND semantics: every listed genre must be present. */
  genres?: string[];
}

/** Release year, preferring the season year, falling back to the start date. */
function animeYear(a: AnimeRecord): number | undefined {
  if (a.catalog.startSeason?.year) return a.catalog.startSeason.year;
  if (a.catalog.startDate && a.catalog.startDate.length >= 4) {
    const y = parseInt(a.catalog.startDate.slice(0, 4), 10);
    return Number.isFinite(y) ? y : undefined;
  }
  return undefined;
}

/**
 * Apply the "narrowing" filter dimensions that make sense on any anime list —
 * including the ranked recommendations feed. Deliberately excludes status,
 * season, hidden and sort (those are page-specific). `minScore`/`maxScore`
 * filter MAL's `mean` (not the personal score), matching CLAUDE.md.
 * Generic over the item type so extra fields (e.g. `recoMeta`) survive.
 */
export function applyNarrowingFilters<T extends AnimeRecord>(
  items: T[],
  f: NarrowingFilters
): T[] {
  let out = items;

  if (f.mediaTypes && f.mediaTypes.length > 0) {
    const wanted = f.mediaTypes.map(t => t.toLowerCase());
    out = out.filter(a => wanted.includes((a.catalog.mediaType || '').toLowerCase()));
  }

  if (f.search && f.search.trim()) {
    const term = f.search.toLowerCase();
    out = out.filter(a =>
      (a.catalog.title || '').toLowerCase().includes(term) ||
      (a.catalog.alternativeTitles?.en || '').toLowerCase().includes(term)
    );
  }

  if (f.minScore != null && Number.isFinite(f.minScore)) {
    out = out.filter(a => !!a.catalog.mean && a.catalog.mean >= f.minScore!);
  }

  if (f.maxScore != null && Number.isFinite(f.maxScore)) {
    out = out.filter(a => !!a.catalog.mean && a.catalog.mean <= f.maxScore!);
  }

  if (f.minYear != null && Number.isFinite(f.minYear)) {
    out = out.filter(a => { const y = animeYear(a); return y != null && y >= f.minYear!; });
  }

  if (f.maxYear != null && Number.isFinite(f.maxYear)) {
    out = out.filter(a => { const y = animeYear(a); return y != null && y <= f.maxYear!; });
  }

  if (f.genres && f.genres.length > 0) {
    const wanted = f.genres;
    out = out.filter(a => {
      const names = new Set((a.catalog.genres || []).map(g => g.name));
      return wanted.every(g => names.has(g));
    });
  }

  return out;
}

// Utility function to format season display with nice labels and colors

export const formatSeason = (year: number, season: string, t?: TFunction) => {
  const seasonMap: Record<string, { label: string; color: string }> = {
    'spring': { label: 'Spring', color: '#10B981' }, // Green
    'summer': { label: 'Summer', color: '#F59E0B' }, // Orange
    'fall': { label: 'Fall', color: '#EF4444' },     // Red
    'winter': { label: 'Winter', color: '#3B82F6' }  // Blue
  };

  const seasonInfo = seasonMap[season] || { label: season, color: '#6B7280' };
  // When a translator is supplied (client components), localize the season word;
  // server callers (no `t`) keep the English label.
  const seasonWord = t && seasonMap[season] ? t(`seasonName.${season}` as TranslationKey) : seasonInfo.label;
  return {
    label: `${seasonWord} ${year}`,
    color: seasonInfo.color
  };
}


export type SeasonInfos = { current: SeasonInfo; previous: SeasonInfo; next: SeasonInfo };

/**
 * The current season plus its neighbours, derived from today's date. This is
 * the single implementation of the season arithmetic — everything that needs a
 * "which season are we in" answer calls it.
 */
export function getSeasonInfos(): SeasonInfos {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();

  // Determine current season
  const month = currentDate.getMonth(); // 0-11
  let currentSeason: SeasonName;
  if (month >= 0 && month <= 2) currentSeason = 'winter';
  else if (month >= 3 && month <= 5) currentSeason = 'spring';
  else if (month >= 6 && month <= 8) currentSeason = 'summer';
  else currentSeason = 'fall';

  // Determine previous season
  let prevYear = currentYear;
  let prevSeason: SeasonName;
  if (currentSeason === 'winter') { prevSeason = 'fall'; prevYear--; }
  else if (currentSeason === 'spring') prevSeason = 'winter';
  else if (currentSeason === 'summer') prevSeason = 'spring';
  else prevSeason = 'summer';

  // Determine next season
  let nextYear = currentYear;
  let nextSeason: SeasonName;
  if (currentSeason === 'winter') nextSeason = 'spring';
  else if (currentSeason === 'spring') nextSeason = 'summer';
  else if (currentSeason === 'summer') nextSeason = 'fall';
  else { nextSeason = 'winter'; nextYear++; }

  return {
    current: { year: currentYear, season: currentSeason },
    previous: { year: prevYear, season: prevSeason },
    next: { year: nextYear, season: nextSeason },
  };
}

// ============================================================================
// Effective personal state (the "local cache authority" seam)
// ============================================================================
//
// The user notes anime in SIMKL (SIMKL → MAL one-way), so SIMKL is the
// authority for PERSONAL fields; MAL is the fallback; an anonymously-imported
// AniList list (docs/PROVIDER-FREE.md P3b) is the LOWEST fallback tier, so an
// AniList-only user still gets their state while existing MAL/SIMKL users are
// unaffected (their higher tiers win). Precedence: SIMKL > MAL > AniList. Every
// personal read used for filtering, seeding, or exclusion goes through these
// three helpers so the precedence lives in exactly one place. Catalog fields
// (mean, genres, studios…) stay MAL — these helpers are personal-only.

/**
 * Effective personal watch status (SIMKL-first, then MAL, then AniList). Thin
 * read of the hydration engine's `personal` projection (docs/PROVIDER-FREE-CUTOVER.md
 * Phase C) — `toAnimeRecord` already applies this exact precedence via
 * `DEFAULT_PERSONAL_PRECEDENCE`, so there is one implementation, not two.
 */
export function getEffectiveStatus(anime: AnimeRecord): string | undefined {
  return anime.personal.status;
}

/** Effective personal score on the shared 1–10 scale. See `getEffectiveStatus`. */
export function getEffectiveScore(anime: AnimeRecord): number | undefined {
  return anime.personal.score;
}

/** Effective watched-episode progress. See `getEffectiveStatus`. */
export function getEffectiveProgress(anime: AnimeRecord): number | undefined {
  return anime.personal.progress;
}

export function formatUserStatus(status?: string) {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ============================================================================
// Hydration engine (docs/PROVIDER-FREE-CUTOVER.md Phase C)
// ============================================================================
//
// One generic mechanism for both `catalog` and `personal`: each provider
// exposes a partial extractor (`catalogFromMal`, `catalogFromAnilist`, …), a
// precedence-merge walks every field the extractors produced and picks the
// first source in precedence order that has a defined value, and records that
// source in a sibling `provenance` map. Values stay flat — `record.catalog.title`
// is the string, no `.value` wrapper — so no consumer needs to change shape.

/**
 * Default catalog field precedence: MAL-first, matching pre-Phase-C behavior
 * exactly. AniList wins only where MAL is absent (e.g. an AniList-only title)
 * — flipping the DEFAULT before MAL coverage is universal would blank fields
 * for titles the AniList crawler hasn't reached yet. `simkl` is included for
 * uniformity (see `catalogFromSimkl`) but never wins today: it contributes no
 * catalog fields.
 */
export const DEFAULT_CATALOG_PRECEDENCE: CatalogSource[] = ['mal', 'anilist', 'simkl'];

/**
 * Personal-state precedence: SIMKL > MAL > AniList — exactly the pre-Phase-C
 * `getEffective*` order. `local`'s position is NOT baked here: it's inserted by
 * `resolveLocalPrecedence` (top or bottom) only when the local provider is
 * enabled, so the default array preserves today's behavior byte-for-byte.
 */
export const DEFAULT_PERSONAL_PRECEDENCE: ProvenanceSource[] = ['simkl', 'mal', 'anilist'];

/** How the local tier sits relative to the external providers (docs/localRating/). */
export type LocalPrecedenceMode = 'auto' | 'localTop' | 'localBottom';

/**
 * Insert `local` into a base personal-precedence array (docs/localRating/ Phase 1).
 * Pure and client-safe so the settings page can preview the resolved order.
 *
 * - `localTop`    → local wins over every external source.
 * - `localBottom` → local is the last resort (never shadows an external edit).
 * - `auto`        → bottom when a writable external provider is connected (model B,
 *                   "write-through, no shadowing"), top when local is the only source.
 */
export function resolveLocalPrecedence(
  mode: LocalPrecedenceMode,
  base: ProvenanceSource[],
  opts: { hasWritableExternal: boolean }
): ProvenanceSource[] {
  if (mode === 'localTop') return ['local', ...base];
  if (mode === 'localBottom') return [...base, 'local'];
  return opts.hasWritableExternal ? [...base, 'local'] : ['local', ...base];
}

/**
 * Generic precedence merge: for every field any extractor produced, walk
 * `precedence` and take the first source with a defined value, recording which
 * source won in a sibling provenance map. A field no source touched is simply
 * absent from both `merged` and `provenance`.
 */
function mergeWithProvenance<T extends object>(
  precedence: ProvenanceSource[],
  extracted: Partial<Record<ProvenanceSource, Partial<T>>>
): { merged: Partial<T>; provenance: Partial<Record<keyof T, ProvenanceSource>> } {
  const merged: Partial<T> = {};
  const provenance: Partial<Record<keyof T, ProvenanceSource>> = {};
  const allKeys = new Set<keyof T>();
  for (const values of Object.values(extracted)) {
    if (!values) continue;
    for (const key of Object.keys(values) as (keyof T)[]) allKeys.add(key);
  }
  for (const key of allKeys) {
    for (const source of precedence) {
      const values = extracted[source];
      const value = values ? values[key] : undefined;
      if (value !== undefined) {
        merged[key] = value;
        provenance[key] = source;
        break;
      }
    }
  }
  return { merged, provenance };
}

/** MAL's raw shape → the provider-neutral `AnimeCatalog` field names. */
function catalogFromMal(mal?: MALAnime): Partial<AnimeCatalog> {
  if (!mal) return {};
  return {
    title: mal.title,
    alternativeTitles: mal.alternative_titles,
    mainPicture: mal.main_picture,
    pictures: mal.pictures,
    synopsis: mal.synopsis,
    background: mal.background,
    startDate: mal.start_date,
    endDate: mal.end_date,
    mean: mal.mean,
    rank: mal.rank,
    popularity: mal.popularity,
    numListUsers: mal.num_list_users,
    numScoringUsers: mal.num_scoring_users,
    nsfw: mal.nsfw,
    genres: mal.genres,
    mediaType: mal.media_type,
    airingStatus: mal.status,
    numEpisodes: mal.num_episodes,
    startSeason: mal.start_season,
    broadcast: mal.broadcast,
    source: mal.source,
    averageEpisodeDuration: mal.average_episode_duration,
    rating: mal.rating,
    relatedAnime: mal.related_anime,
    studios: mal.studios,
  };
}

/**
 * AniList's catalog crawler shape → `AnimeCatalog` field names (see
 * `AniListMetaEntry.catalog`'s doc comment — already MAL-vocabulary-normalized
 * at crawl time). This is what lets an AniList-only title (no MAL slice)
 * render a full row.
 */
function catalogFromAnilist(entry?: AniListMetaEntry): Partial<AnimeCatalog> {
  const c = entry?.catalog;
  if (!c) return {};
  return {
    title: c.title,
    alternativeTitles: c.titleEnglish ? { synonyms: [], en: c.titleEnglish, ja: c.titleRomaji ?? '' } : undefined,
    mainPicture: c.coverImage,
    pictures: c.coverImage ? [c.coverImage] : undefined,
    synopsis: c.synopsis,
    startDate: c.startDate,
    mean: c.mean,
    numListUsers: c.numListUsers,
    genres: c.genres,
    mediaType: c.mediaType,
    airingStatus: c.airingStatus,
    numEpisodes: c.numEpisodes,
    startSeason: c.startSeason,
    studios: c.studios,
  };
}

/**
 * SIMKL contributes no catalog fields today (its public API has no tags/genre
 * detail beyond what MAL already gives — see CLAUDE.md's SIMKL section). Wired
 * uniformly with the other extractors so a future SIMKL catalog field is a
 * one-line addition here, not a new merge path.
 */
function catalogFromSimkl(): Partial<AnimeCatalog> {
  return {};
}

/**
 * The local provider is personal-only — it contributes no catalog fields.
 * No-op, wired uniformly with the other catalog extractors (`CatalogSource =
 * ProvenanceSource`, so `'local'` is nominally a catalog source); it never wins
 * a catalog field, being absent from `DEFAULT_CATALOG_PRECEDENCE`.
 */
function catalogFromLocal(): Partial<AnimeCatalog> {
  return {};
}

/** MAL's `my_list_status` → the provider-neutral `AnimePersonal` field names. */
function personalFromMal(mal?: MALAnime): Partial<AnimePersonal> {
  const status = mal?.my_list_status;
  if (!status) return {};
  return {
    status: status.status as AnimePersonal['status'],
    score: status.score > 0 ? status.score : undefined,
    progress: status.num_episodes_watched,
  };
}

/** SIMKL's personal entry → `AnimePersonal` field names. */
function personalFromSimkl(simkl?: SimklPersonalEntry): Partial<AnimePersonal> {
  if (!simkl) return {};
  return {
    status: simkl.status,
    score: simkl.score != null && simkl.score > 0 ? simkl.score : undefined,
    progress: simkl.num_episodes_watched ?? undefined,
  };
}

/** AniList's (anonymously-imported) personal entry → `AnimePersonal` field names. */
function personalFromAnilist(entry?: AniListPersonalEntry): Partial<AnimePersonal> {
  if (!entry) return {};
  return {
    status: entry.status,
    score: entry.score != null && entry.score > 0 ? entry.score : undefined,
    progress: entry.progress,
  };
}

/** In-app local entry → `AnimePersonal` field names (docs/localRating/). */
function personalFromLocal(entry?: LocalPersonalEntry): Partial<AnimePersonal> {
  if (!entry) return {};
  return {
    status: entry.status,
    score: entry.score != null && entry.score > 0 ? entry.score : undefined,
    progress: entry.progress,
  };
}

/**
 * The raw per-provider slices `toAnimeRecord` hydrates from — exactly what
 * `getAnimeRecord` gathers per canonical id before any merging happens.
 * `mal` is optional: a canonical id anchored only by AniList (no MAL slice)
 * still produces a full record, per the Phase C checkpoint.
 */
export interface RawAnimeSlices {
  mal?: MALAnime;
  simkl?: SimklPersonalEntry;
  anilistMeta?: AniListMetaEntry;
  anilistPersonal?: AniListPersonalEntry;
  local?: LocalPersonalEntry;
  hidden?: boolean;
  discrepancy?: Discrepancy | null;
  crosswalk?: SourceIds;
}

/**
 * Build the provider-neutral `AnimeRecord` from a canonical id's raw slices
 * via the generic hydration engine above. `personal` reproduces the exact
 * `getEffective*` precedence (SIMKL > MAL > AniList) so there remains one
 * implementation of "which source wins" for personal state; `sources` keeps
 * every raw slice verbatim so nothing is lost in the merge.
 */
export function toAnimeRecord(
  slices: RawAnimeSlices,
  canonicalId: string,
  catalogPrecedence: CatalogSource[] = DEFAULT_CATALOG_PRECEDENCE,
  personalPrecedence: ProvenanceSource[] = DEFAULT_PERSONAL_PRECEDENCE
): AnimeRecord {
  const { mal, simkl, anilistMeta, anilistPersonal, local, hidden, discrepancy, crosswalk } = slices;

  const { merged: catalogMerged, provenance: catalogProvenance } = mergeWithProvenance<AnimeCatalog>(
    catalogPrecedence,
    { mal: catalogFromMal(mal), anilist: catalogFromAnilist(anilistMeta), simkl: catalogFromSimkl(), local: catalogFromLocal() }
  );
  const { merged: personalMerged, provenance: personalProvenance } = mergeWithProvenance<AnimePersonal>(
    personalPrecedence,
    { mal: personalFromMal(mal), simkl: personalFromSimkl(simkl), anilist: personalFromAnilist(anilistPersonal), local: personalFromLocal(local) }
  );

  return {
    id: canonicalId,
    crosswalk: crosswalk ?? (mal ? { mal: mal.id } : {}),
    catalog: {
      // `title`/`genres`/`pictures`/`relatedAnime`/`studios` are non-optional on
      // `AnimeCatalog` — fall back to empty rather than `undefined` when no
      // source had a value (should only happen for a not-yet-hydrated record).
      ...catalogMerged,
      title: catalogMerged.title ?? '',
      genres: catalogMerged.genres ?? [],
      pictures: catalogMerged.pictures ?? [],
      relatedAnime: catalogMerged.relatedAnime ?? [],
      studios: catalogMerged.studios ?? [],
    },
    personal: personalMerged,
    provenance: { catalog: catalogProvenance, personal: personalProvenance },
    sources: { mal, simkl, anilist: anilistMeta, anilistPersonal, local },
    hidden,
    discrepancy,
  };
}
