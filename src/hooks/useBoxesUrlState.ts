/**
 * URL state for "/boxes" — the bulk-labeling grid.
 *
 * Mirrors useCatchUpUrlState: its own small shape, because the page isn't a view
 * of the main list. The narrowing filters describe the WATCHED titles you are
 * filing (the inverse of /quick-rate, where they pick seeds that then expand),
 * so every key here narrows and every one of them resets the page.
 *
 * Which boxes exist is deliberately NOT URL state — that is server data, fetched
 * once. Only "what am I looking at" lives here.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface BoxesUrlState {
  search: string;
  mediaTypes: string[];
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  genres: string[];
  statuses: string[];
  /** 0-based group page. Server-side, like the filters. */
  page: number;
}

export const BOXES_DEFAULTS: BoxesUrlState = {
  search: '',
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  genres: [],
  statuses: [],
  page: 0,
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
  page: 'p',
} as const;

const FILTER_KEYS = [
  'search', 'mediaTypes', 'minScore', 'maxScore', 'minYear', 'maxYear', 'genres', 'statuses',
] as const satisfies readonly (keyof BoxesUrlState)[];

const num = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const csv = (v: string | null): string[] =>
  (v || '').split(',').map(s => s.trim()).filter(Boolean);

function decode(params: URLSearchParams): BoxesUrlState {
  return {
    search: params.get(KEYS.search) || '',
    mediaTypes: csv(params.get(KEYS.mediaType)),
    minScore: num(params.get(KEYS.minScore)),
    maxScore: num(params.get(KEYS.maxScore)),
    minYear: num(params.get(KEYS.minYear)),
    maxYear: num(params.get(KEYS.maxYear)),
    genres: csv(params.get(KEYS.genres)),
    statuses: csv(params.get(KEYS.statuses)),
    page: Math.max(0, Math.floor(num(params.get(KEYS.page)) ?? 0)),
  };
}

function encode(state: BoxesUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set(KEYS.search, state.search);
  if (state.mediaTypes.length > 0) params.set(KEYS.mediaType, state.mediaTypes.join(','));
  if (state.minScore !== null) params.set(KEYS.minScore, String(state.minScore));
  if (state.maxScore !== null) params.set(KEYS.maxScore, String(state.maxScore));
  if (state.minYear !== null) params.set(KEYS.minYear, String(state.minYear));
  if (state.maxYear !== null) params.set(KEYS.maxYear, String(state.maxYear));
  if (state.genres.length > 0) params.set(KEYS.genres, state.genres.join(','));
  if (state.statuses.length > 0) params.set(KEYS.statuses, state.statuses.join(','));
  if (state.page > 0) params.set(KEYS.page, String(state.page));
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/boxes?${qs}` : '/boxes';
}

/** The query string `/api/anime/watched-groups` cares about — here, all of it. */
export function toWatchedGroupsQuery(state: BoxesUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.mediaTypes.length > 0) params.set('mediaType', state.mediaTypes.join(','));
  if (state.minScore !== null) params.set('minScore', String(state.minScore));
  if (state.maxScore !== null) params.set('maxScore', String(state.maxScore));
  if (state.minYear !== null) params.set('minYear', String(state.minYear));
  if (state.maxYear !== null) params.set('maxYear', String(state.maxYear));
  if (state.genres.length > 0) params.set('genres', state.genres.join(','));
  if (state.statuses.length > 0) params.set('status', state.statuses.join(','));
  if (state.page > 0) params.set('page', String(state.page));
  return params.toString();
}

export interface UseBoxesUrlStateReturn {
  state: BoxesUrlState;
  update: (updates: Partial<BoxesUrlState>) => void;
  isReady: boolean;
}

export function useBoxesUrlState(): UseBoxesUrlStateReturn {
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

  const state = useMemo<BoxesUrlState>(() => {
    if (!router.isReady) return { ...BOXES_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<BoxesUrlState>) => {
    const next = { ...state, ...updates };
    if (updates.page === undefined && FILTER_KEYS.some(k => k in updates)) next.page = 0;
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, isReady };
}

export default useBoxesUrlState;
