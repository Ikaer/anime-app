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
import {
  decodeNarrowing, encodeNarrowing, parseUrlList, NARROWING_FIELDS, type NarrowingUrlState,
} from '@/lib/url/narrowingParams';

export interface CreditsUrlState extends NarrowingUrlState {
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

/** This page's own keys; the narrowing ones are `NARROWING_URL_KEYS`. */
const CREDITS_KEYS = {
  statuses: 'st',
  sortBy: 'sort',
  sortDir: 'dir',
} as const;

/** Guard a closed-set param: an unknown value falls back rather than typing a lie. */
function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * Decode the filter state out of a query bag. Shared with `getServerSideProps`,
 * which is where the filters are actually applied — one decoder, so the sidebar
 * and the server can't disagree about what a URL means.
 */
export function decodeCreditsState(params: URLSearchParams): CreditsUrlState {
  return {
    ...decodeNarrowing(params, NARROWING_FIELDS),
    statuses: parseUrlList(params.get(CREDITS_KEYS.statuses)),
    sortBy: oneOf(params.get(CREDITS_KEYS.sortBy), SORT_COLUMNS, CREDITS_DEFAULTS.sortBy),
    sortDir: oneOf(params.get(CREDITS_KEYS.sortDir), SORT_DIRECTIONS, CREDITS_DEFAULTS.sortDir),
  };
}

function encode(basePath: string, state: CreditsUrlState): string {
  const params = encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS);
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
