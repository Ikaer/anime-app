/**
 * URL state for the dedicated "/stats" repartition page.
 *
 * Same principle as the rest of the app — URL is the single source of truth —
 * and kept separate from the other page hooks for the same reason theirs are:
 * this page's state is its own small shape. It is the leanest of them all,
 * because the page has exactly two controls: which statuses are in scope, and
 * which dimension is on screen.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { STATS_DIMENSIONS, type StatsDimension } from '@/lib/stats';

export interface StatsUrlState {
  /** Effective (SIMKL-first) personal status — OR semantics, empty = every statused title. */
  statuses: string[];
  /** The dimension currently displayed. */
  dimension: StatsDimension;
}

export const STATS_DEFAULTS: StatsUrlState = {
  statuses: [],
  dimension: 'studios',
};

const KEYS = {
  statuses: 'st',
  dimension: 'dim',
} as const;

function decode(params: URLSearchParams): StatsUrlState {
  const rawDimension = params.get(KEYS.dimension) || '';
  return {
    statuses: (params.get(KEYS.statuses) || '').split(',').map(s => s.trim()).filter(Boolean),
    // An unknown/hand-edited dimension falls back rather than rendering nothing.
    dimension: STATS_DIMENSIONS.includes(rawDimension as StatsDimension)
      ? (rawDimension as StatsDimension)
      : STATS_DEFAULTS.dimension,
  };
}

function encode(state: StatsUrlState): string {
  const params = new URLSearchParams();
  if (state.statuses.length > 0) params.set(KEYS.statuses, state.statuses.join(','));
  if (state.dimension !== STATS_DEFAULTS.dimension) params.set(KEYS.dimension, state.dimension);
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/stats?${qs}` : '/stats';
}

export interface UseStatsUrlStateReturn {
  state: StatsUrlState;
  update: (updates: Partial<StatsUrlState>) => void;
  isReady: boolean;
}

export function useStatsUrlState(): UseStatsUrlStateReturn {
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

  const state = useMemo<StatsUrlState>(() => {
    if (!router.isReady) return { ...STATS_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<StatsUrlState>) => {
    const next = { ...state, ...updates };
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, isReady };
}

export default useStatsUrlState;
