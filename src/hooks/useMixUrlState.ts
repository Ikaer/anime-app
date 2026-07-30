/**
 * URL state for the "/mix" page — recommendations anchored on a hand-picked set.
 *
 * Its own hook for the reason `/recommendations`, `/tier` and `/graph` have
 * theirs: the state shape is genuinely different (a chosen anchor SET plus the
 * narrowing filters), and it has no business in `AnimeFiltersState`. The anchors
 * live in the URL like everything else, so a mix is bookmarkable and shareable
 * and the back button retraces which titles were picked.
 *
 * Weights resolve against `ANCHORED_WEIGHTS` rather than the feed's defaults —
 * this page ranks with the anchored base, so the URL must encode diffs from the
 * same base or it would always carry the two zeroed sources.
 */

import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SourceWeights } from '@/models/anime';
import { ANCHORED_WEIGHTS, parseSourceWeights, encodeSourceWeights, resolveWeights } from '@/lib/reco/weights';

export interface MixUrlState {
  /** Canonical ids of the picked anime, in pick order. The whole point of the page. */
  anchors: string[];
  /** Engine: per-source weights (anchored base merged with URL overrides). */
  weights: SourceWeights;
  /** Keep titles already watched in the results (off by default). */
  includeSeen: boolean;
  /** Narrowing filters (shared semantics with the main list). */
  mediaTypes: string[];
  search: string;
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  /** MAL genre names (all three axes in one list) — AND semantics, empty = no filter. */
  genres: string[];
  /** Forced cards per row in card layout; null = adaptive (auto-fill). */
  cardsPerRow: number | null;
}

/**
 * No `minYear` default, unlike the feed: a mix anchored on classics must not
 * silently drop everything before 2000.
 */
export const MIX_DEFAULTS: MixUrlState = {
  anchors: [],
  weights: ANCHORED_WEIGHTS,
  includeSeen: false,
  mediaTypes: [],
  search: '',
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  genres: [],
  cardsPerRow: null,
};

const KEYS = {
  anchors: 'a',
  weights: 'w',
  includeSeen: 'seen',
  mediaType: 'mt',
  search: 'q',
  minScore: 'min',
  maxScore: 'max',
  minYear: 'miny',
  maxYear: 'maxy',
  genres: 'g',
  cardsPerRow: 'cpr',
} as const;

const list = (v: string | null): string[] => (v || '').split(',').map(s => s.trim()).filter(Boolean);

function decode(params: URLSearchParams): MixUrlState {
  const num = (v: string | null): number | null => {
    if (v === null || v.trim() === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    anchors: list(params.get(KEYS.anchors)),
    weights: resolveWeights(parseSourceWeights(params.get(KEYS.weights)), ANCHORED_WEIGHTS),
    includeSeen: params.get(KEYS.includeSeen) === '1',
    mediaTypes: list(params.get(KEYS.mediaType)),
    search: params.get(KEYS.search) || '',
    minScore: num(params.get(KEYS.minScore)),
    maxScore: num(params.get(KEYS.maxScore)),
    minYear: num(params.get(KEYS.minYear)),
    maxYear: num(params.get(KEYS.maxYear)),
    genres: list(params.get(KEYS.genres)),
    cardsPerRow: (() => {
      const n = num(params.get(KEYS.cardsPerRow));
      return n !== null && n > 0 ? Math.floor(n) : MIX_DEFAULTS.cardsPerRow;
    })(),
  };
}

function encode(state: MixUrlState): string {
  const params = new URLSearchParams();
  if (state.anchors.length > 0) params.set(KEYS.anchors, state.anchors.join(','));
  const wStr = encodeSourceWeights(state.weights, ANCHORED_WEIGHTS);
  if (wStr) params.set(KEYS.weights, wStr);
  if (state.includeSeen) params.set(KEYS.includeSeen, '1');
  if (state.mediaTypes.length > 0) params.set(KEYS.mediaType, state.mediaTypes.join(','));
  if (state.search) params.set(KEYS.search, state.search);
  if (state.minScore !== null) params.set(KEYS.minScore, String(state.minScore));
  if (state.maxScore !== null) params.set(KEYS.maxScore, String(state.maxScore));
  if (state.minYear !== null) params.set(KEYS.minYear, String(state.minYear));
  if (state.maxYear !== null) params.set(KEYS.maxYear, String(state.maxYear));
  if (state.genres.length > 0) params.set(KEYS.genres, state.genres.join(','));
  if (state.cardsPerRow !== null) params.set(KEYS.cardsPerRow, String(state.cardsPerRow));
  const qs = params.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
  return qs ? `/mix?${qs}` : '/mix';
}

export interface UseMixUrlStateReturn {
  state: MixUrlState;
  update: (updates: Partial<MixUrlState>) => void;
  /** Add an anchor (no-op when already picked or at the cap). */
  addAnchor: (id: string) => void;
  removeAnchor: (id: string) => void;
  isReady: boolean;
}

/** Mirrors the API route's own guard — kept in sync by hand, one constant each side. */
export const MAX_ANCHORS = 12;

export function useMixUrlState(): UseMixUrlStateReturn {
  const router = useRouter();

  // Deterministic across SSR + first client render (false on both), flipping
  // true after mount — same readiness pattern as the other page hooks.
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

  const state = useMemo<MixUrlState>(() => {
    if (!router.isReady) return { ...MIX_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<MixUrlState>) => {
    const next = { ...state, ...updates };
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  const addAnchor = useCallback((id: string) => {
    if (state.anchors.includes(id) || state.anchors.length >= MAX_ANCHORS) return;
    update({ anchors: [...state.anchors, id] });
  }, [state.anchors, update]);

  const removeAnchor = useCallback((id: string) => {
    update({ anchors: state.anchors.filter(a => a !== id) });
  }, [state.anchors, update]);

  return { state, update, addAnchor, removeAnchor, isReady };
}

export default useMixUrlState;
