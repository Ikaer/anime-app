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
import {
  decodeNarrowing, encodeNarrowing, parseUrlList, parseUrlNumber, NARROWING_API_KEYS,
  NARROWING_FIELDS_NO_GENRES, type NarrowingUrlState,
} from '@/lib/url/narrowingParams';

/** No genre filter on this page — the narrowing set minus `genres`. */
export interface ActivityUrlState extends Omit<NarrowingUrlState, 'genres'> {
  /** Effective personal statuses to keep; empty = all of them. */
  statuses: string[];
  /** 0-based page. Server-side, like the filters. */
  page: number;
  /**
   * `day` (default): every title, under local-day headers. `franchise`: one row
   * per franchise — its most recently watched entry — as a flat list.
   */
  groupBy: ActivityGroupBy;
}

export type ActivityGroupBy = 'day' | 'franchise';

export const ACTIVITY_DEFAULTS: ActivityUrlState = {
  search: '',
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  statuses: [],
  page: 0,
  groupBy: 'day',
};

/** This page's own keys; the narrowing ones are `NARROWING_URL_KEYS`. */
const KEYS = {
  statuses: 'st',
  page: 'p',
  groupBy: 'grp',
} as const;

/** Every key that changes which rows exist — a move on any of them resets paging. */
const FILTER_KEYS = [
  'search', 'mediaTypes', 'minScore', 'maxScore', 'minYear', 'maxYear', 'statuses', 'groupBy',
] as const satisfies readonly (keyof ActivityUrlState)[];

function decode(params: URLSearchParams): ActivityUrlState {
  return {
    ...decodeNarrowing(params, NARROWING_FIELDS_NO_GENRES),
    statuses: parseUrlList(params.get(KEYS.statuses)),
    page: Math.max(0, Math.floor(parseUrlNumber(params.get(KEYS.page)) ?? 0)),
    groupBy: params.get(KEYS.groupBy) === 'franchise' ? 'franchise' : 'day',
  };
}

function encode(state: ActivityUrlState): string {
  const params = encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS_NO_GENRES);
  if (state.statuses.length > 0) params.set(KEYS.statuses, state.statuses.join(','));
  if (state.page > 0) params.set(KEYS.page, String(state.page));
  if (state.groupBy !== 'day') params.set(KEYS.groupBy, state.groupBy);
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/activity?${qs}` : '/activity';
}

/**
 * The query string the API cares about — here, all of it. `groupBy` included:
 * day headers are cut client-side, but the franchise collapse changes which
 * rows exist and how they page, so it is the server's.
 */
export function toActivityQuery(state: ActivityUrlState): string {
  const params = encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS_NO_GENRES, NARROWING_API_KEYS);
  if (state.statuses.length > 0) params.set('status', state.statuses.join(','));
  if (state.page > 0) params.set('page', String(state.page));
  if (state.groupBy === 'franchise') params.set('group', 'franchise');
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
