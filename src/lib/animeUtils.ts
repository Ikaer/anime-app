import type { AnimeForDisplay, SeasonName, SeasonInfo } from '@/models/anime';
import type { TFunction, TranslationKey } from '@/lib/i18n';

// ============================================================================
// Display titles (English-first)
// ============================================================================

type TitleFields = Pick<AnimeForDisplay, 'title' | 'alternative_titles'>;

/** Primary display title: MAL's English title when present, else the original (romaji) title. */
export function getPrimaryTitle(a: TitleFields): string {
  return a.alternative_titles?.en || a.title;
}

/** Secondary title: the original (romaji) title, returned only when it differs from the primary. */
export function getSecondaryTitle(a: TitleFields): string | undefined {
  const primary = getPrimaryTitle(a);
  return a.title && a.title !== primary ? a.title : undefined;
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
// authority for PERSONAL fields; MAL is the fallback. Every personal read used
// for filtering, seeding, or exclusion goes through these three helpers so the
// SIMKL-first precedence lives in exactly one place. Catalog fields (mean,
// genres, studios…) stay MAL — these helpers are personal-only.

/**
 * Effective personal watch status (SIMKL-first, MAL fallback). SIMKL status is
 * already normalized to MAL vocabulary at sync time, so callers get one
 * vocabulary regardless of source.
 */
export function getEffectiveStatus(anime: AnimeForDisplay): string | undefined {
  return anime.simkl?.status ?? anime.my_list_status?.status;
}

/**
 * Effective personal score on the shared 1–10 scale (SIMKL-first, MAL
 * fallback). Both `0` and `null` mean "unrated" and collapse to `undefined`,
 * preserving the threshold / `unrated` semantics that keyed off a falsy score.
 */
export function getEffectiveScore(anime: AnimeForDisplay): number | undefined {
  const simkl = anime.simkl?.score;
  if (simkl != null && simkl > 0) return simkl;
  const mal = anime.my_list_status?.score;
  return mal != null && mal > 0 ? mal : undefined;
}

/** Effective watched-episode progress (SIMKL-first, MAL fallback). */
export function getEffectiveProgress(anime: AnimeForDisplay): number | undefined {
  const simkl = anime.simkl?.num_episodes_watched;
  if (simkl != null) return simkl;
  return anime.my_list_status?.num_episodes_watched ?? undefined;
}

export function formatUserStatus(status?: string) {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
