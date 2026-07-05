/**
 * URL state for the dedicated "/tier" rating board.
 *
 * Same principle as the rest of the app — URL is the single source of truth —
 * kept separate from useAnimeUrlState/useRecommendationsUrlState because the
 * tier board's state is its own small shape: the shared narrowing filters plus
 * a thumbnail size. Mirrors useRecommendationsUrlState's readiness pattern.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageSize } from '@/models/anime';

export interface TierUrlState {
  search: string;
  mediaTypes: string[];
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  /** Thumbnail size for the board (small by default — hover zooms to large). */
  thumbSize: ImageSize;
}

export const TIER_DEFAULTS: TierUrlState = {
  search: '',
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  thumbSize: 1,
};

const KEYS = {
  search: 'q',
  mediaType: 'mt',
  minScore: 'min',
  maxScore: 'max',
  minYear: 'miny',
  maxYear: 'maxy',
  thumbSize: 'ts',
} as const;

function decode(params: URLSearchParams): TierUrlState {
  const num = (v: string | null): number | null => {
    if (v === null || v.trim() === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    search: params.get(KEYS.search) || '',
    mediaTypes: (params.get(KEYS.mediaType) || '').split(',').map(s => s.trim()).filter(Boolean),
    minScore: num(params.get(KEYS.minScore)),
    maxScore: num(params.get(KEYS.maxScore)),
    minYear: num(params.get(KEYS.minYear)),
    maxYear: num(params.get(KEYS.maxYear)),
    thumbSize: params.has(KEYS.thumbSize)
      ? (parseInt(params.get(KEYS.thumbSize)!, 10) as ImageSize)
      : TIER_DEFAULTS.thumbSize,
  };
}

function encode(state: TierUrlState): string {
  const params = new URLSearchParams();
  if (state.search) params.set(KEYS.search, state.search);
  if (state.mediaTypes.length > 0) params.set(KEYS.mediaType, state.mediaTypes.join(','));
  if (state.minScore !== null) params.set(KEYS.minScore, String(state.minScore));
  if (state.maxScore !== null) params.set(KEYS.maxScore, String(state.maxScore));
  if (state.minYear !== null) params.set(KEYS.minYear, String(state.minYear));
  if (state.maxYear !== null) params.set(KEYS.maxYear, String(state.maxYear));
  if (state.thumbSize !== TIER_DEFAULTS.thumbSize) params.set(KEYS.thumbSize, String(state.thumbSize));
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/tier?${qs}` : '/tier';
}

export interface UseTierUrlStateReturn {
  state: TierUrlState;
  update: (updates: Partial<TierUrlState>) => void;
  isReady: boolean;
}

export function useTierUrlState(): UseTierUrlStateReturn {
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

  const state = useMemo<TierUrlState>(() => {
    if (!router.isReady) return { ...TIER_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<TierUrlState>) => {
    const next = { ...state, ...updates };
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, isReady };
}

export default useTierUrlState;
