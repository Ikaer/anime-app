/**
 * URL state for the dedicated "/stats" repartition page.
 *
 * Same principle as the rest of the app — URL is the single source of truth —
 * and kept separate from the other page hooks for the same reason theirs are:
 * this page's state is its own small shape. It is nearly the leanest of them
 * all: which statuses are in scope, which score range, and which dimension is on
 * screen.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { STATS_DIMENSIONS, type StatsDimension } from '@/lib/domain/stats';

export interface StatsUrlState {
  /** Effective (SIMKL-first) personal status — OR semantics, empty = every statused title. */
  statuses: string[];
  /**
   * Bounds on the OWNER'S OWN score (1-10), `null` = unbounded. Either bound set
   * drops unrated titles — see `ComputeStatsOptions`.
   */
  minMyScore: number | null;
  maxMyScore: number | null;
  /** The dimension currently displayed. */
  dimension: StatsDimension;
}

export const STATS_DEFAULTS: StatsUrlState = {
  statuses: [],
  minMyScore: null,
  maxMyScore: null,
  dimension: 'studios',
};

// `min`/`max` are taken elsewhere in the app for the COMMUNITY mean; this page
// only ever filters on the owner's own score, and the keys say so.
const KEYS = {
  statuses: 'st',
  minMyScore: 'smin',
  maxMyScore: 'smax',
  dimension: 'dim',
} as const;

/** A hand-edited or out-of-range bound reads as unbounded rather than as zero. */
function decodeScore(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

function decode(params: URLSearchParams): StatsUrlState {
  const rawDimension = params.get(KEYS.dimension) || '';
  return {
    statuses: (params.get(KEYS.statuses) || '').split(',').map(s => s.trim()).filter(Boolean),
    minMyScore: decodeScore(params.get(KEYS.minMyScore)),
    maxMyScore: decodeScore(params.get(KEYS.maxMyScore)),
    // An unknown/hand-edited dimension falls back rather than rendering nothing.
    dimension: STATS_DIMENSIONS.includes(rawDimension as StatsDimension)
      ? (rawDimension as StatsDimension)
      : STATS_DEFAULTS.dimension,
  };
}

function encode(state: StatsUrlState): string {
  const params = new URLSearchParams();
  if (state.statuses.length > 0) params.set(KEYS.statuses, state.statuses.join(','));
  if (state.minMyScore != null) params.set(KEYS.minMyScore, String(state.minMyScore));
  if (state.maxMyScore != null) params.set(KEYS.maxMyScore, String(state.maxMyScore));
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
