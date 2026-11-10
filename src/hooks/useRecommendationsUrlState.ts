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
import { SourceWeights } from '@/models/anime';
import { DEFAULT_WEIGHTS, parseSourceWeights, encodeSourceWeights, resolveWeights } from '@/lib/reco/weights';
import useViewDefaults from '@/hooks/useViewDefaults';
import {
  decodeNarrowing, encodeNarrowing, parseUrlNumber, NARROWING_DEFAULTS, NARROWING_FIELDS,
  NARROWING_URL_KEYS, type NarrowingUrlState,
} from '@/lib/url/narrowingParams';

/** The narrowing filters (`NarrowingUrlState`) share semantics with the main list. */
export interface RecoUrlState extends NarrowingUrlState {
  /** Engine: include 2-hop edges (damped) in the ranking. */
  nicheMode: boolean;
  /** Engine: ranking-time seed threshold override (null = stored default). */
  threshold: number | null;
  /** Engine: per-source weights (resolved — defaults merged with URL overrides). */
  weights: SourceWeights;
  /** Engine: MMR diversity λ (0 = pure affinity order; null = default 0). */
  diversity: number | null;
  /** Sub-view: show the « Ignorés » review-and-undo list instead of the feed. */
  review: boolean;
  /**
   * « Seconde chance »: rank the owner's DROPPED titles instead of the unseen
   * ones. Same engine and knobs; only the population changes. A review list
   * (`review`) wins over it — both are ways out of the feed.
   */
  secondChance: boolean;
  /**
   * « Anime court »: a known run of <= QUICK_MAX_EPISODES episodes AND no
   * sequel/prequel in the catalog. A narrowing filter like the rest of this
   * block, but it needs the relation graph, so it is applied server-side rather
   * than through `applyNarrowingFilters` (see `domain/quickAnime.ts`).
   */
  quick: boolean;
  /**
   * Forced cards per row; null = adaptive. NOT a URL key — it is a view default
   * (see lib/url/viewDefaults.ts), merged in here so the page reads one state
   * object. The `cpr` param was removed along with `/`'s.
   */
  cardsPerRow: number | null;
}

export const RECO_DEFAULTS: RecoUrlState = {
  nicheMode: false,
  threshold: null,
  weights: DEFAULT_WEIGHTS,
  diversity: null,
  review: false,
  secondChance: false,
  ...NARROWING_DEFAULTS,
  minYear: 2000,
  quick: false,
  cardsPerRow: null,
};

const KEYS = {
  niche: 'niche',
  threshold: 'thr',
  weights: 'w',
  diversity: 'div',
  review: 'rev',
  secondChance: 'sc',
  quick: 'qk',
} as const;

function decode(params: URLSearchParams, cardsPerRow: number | null): RecoUrlState {
  const num = parseUrlNumber;
  return {
    nicheMode: params.get(KEYS.niche) === '1',
    threshold: num(params.get(KEYS.threshold)),
    weights: resolveWeights(parseSourceWeights(params.get(KEYS.weights))),
    diversity: num(params.get(KEYS.diversity)),
    review: params.get(KEYS.review) === '1',
    secondChance: params.get(KEYS.secondChance) === '1',
    // An absent `miny` falls back to the feed's 2000 default.
    ...decodeNarrowing(params, NARROWING_FIELDS, RECO_DEFAULTS),
    quick: params.get(KEYS.quick) === '1',
    cardsPerRow,
  };
}

function encode(state: RecoUrlState): string {
  const params = new URLSearchParams();
  if (state.nicheMode) params.set(KEYS.niche, '1');
  if (state.threshold !== null) params.set(KEYS.threshold, String(state.threshold));
  const wStr = encodeSourceWeights(state.weights);
  if (wStr) params.set(KEYS.weights, wStr);
  if (state.diversity !== null && state.diversity > 0) params.set(KEYS.diversity, String(state.diversity));
  if (state.review) params.set(KEYS.review, '1');
  if (state.secondChance) params.set(KEYS.secondChance, '1');
  encodeNarrowing(params, state, NARROWING_FIELDS, NARROWING_URL_KEYS, RECO_DEFAULTS);
  if (state.quick) params.set(KEYS.quick, '1');
  const qs = params.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
  return qs ? `/recommendations?${qs}` : '/recommendations';
}

export interface UseRecommendationsUrlStateReturn {
  state: RecoUrlState;
  update: (updates: Partial<RecoUrlState>) => void;
  /** Persist the cards-per-row default (shared with `/` and `/mix`). */
  setCardsPerRow: (value: number | null) => void;
  isReady: boolean;
}

export function useRecommendationsUrlState(): UseRecommendationsUrlStateReturn {
  const router = useRouter();
  const { defaults, save } = useViewDefaults();

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
    if (!router.isReady) return { ...RECO_DEFAULTS, cardsPerRow: defaults.cardsPerRow };
    return decode(new URLSearchParams(queryString), defaults.cardsPerRow);
  }, [router.isReady, queryString, defaults.cardsPerRow]);

  const update = useCallback((updates: Partial<RecoUrlState>) => {
    const next = { ...state, ...updates };
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  const setCardsPerRow = useCallback((cardsPerRow: number | null) => {
    save({ cardsPerRow });
  }, [save]);

  return { state, update, setCardsPerRow, isReady };
}

export default useRecommendationsUrlState;
