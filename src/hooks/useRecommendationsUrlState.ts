/**
 * URL state for the dedicated "/recommendations" page.
 *
 * Kept separate from `useAnimeUrlState` on purpose: the feed's state shape is
 * genuinely different (engine knobs + a narrowing subset of filters), and the
 * main hook is coupled to the "/" preset-redirect flow. URL stays the single
 * source of truth, same as the rest of the app — just for a different set of keys.
 */

import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ImageSize, SourceWeights, RecoVerdict } from '@/models/anime';
import { DEFAULT_WEIGHTS, parseSourceWeights, encodeSourceWeights, resolveWeights } from '@/lib/reco/weights';

export interface RecoUrlState {
  /** Engine: include 2-hop edges (damped) in the ranking. */
  nicheMode: boolean;
  /** Engine: ranking-time seed threshold override (null = stored default). */
  threshold: number | null;
  /** Engine: per-source weights (resolved — defaults merged with URL overrides). */
  weights: SourceWeights;
  /** Engine: MMR diversity λ (0 = pure affinity order; null = default 0). */
  diversity: number | null;
  /** Sub-view: show a feedback review list ('up' = bonnes pioches, 'down' = pas pour moi) instead of the feed. */
  review: RecoVerdict | null;
  /** Narrowing filters (shared semantics with the main list). */
  mediaTypes: string[];
  search: string;
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  /** Display. */
  imageSize: ImageSize;
  /** Forced cards per row in card layout; null = adaptive (auto-fill). */
  cardsPerRow: number | null;
}

export const RECO_DEFAULTS: RecoUrlState = {
  nicheMode: false,
  threshold: null,
  weights: DEFAULT_WEIGHTS,
  diversity: null,
  review: null,
  mediaTypes: [],
  search: '',
  minScore: null,
  maxScore: null,
  minYear: 2000,
  maxYear: null,
  imageSize: 3,
  cardsPerRow: null,
};

const KEYS = {
  niche: 'niche',
  threshold: 'thr',
  weights: 'w',
  diversity: 'div',
  review: 'rev',
  mediaType: 'mt',
  search: 'q',
  minScore: 'min',
  maxScore: 'max',
  minYear: 'miny',
  maxYear: 'maxy',
  imageSize: 'img',
  cardsPerRow: 'cpr',
} as const;

function decode(params: URLSearchParams): RecoUrlState {
  const num = (v: string | null): number | null => {
    if (v === null || v.trim() === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    nicheMode: params.get(KEYS.niche) === '1',
    threshold: num(params.get(KEYS.threshold)),
    weights: resolveWeights(parseSourceWeights(params.get(KEYS.weights))),
    diversity: num(params.get(KEYS.diversity)),
    review: params.get(KEYS.review) === 'up' ? 'up' : params.get(KEYS.review) === 'down' ? 'down' : null,
    mediaTypes: (params.get(KEYS.mediaType) || '').split(',').map(s => s.trim()).filter(Boolean),
    search: params.get(KEYS.search) || '',
    minScore: num(params.get(KEYS.minScore)),
    maxScore: num(params.get(KEYS.maxScore)),
    minYear: params.has(KEYS.minYear) ? num(params.get(KEYS.minYear)) : RECO_DEFAULTS.minYear,
    maxYear: num(params.get(KEYS.maxYear)),
    imageSize: (params.has(KEYS.imageSize)
      ? (parseInt(params.get(KEYS.imageSize)!, 10) as ImageSize)
      : RECO_DEFAULTS.imageSize),
    cardsPerRow: (() => {
      const n = num(params.get(KEYS.cardsPerRow));
      return n !== null && n > 0 ? Math.floor(n) : RECO_DEFAULTS.cardsPerRow;
    })(),
  };
}

function encode(state: RecoUrlState): string {
  const params = new URLSearchParams();
  if (state.nicheMode) params.set(KEYS.niche, '1');
  if (state.threshold !== null) params.set(KEYS.threshold, String(state.threshold));
  const wStr = encodeSourceWeights(state.weights);
  if (wStr) params.set(KEYS.weights, wStr);
  if (state.diversity !== null && state.diversity > 0) params.set(KEYS.diversity, String(state.diversity));
  if (state.review) params.set(KEYS.review, state.review);
  if (state.mediaTypes.length > 0) params.set(KEYS.mediaType, state.mediaTypes.join(','));
  if (state.search) params.set(KEYS.search, state.search);
  if (state.minScore !== null) params.set(KEYS.minScore, String(state.minScore));
  if (state.maxScore !== null) params.set(KEYS.maxScore, String(state.maxScore));
  if (state.minYear !== null && state.minYear !== RECO_DEFAULTS.minYear) params.set(KEYS.minYear, String(state.minYear));
  if (state.maxYear !== null) params.set(KEYS.maxYear, String(state.maxYear));
  if (state.imageSize !== RECO_DEFAULTS.imageSize) params.set(KEYS.imageSize, String(state.imageSize));
  if (state.cardsPerRow !== null) params.set(KEYS.cardsPerRow, String(state.cardsPerRow));
  const qs = params.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
  return qs ? `/recommendations?${qs}` : '/recommendations';
}

export interface UseRecommendationsUrlStateReturn {
  state: RecoUrlState;
  update: (updates: Partial<RecoUrlState>) => void;
  isReady: boolean;
}

export function useRecommendationsUrlState(): UseRecommendationsUrlStateReturn {
  const router = useRouter();

  // Deterministic across SSR + first client render (starts false on both) to
  // avoid a hydration mismatch; flips true only after mount once the router is
  // ready. Mirrors useAnimeUrlState's readiness pattern.
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

  const state = useMemo<RecoUrlState>(() => {
    if (!router.isReady) return { ...RECO_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<RecoUrlState>) => {
    const next = { ...state, ...updates };
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, isReady };
}

export default useRecommendationsUrlState;
