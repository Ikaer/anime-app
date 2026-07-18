/**
 * URL state for the "/quick-rate" franchise-bulk rating page (docs/quickRate/).
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

export interface QuickRateUrlState {
  search: string;
  mediaTypes: string[];
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  genres: string[];
  /** Effective personal status; `not_defined` = unstatused. Empty = no filter. */
  statuses: string[];
  /** Rating a title also marks it completed at full progress. Default ON. */
  autoComplete: boolean;
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
};

const KEYS = {
  search: 'q',
  mediaType: 'mt',
  minScore: 'min',
  maxScore: 'max',
  minYear: 'miny',
  maxYear: 'maxy',
  genres: 'g',
  statuses: 'st',
  autoComplete: 'ac',
} as const;

function decode(params: URLSearchParams): QuickRateUrlState {
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
    genres: csv(params.get(KEYS.genres)),
    statuses: csv(params.get(KEYS.statuses)),
    // Default-on, so only the OFF state is written to the URL.
    autoComplete: params.get(KEYS.autoComplete) !== '0',
  };
}

function encode(state: QuickRateUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set(KEYS.search, state.search);
  if (state.mediaTypes.length > 0) params.set(KEYS.mediaType, state.mediaTypes.join(','));
  if (state.minScore !== null) params.set(KEYS.minScore, String(state.minScore));
  if (state.maxScore !== null) params.set(KEYS.maxScore, String(state.maxScore));
  if (state.minYear !== null) params.set(KEYS.minYear, String(state.minYear));
  if (state.maxYear !== null) params.set(KEYS.maxYear, String(state.maxYear));
  if (state.genres.length > 0) params.set(KEYS.genres, state.genres.join(','));
  if (state.statuses.length > 0) params.set(KEYS.statuses, state.statuses.join(','));
  if (!state.autoComplete) params.set(KEYS.autoComplete, '0');
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/quick-rate?${qs}` : '/quick-rate';
}

/** The query string the API cares about — everything but the write-behavior toggle. */
export function toQuickRateQuery(state: QuickRateUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.mediaTypes.length > 0) params.set('mediaType', state.mediaTypes.join(','));
  if (state.minScore !== null) params.set('minScore', String(state.minScore));
  if (state.maxScore !== null) params.set('maxScore', String(state.maxScore));
  if (state.minYear !== null) params.set('minYear', String(state.minYear));
  if (state.maxYear !== null) params.set('maxYear', String(state.maxYear));
  if (state.genres.length > 0) params.set('genres', state.genres.join(','));
  if (state.statuses.length > 0) params.set('status', state.statuses.join(','));
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
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, isReady };
}

export default useQuickRateUrlState;
