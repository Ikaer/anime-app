/**
 * URL state for "/activity" (« Fil d'activité »).
 *
 * Its own small shape rather than a slice of `AnimeFiltersState`, same as
 * useCatchUpUrlState / useQuickRateUrlState: this is not a view of the main
 * list, it is a reverse-chronological read of one field the main list has no
 * concept of.
 *
 * There is deliberately **no sort key**: the feed's order IS the watch clock,
 * so a sort control would contradict the page — the same reasoning that keeps
 * `sort` off `/recommendations`.
 *
 * `statuses` is the one filter here that is not in the shared narrowing set. It
 * earns its place because the feed mixes `completed`, `watching` and `dropped`
 * rows by nature, and "only what I finished" is the question most often asked
 * of a history.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface ActivityUrlState {
  search: string;
  mediaTypes: string[];
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  /** Effective personal statuses to keep; empty = all of them. */
  statuses: string[];
  /** 0-based page. Server-side, like the filters. */
  page: number;
}

export const ACTIVITY_DEFAULTS: ActivityUrlState = {
  search: '',
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
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
  statuses: 'st',
  page: 'p',
} as const;

/** Every key that changes which rows exist — a move on any of them resets paging. */
const FILTER_KEYS = [
  'search', 'mediaTypes', 'minScore', 'maxScore', 'minYear', 'maxYear', 'statuses',
] as const satisfies readonly (keyof ActivityUrlState)[];

function decode(params: URLSearchParams): ActivityUrlState {
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
    statuses: csv(params.get(KEYS.statuses)),
    page: Math.max(0, Math.floor(num(params.get(KEYS.page)) ?? 0)),
  };
}

function encode(state: ActivityUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set(KEYS.search, state.search);
  if (state.mediaTypes.length > 0) params.set(KEYS.mediaType, state.mediaTypes.join(','));
  if (state.minScore !== null) params.set(KEYS.minScore, String(state.minScore));
  if (state.maxScore !== null) params.set(KEYS.maxScore, String(state.maxScore));
  if (state.minYear !== null) params.set(KEYS.minYear, String(state.minYear));
  if (state.maxYear !== null) params.set(KEYS.maxYear, String(state.maxYear));
  if (state.statuses.length > 0) params.set(KEYS.statuses, state.statuses.join(','));
  if (state.page > 0) params.set(KEYS.page, String(state.page));
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/activity?${qs}` : '/activity';
}

/** The query string the API cares about — here, all of it. */
export function toActivityQuery(state: ActivityUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set('search', state.search);
  if (state.mediaTypes.length > 0) params.set('mediaType', state.mediaTypes.join(','));
  if (state.minScore !== null) params.set('minScore', String(state.minScore));
  if (state.maxScore !== null) params.set('maxScore', String(state.maxScore));
  if (state.minYear !== null) params.set('minYear', String(state.minYear));
  if (state.maxYear !== null) params.set('maxYear', String(state.maxYear));
  if (state.statuses.length > 0) params.set('status', state.statuses.join(','));
  if (state.page > 0) params.set('page', String(state.page));
  return params.toString();
}

export interface UseActivityUrlStateReturn {
  state: ActivityUrlState;
  update: (updates: Partial<ActivityUrlState>) => void;
  isReady: boolean;
}

export function useActivityUrlState(): UseActivityUrlStateReturn {
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

  const state = useMemo<ActivityUrlState>(() => {
    if (!router.isReady) return { ...ACTIVITY_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<ActivityUrlState>) => {
    const next = { ...state, ...updates };
    // A filter moved and the caller didn't say where to land → back to page 1.
    if (updates.page === undefined && FILTER_KEYS.some(k => k in updates)) next.page = 0;
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, isReady };
}

export default useActivityUrlState;
