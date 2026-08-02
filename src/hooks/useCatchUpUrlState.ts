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

export interface CatchUpUrlState {
  search: string;
  mediaTypes: string[];
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
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
  search: '',
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  unaired: false,
  direct: false,
  page: 0,
};

const KEYS = {
  search: 'q',
  mediaType: 'mt',
  minScore: 'min',
  maxScore: 'max',
  minYear: 'miny',
  maxYear: 'maxy',
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
  const num = (v: string | null): number | null => {
    if (v === null || v.trim() === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const csv = (v: string | null): string[] =>
    (v || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    search: params.get(KEYS.search) || '',
    mediaTypes: csv(params.get(KEYS.mediaType)),
    minScore: num(params.get(KEYS.minScore)),
    maxScore: num(params.get(KEYS.maxScore)),
    minYear: num(params.get(KEYS.minYear)),
    maxYear: num(params.get(KEYS.maxYear)),
    // Default-off, so only the ON state is written to the URL.
    unaired: params.get(KEYS.unaired) === '1',
    direct: params.get(KEYS.direct) === '1',
    page: Math.max(0, Math.floor(num(params.get(KEYS.page)) ?? 0)),
  };
}

function encode(state: CatchUpUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set(KEYS.search, state.search);
  if (state.mediaTypes.length > 0) params.set(KEYS.mediaType, state.mediaTypes.join(','));
  if (state.minScore !== null) params.set(KEYS.minScore, String(state.minScore));
  if (state.maxScore !== null) params.set(KEYS.maxScore, String(state.maxScore));
  if (state.minYear !== null) params.set(KEYS.minYear, String(state.minYear));
  if (state.maxYear !== null) params.set(KEYS.maxYear, String(state.maxYear));
  if (state.unaired) params.set(KEYS.unaired, '1');
  if (state.direct) params.set(KEYS.direct, '1');
  if (state.page > 0) params.set(KEYS.page, String(state.page));
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/catch-up?${qs}` : '/catch-up';
}

/** The query string the API cares about — here, all of it. */
export function toCatchUpQuery(state: CatchUpUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.mediaTypes.length > 0) params.set('mediaType', state.mediaTypes.join(','));
  if (state.minScore !== null) params.set('minScore', String(state.minScore));
  if (state.maxScore !== null) params.set('maxScore', String(state.maxScore));
  if (state.minYear !== null) params.set('minYear', String(state.minYear));
  if (state.maxYear !== null) params.set('maxYear', String(state.maxYear));
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
