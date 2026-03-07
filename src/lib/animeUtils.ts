// Utility function to format season display with nice labels and colors
import { AnimeView, CalendarAnimeView, AnimeWithExtensions, UserAnimeStatus, SortColumn, SortDirection } from "@/models/anime";

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


// Map old view system to new filter parameters
// View preset definition
export interface ViewPreset {
  key: AnimeView;
  label: string;
  description: string;
  seasonStrategy?: 'current' | 'current_previous' | 'next' | null; // dynamic seasons
  staticFilters?: {
    mediaType?: string[];
    hidden?: boolean;
    status?: UserAnimeStatus | 'not_defined';
    sortBy?: SortColumn;
    sortDir?: SortDirection;
  };
}

export const VIEW_PRESETS: ViewPreset[] = [
  {
    key: 'new_season_strict',
    label: 'New Season (Strict)',
    description: 'Animes from the current season only',
    seasonStrategy: 'current',
    staticFilters: { hidden: false }
  },
  {
    key: 'new_season',
    label: 'New Season',
    description: 'Current & previous season',
    seasonStrategy: 'current_previous',
    staticFilters: { hidden: false }
  },
  {
    key: 'next_season',
    label: 'Next Season',
    description: 'Animes that will air in the next season',
    seasonStrategy: 'next',
    staticFilters: { hidden: false }
  },
  {
    key: 'find_shows',
    label: 'Find Shows',
    description: 'Highest rated TV shows not in your list',
    seasonStrategy: null,
    staticFilters: { mediaType: ['tv'], hidden: false, sortBy: 'mean', sortDir: 'desc' }
  },
  { key: 'watching', label: 'Watching', description: 'Currently watching', seasonStrategy: null, staticFilters: { status: 'watching', hidden: false } },
  { key: 'completed', label: 'Completed', description: 'Completed shows', seasonStrategy: null, staticFilters: { status: 'completed', hidden: false } },
  { key: 'on_hold', label: 'On Hold', description: 'Shows on hold', seasonStrategy: null, staticFilters: { status: 'on_hold', hidden: false } },
  { key: 'dropped', label: 'Dropped', description: 'Shows you dropped', seasonStrategy: null, staticFilters: { status: 'dropped', hidden: false } },
  { key: 'plan_to_watch', label: 'Plan to Watch', description: 'Planned shows', seasonStrategy: null, staticFilters: { status: 'plan_to_watch', hidden: false } },
  { key: 'hidden', label: 'Hidden', description: 'Hidden shows only', seasonStrategy: null, staticFilters: { hidden: true } },
];


// Map old view system to new filter parameters
// View preset definition
export interface ViewPreset {
  key: AnimeView;
  label: string;
  description: string;
  seasonStrategy?: 'current' | 'current_previous' | 'next' | null; // dynamic seasons
  staticFilters?: {
    mediaType?: string[];
    hidden?: boolean;
    status?: UserAnimeStatus | 'not_defined';
    sortBy?: SortColumn;
    sortDir?: SortDirection;
  };
}

export function formatUserStatus(status?: string) {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}
