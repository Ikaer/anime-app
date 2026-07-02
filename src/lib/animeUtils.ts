import type { AnimeForDisplay } from '@/models/anime';

// ============================================================================
// Narrowing filters (shared by /api/anime/animes and /api/anime/recommendations)
// ============================================================================

export interface NarrowingFilters {
  mediaTypes?: string[];
  search?: string;
  minScore?: number | null;
  maxScore?: number | null;
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

  return out;
}

// Utility function to format season display with nice labels and colors

export const formatSeason = (year: number, season: string) => {
  const seasonMap: Record<string, { label: string; color: string }> = {
    'spring': { label: 'Spring', color: '#10B981' }, // Green
    'summer': { label: 'Summer', color: '#F59E0B' }, // Orange
    'fall': { label: 'Fall', color: '#EF4444' },     // Red
    'winter': { label: 'Winter', color: '#3B82F6' }  // Blue
  };

  const seasonInfo = seasonMap[season] || { label: season, color: '#6B7280' };
  return {
    label: `${seasonInfo.label} ${year}`,
    color: seasonInfo.color
  };
}


type Season = 'winter' | 'spring' | 'summer' | 'fall';
type SeasonInfo = { year: number; season: Season };
type SeasonInfos = { current: SeasonInfo; previous: SeasonInfo; next: SeasonInfo };

export function getSeasonInfos(): SeasonInfos {

  // Default: new_season view (current implementation)
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();

  // Determine current season
  const month = currentDate.getMonth(); // 0-11
  let currentSeason: Season;
  if (month >= 0 && month <= 2) currentSeason = 'winter';
  else if (month >= 3 && month <= 5) currentSeason = 'spring';
  else if (month >= 6 && month <= 8) currentSeason = 'summer';
  else currentSeason = 'fall';

  // Determine previous season
  let prevYear = currentYear;
  let prevSeason: Season;
  if (currentSeason === 'winter') { prevSeason = 'fall'; prevYear--; }
  else if (currentSeason === 'spring') prevSeason = 'winter';
  else if (currentSeason === 'summer') prevSeason = 'spring';
  else prevSeason = 'summer';

  // Determine next season
  let nextYear = currentYear;
  let nextSeason: Season;
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

export function formatUserStatus(status?: string) {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
