import type {
  AnimeForDisplay, AnimeRecord, AnimeCatalog, AnimePersonal, CatalogSource, MergedAnime,
  ProvenanceSource, SeasonName, SeasonInfo, MALAnime, SimklPersonalEntry, AniListMetaEntry, AniListPersonalEntry,
} from '@/models/anime';
import type { TFunction, TranslationKey } from '@/lib/i18n';

// ============================================================================
// Display titles (English-first)
// ============================================================================

type TitleFields = Pick<AnimeForDisplay, 'title' | 'alternative_titles'>;
type CatalogTitleFields = { title: string; alternativeTitles?: { en: string } };

/** Primary display title: MAL's English title when present, else the original (romaji) title. */
export function getPrimaryTitle(a: TitleFields): string {
  return a.alternative_titles?.en || a.title;
}

/** Secondary title: the original (romaji) title, returned only when it differs from the primary. */
export function getSecondaryTitle(a: TitleFields): string | undefined {
  const primary = getPrimaryTitle(a);
  return a.title && a.title !== primary ? a.title : undefined;
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
function animeYear(a: AnimeForDisplay): number | undefined {
  if (a.start_season?.year) return a.start_season.year;
  if (a.start_date && a.start_date.length >= 4) {
    const y = parseInt(a.start_date.slice(0, 4), 10);
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
export function applyNarrowingFilters<T extends AnimeForDisplay>(
  items: T[],
  f: NarrowingFilters
): T[] {
  let out = items;

  if (f.mediaTypes && f.mediaTypes.length > 0) {
    const wanted = f.mediaTypes.map(t => t.toLowerCase());
    out = out.filter(a => wanted.includes((a.media_type || '').toLowerCase()));
  }

  if (f.search && f.search.trim()) {
    const term = f.search.toLowerCase();
    out = out.filter(a =>
      (a.title || '').toLowerCase().includes(term) ||
      (a.alternative_titles?.en || '').toLowerCase().includes(term)
    );
  }

  if (f.minScore != null && Number.isFinite(f.minScore)) {
    out = out.filter(a => !!a.mean && a.mean >= f.minScore!);
  }

  if (f.maxScore != null && Number.isFinite(f.maxScore)) {
    out = out.filter(a => !!a.mean && a.mean <= f.maxScore!);
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
      const names = new Set((a.genres || []).map(g => g.name));
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
 * Effective personal watch status (SIMKL-first, then MAL, then AniList). All
 * three are normalized to MAL vocabulary at write/import time, so callers get
 * one vocabulary regardless of source.
 */
export function getEffectiveStatus(anime: MergedAnime): string | undefined {
  return anime.simkl?.status ?? anime.my_list_status?.status ?? anime.anilistPersonal?.status;
}

/**
 * Effective personal score on the shared 1–10 scale (SIMKL-first, then MAL,
 * then AniList). Both `0` and `null` mean "unrated" and collapse to `undefined`,
 * preserving the threshold / `unrated` semantics that keyed off a falsy score.
 */
export function getEffectiveScore(anime: MergedAnime): number | undefined {
  const simkl = anime.simkl?.score;
  if (simkl != null && simkl > 0) return simkl;
  const mal = anime.my_list_status?.score;
  if (mal != null && mal > 0) return mal;
  const anilist = anime.anilistPersonal?.score;
  return anilist != null && anilist > 0 ? anilist : undefined;
}

/** Effective watched-episode progress (SIMKL-first, then MAL, then AniList). */
export function getEffectiveProgress(anime: MergedAnime): number | undefined {
  const simkl = anime.simkl?.num_episodes_watched;
  if (simkl != null) return simkl;
  const mal = anime.my_list_status?.num_episodes_watched;
  if (mal != null) return mal;
  return anime.anilistPersonal?.progress ?? undefined;
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

/** Personal-state precedence: SIMKL > MAL > AniList — exactly the pre-Phase-C `getEffective*` order. */
export const DEFAULT_PERSONAL_PRECEDENCE: ProvenanceSource[] = ['simkl', 'mal', 'anilist'];

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

/**
 * Project the merged `AnimeForDisplay` (still MAL-shaped) into the
 * provider-neutral `AnimeRecord` via the generic hydration engine above.
 * `personal` reproduces the exact `getEffective*` precedence (SIMKL > MAL >
 * AniList) so there remains one implementation of "which source wins" for
 * personal state; `sources` keeps every raw slice so nothing is lost in the
 * merge. `id` is the synthetic canonical id from the Phase 1 registry, falling
 * back to a MAL-anchored placeholder for any (should-be-rare) record the
 * registry hasn't reconciled yet — never used outward, see `AnimeRecord.id`'s
 * doc comment.
 */
export function toAnimeRecord(
  anime: MergedAnime,
  canonicalId?: string,
  catalogPrecedence: CatalogSource[] = DEFAULT_CATALOG_PRECEDENCE,
  personalPrecedence: ProvenanceSource[] = DEFAULT_PERSONAL_PRECEDENCE
): AnimeRecord {
  // `anime.id`/`title`/`genres`/`pictures`/`related_anime`/`studios` are only
  // present when a MAL slice actually exists for this record (Phase C widens
  // the row set beyond MAL-anchored titles — see `getAnimeForDisplay`), so
  // treat MAL fields as optional here rather than relying on `MergedAnime`'s
  // `extends MALAnime` non-optionality.
  const mal = anime.id !== undefined ? (anime as MALAnime) : undefined;

  const { merged: catalogMerged, provenance: catalogProvenance } = mergeWithProvenance<AnimeCatalog>(
    catalogPrecedence,
    { mal: catalogFromMal(mal), anilist: catalogFromAnilist(anime.anilistMeta), simkl: catalogFromSimkl() }
  );
  const { merged: personalMerged, provenance: personalProvenance } = mergeWithProvenance<AnimePersonal>(
    personalPrecedence,
    { mal: personalFromMal(mal), simkl: personalFromSimkl(anime.simkl), anilist: personalFromAnilist(anime.anilistPersonal) }
  );

  return {
    id: canonicalId ?? `a_mal_${anime.id}`,
    crosswalk: anime.crosswalk ?? { mal: anime.id },
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
    sources: {
      // Strip the local-record bolt-ons so `sources.mal` is the RAW MAL slice —
      // needed by reads that deliberately want one source's raw value (see the
      // type's doc comment), not the merged/hydrated view. `undefined` when no
      // MAL slice exists for this record (AniList-only title).
      mal: mal ? (() => {
        const {
          hidden, simkl, discrepancy, anilistMeta, anilistPersonal, crosswalk, canonicalId: _canonicalId, ...malOnly
        } = anime;
        return malOnly as MALAnime;
      })() : undefined,
      simkl: anime.simkl,
      anilist: anime.anilistMeta,
      anilistPersonal: anime.anilistPersonal,
    },
    hidden: anime.hidden,
    discrepancy: anime.discrepancy,
  };
}
