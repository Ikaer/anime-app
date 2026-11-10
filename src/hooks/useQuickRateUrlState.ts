/**
 * URL state for the "/quick-rate" franchise-bulk rating page.
 *
 * Mirrors useTierUrlState — its own small shape rather than a slice of
 * AnimeFiltersState, because this page's state isn't a view of the main list.
 * The one addition over the tier board is `autoComplete`: rating here implies
 * "I finished this", and the toggle is deliberately **page-scoped** (persisted
 * in this page's URL, not in app settings) so a score-only edit on the detail
 * page or the tier board is never hijacked by it.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  decodeNarrowing, encodeNarrowing, parseUrlList, parseUrlNumber, NARROWING_API_KEYS,
  NARROWING_FIELDS, type NarrowingUrlState,
} from '@/lib/url/narrowingParams';

export interface QuickRateUrlState extends NarrowingUrlState {
  /** Effective personal status; `not_defined` = unstatused. Empty = no filter. */
  statuses: string[];
  /** Rating a title also marks it completed at full progress. Default ON. */
  autoComplete: boolean;
  /** 0-based franchise-group page. Server-side, like the filters. */
  page: number;
}

export const QUICK_RATE_DEFAULTS: QuickRateUrlState = {
  search: '',
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  genres: [],
  statuses: [],
  autoComplete: true,
  page: 0,
};

/** This page's own keys; the narrowing ones are `NARROWING_URL_KEYS`. */
const KEYS = {
  statuses: 'st',
  autoComplete: 'ac',
  page: 'p',
} as const;

/**
 * Every state key that narrows the result set. Changing any of them resets the
 * page — otherwise a filter that shrinks 8 pages to 1 leaves you stranded on a
 * page that no longer exists. (`autoComplete` is write behavior, not a filter,
 * so it deliberately preserves your position.)
 */
const FILTER_KEYS = [
  'search', 'mediaTypes', 'minScore', 'maxScore', 'minYear', 'maxYear', 'genres', 'statuses',
] as const satisfies readonly (keyof QuickRateUrlState)[];

function decode(params: URLSearchParams): QuickRateUrlState {
  return {
    ...decodeNarrowing(params, NARROWING_FIELDS),
    statuses: parseUrlList(params.get(KEYS.statuses)),
    // Default-on, so only the OFF state is written to the URL.
    autoComplete: params.get(KEYS.autoComplete) !== '0',
    page: Math.max(0, Math.floor(parseUrlNumber(params.get(KEYS.page)) ?? 0)),
  };
}

function encode(state: QuickRateUrlState): string {
  const params = encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS);
  if (state.statuses.length > 0) params.set(KEYS.statuses, state.statuses.join(','));
  if (!state.autoComplete) params.set(KEYS.autoComplete, '0');
  if (state.page > 0) params.set(KEYS.page, String(state.page));
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/quick-rate?${qs}` : '/quick-rate';
}

/** The query string the API cares about — everything but the write-behavior toggle. */
export function toQuickRateQuery(state: QuickRateUrlState): string {
  const params = encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS, NARROWING_API_KEYS);
  if (state.statuses.length > 0) params.set('status', state.statuses.join(','));
  if (state.page > 0) params.set('page', String(state.page));
  return params.toString();
}

export interface UseQuickRateUrlStateReturn {
  state: QuickRateUrlState;
  update: (updates: Partial<QuickRateUrlState>) => void;
  isReady: boolean;
}

export function useQuickRateUrlState(): UseQuickRateUrlStateReturn {
  const router = useRouter();

  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (router.isReady) setIsReady(true);
  }, [router.isReady]);

  const queryString = useMemo(() => {
    if (!router.isReady) return '';
    const params = new URLSearchParams();
    Object.entries(router.query).forEach(([key, value]) => {
      if (typeof value === 'string') params.set(key, value);
    });
    params.sort();
    return params.toString();
  }, [router.isReady, router.query]);

  const state = useMemo<QuickRateUrlState>(() => {
    if (!router.isReady) return { ...QUICK_RATE_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<QuickRateUrlState>) => {
    const next = { ...state, ...updates };
    // A filter moved and the caller didn't say where to land → back to page 1.
    if (updates.page === undefined && FILTER_KEYS.some(k => k in updates)) next.page = 0;
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, isReady };
}

export default useQuickRateUrlState;
