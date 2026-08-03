/**
 * URL state for the credits pages (`/credits/studio/[id]`, `/credits/staff/[id]`).
 *
 * Same principle as the rest of the app — URL is the single source of truth —
 * with two differences from its siblings, both from living on a DYNAMIC route:
 *
 * - `router.query` carries the route params (`type`, `id`) alongside the filter
 *   params, so decoding has to skip them or they'd be echoed back into the query
 *   string as `?type=studio&id=42`.
 * - `encode` takes the base path rather than hardcoding one.
 *
 * Updates are **not** shallow, on purpose: the filtering happens in
 * `getServerSideProps` (the credit lookup is a catalog scan either way), so a
 * shallow push would leave every filter silently inert.
 */
import { useRouter } from 'next/router';
import { useCallback, useMemo } from 'react';
import { SortColumn, SortDirection } from '@/models/anime';

export interface CreditsUrlState {
  search: string;
  mediaTypes: string[];
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  /** MAL genre names — AND semantics, empty = no filter. */
  genres: string[];
  /** Effective personal status, `not_defined` included — OR semantics, empty = no filter. */
  statuses: string[];
  sortBy: SortColumn;
  sortDir: SortDirection;
}

/**
 * Date descending by default: a filmography is read newest-first (what has this
 * studio / this director done lately), unlike the main list's score ranking.
 */
export const CREDITS_DEFAULTS: CreditsUrlState = {
  search: '',
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  genres: [],
  statuses: [],
  sortBy: 'start_date',
  sortDir: 'desc',
};

const SORT_COLUMNS: readonly SortColumn[] = [
  'title', 'mean', 'start_date', 'status', 'num_episodes',
  'rank', 'popularity', 'num_list_users', 'num_scoring_users',
];
const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc'];

export const CREDITS_KEYS = {
  search: 'q',
  mediaType: 'mt',
  minScore: 'min',
  maxScore: 'max',
  minYear: 'miny',
  maxYear: 'maxy',
  genres: 'g',
  statuses: 'st',
  sortBy: 'sort',
  sortDir: 'dir',
} as const;

/** Guard a closed-set param: an unknown value falls back rather than typing a lie. */
function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function num(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

const csv = (v: string | null): string[] =>
  (v || '').split(',').map(s => s.trim()).filter(Boolean);

/**
 * Decode the filter state out of a query bag. Shared with `getServerSideProps`,
 * which is where the filters are actually applied — one decoder, so the sidebar
 * and the server can't disagree about what a URL means.
 */
export function decodeCreditsState(params: URLSearchParams): CreditsUrlState {
  return {
    search: params.get(CREDITS_KEYS.search) || '',
    mediaTypes: csv(params.get(CREDITS_KEYS.mediaType)),
    minScore: num(params.get(CREDITS_KEYS.minScore)),
    maxScore: num(params.get(CREDITS_KEYS.maxScore)),
    minYear: num(params.get(CREDITS_KEYS.minYear)),
    maxYear: num(params.get(CREDITS_KEYS.maxYear)),
    genres: csv(params.get(CREDITS_KEYS.genres)),
    statuses: csv(params.get(CREDITS_KEYS.statuses)),
    sortBy: oneOf(params.get(CREDITS_KEYS.sortBy), SORT_COLUMNS, CREDITS_DEFAULTS.sortBy),
    sortDir: oneOf(params.get(CREDITS_KEYS.sortDir), SORT_DIRECTIONS, CREDITS_DEFAULTS.sortDir),
  };
}

function encode(basePath: string, state: CreditsUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set(CREDITS_KEYS.search, state.search);
  if (state.mediaTypes.length > 0) params.set(CREDITS_KEYS.mediaType, state.mediaTypes.join(','));
  if (state.minScore !== null) params.set(CREDITS_KEYS.minScore, String(state.minScore));
  if (state.maxScore !== null) params.set(CREDITS_KEYS.maxScore, String(state.maxScore));
  if (state.minYear !== null) params.set(CREDITS_KEYS.minYear, String(state.minYear));
  if (state.maxYear !== null) params.set(CREDITS_KEYS.maxYear, String(state.maxYear));
  if (state.genres.length > 0) params.set(CREDITS_KEYS.genres, state.genres.join(','));
  if (state.statuses.length > 0) params.set(CREDITS_KEYS.statuses, state.statuses.join(','));
  if (state.sortBy !== CREDITS_DEFAULTS.sortBy) params.set(CREDITS_KEYS.sortBy, state.sortBy);
  if (state.sortDir !== CREDITS_DEFAULTS.sortDir) params.set(CREDITS_KEYS.sortDir, state.sortDir);
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `${basePath}?${qs}` : basePath;
}

export interface UseCreditsUrlStateReturn {
  state: CreditsUrlState;
  update: (updates: Partial<CreditsUrlState>) => void;
}

export function useCreditsUrlState(basePath: string): UseCreditsUrlStateReturn {
  const router = useRouter();

  // The route params are NOT state — `type` and `id` are already in `basePath`,
  // and sweeping them in here would round-trip them into the query string.
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(router.query).forEach(([key, value]) => {
      if (key === 'type' || key === 'id') return;
      if (typeof value === 'string') params.set(key, value);
    });
    params.sort();
    return params.toString();
  }, [router.query]);

  const state = useMemo(() => decodeCreditsState(new URLSearchParams(queryString)), [queryString]);

  // Deliberately NOT shallow — getServerSideProps does the filtering.
  const update = useCallback((updates: Partial<CreditsUrlState>) => {
    router.push(encode(basePath, { ...state, ...updates }));
  }, [state, router, basePath]);

  return { state, update };
}

export default useCreditsUrlState;
