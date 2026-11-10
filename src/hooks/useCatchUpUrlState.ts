/**
 * URL state for the "/catch-up" page (« À rattraper »).
 *
 * Mirrors useQuickRateUrlState — its own small shape rather than a slice of
 * AnimeFiltersState, because this page isn't a view of the main list. The one
 * addition is `unaired`: whether announced-but-not-yet-aired entries count as
 * something to catch up on. Default OFF, so the page answers "what can I watch
 * now" until you ask it otherwise.
 *
 * There is no status filter, deliberately: which statuses make an anchor and a
 * hole IS the page (completed / untouched), not a knob on it.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  decodeNarrowing, encodeNarrowing, parseUrlNumber, NARROWING_API_KEYS, NARROWING_DEFAULTS,
  NARROWING_FIELDS_NO_GENRES, type NarrowingUrlState,
} from '@/lib/url/narrowingParams';

/** No genre filter on this page — the narrowing set minus `genres`. */
export interface CatchUpUrlState extends Omit<NarrowingUrlState, 'genres'> {
  /** List entries that haven't aired yet. Default OFF. */
  unaired: boolean;
  /**
   * Walk sequel/prequel edges only. Not a row filter — it rebuilds the franchise
   * graph, so a side story stops being a member of the chain at all.
   */
  direct: boolean;
  /** 0-based franchise page. Server-side, like the filters. */
  page: number;
}

export const CATCH_UP_DEFAULTS: CatchUpUrlState = {
  search: NARROWING_DEFAULTS.search,
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  unaired: false,
  direct: false,
  page: 0,
};

/** This page's own keys; the narrowing ones are `NARROWING_URL_KEYS`. */
const KEYS = {
  unaired: 'ua',
  direct: 'dr',
  page: 'p',
} as const;

/**
 * Every key that narrows the result set — `unaired` and `direct` included,
 * unlike quick-rate's `autoComplete`: both add and remove rows, so a stale page
 * number would strand you the same way a filter change does.
 */
const FILTER_KEYS = [
  'search', 'mediaTypes', 'minScore', 'maxScore', 'minYear', 'maxYear', 'unaired', 'direct',
] as const satisfies readonly (keyof CatchUpUrlState)[];

function decode(params: URLSearchParams): CatchUpUrlState {
  return {
    ...decodeNarrowing(params, NARROWING_FIELDS_NO_GENRES),
    // Default-off, so only the ON state is written to the URL.
    unaired: params.get(KEYS.unaired) === '1',
    direct: params.get(KEYS.direct) === '1',
    page: Math.max(0, Math.floor(parseUrlNumber(params.get(KEYS.page)) ?? 0)),
  };
}

function encode(state: CatchUpUrlState): string {
  const params = encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS_NO_GENRES);
  if (state.unaired) params.set(KEYS.unaired, '1');
  if (state.direct) params.set(KEYS.direct, '1');
  if (state.page > 0) params.set(KEYS.page, String(state.page));
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/catch-up?${qs}` : '/catch-up';
}

/** The query string the API cares about — here, all of it. */
export function toCatchUpQuery(state: CatchUpUrlState): string {
  const params = encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS_NO_GENRES, NARROWING_API_KEYS);
  if (state.unaired) params.set('unaired', '1');
  if (state.direct) params.set('direct', '1');
  if (state.page > 0) params.set('page', String(state.page));
  return params.toString();
}

export interface UseCatchUpUrlStateReturn {
  state: CatchUpUrlState;
  update: (updates: Partial<CatchUpUrlState>) => void;
  isReady: boolean;
}

export function useCatchUpUrlState(): UseCatchUpUrlStateReturn {
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

  const state = useMemo<CatchUpUrlState>(() => {
    if (!router.isReady) return { ...CATCH_UP_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<CatchUpUrlState>) => {
    const next = { ...state, ...updates };
    // A filter moved and the caller didn't say where to land → back to page 1.
    if (updates.page === undefined && FILTER_KEYS.some(k => k in updates)) next.page = 0;
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, isReady };
}

export default useCatchUpUrlState;
