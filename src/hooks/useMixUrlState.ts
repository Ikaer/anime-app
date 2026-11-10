/**
 * URL state for the "/mix" page — recommendations anchored on a hand-picked set.
 *
 * Its own hook for the reason `/recommendations` and `/tier` have
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
import useViewDefaults from '@/hooks/useViewDefaults';
import {
  decodeNarrowing, encodeNarrowing, parseUrlList, NARROWING_FIELDS, type NarrowingUrlState,
} from '@/lib/url/narrowingParams';

/** The narrowing filters (`NarrowingUrlState`) share semantics with the main list. */
export interface MixUrlState extends NarrowingUrlState {
  /** Canonical ids of the picked anime, in pick order. The whole point of the page. */
  anchors: string[];
  /** Engine: per-source weights (anchored base merged with URL overrides). */
  weights: SourceWeights;
  /** Keep titles already watched in the results (off by default). */
  includeSeen: boolean;
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
} as const;

function decode(params: URLSearchParams, cardsPerRow: number | null): MixUrlState {
  return {
    anchors: parseUrlList(params.get(KEYS.anchors)),
    weights: resolveWeights(parseSourceWeights(params.get(KEYS.weights)), ANCHORED_WEIGHTS),
    includeSeen: params.get(KEYS.includeSeen) === '1',
    ...decodeNarrowing(params, NARROWING_FIELDS),
    cardsPerRow,
  };
}

function encode(state: MixUrlState): string {
  const params = new URLSearchParams();
  if (state.anchors.length > 0) params.set(KEYS.anchors, state.anchors.join(','));
  const wStr = encodeSourceWeights(state.weights, ANCHORED_WEIGHTS);
  if (wStr) params.set(KEYS.weights, wStr);
  if (state.includeSeen) params.set(KEYS.includeSeen, '1');
  encodeNarrowing(params, state, NARROWING_FIELDS);
  const qs = params.toString().replace(/%2C/g, ',').replace(/%3A/g, ':');
  return qs ? `/mix?${qs}` : '/mix';
}

export interface UseMixUrlStateReturn {
  state: MixUrlState;
  update: (updates: Partial<MixUrlState>) => void;
  /** Add an anchor (no-op when already picked or at the cap). */
  addAnchor: (id: string) => void;
  removeAnchor: (id: string) => void;
  /** Persist the cards-per-row default (shared with `/` and `/recommendations`). */
  setCardsPerRow: (value: number | null) => void;
  isReady: boolean;
}

/** Mirrors the API route's own guard — kept in sync by hand, one constant each side. */
export const MAX_ANCHORS = 12;

export function useMixUrlState(): UseMixUrlStateReturn {
  const router = useRouter();
  const { defaults, save } = useViewDefaults();

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
    if (!router.isReady) return { ...MIX_DEFAULTS, cardsPerRow: defaults.cardsPerRow };
    return decode(new URLSearchParams(queryString), defaults.cardsPerRow);
  }, [router.isReady, queryString, defaults.cardsPerRow]);

  const update = useCallback((updates: Partial<MixUrlState>) => {
    const next = { ...state, ...updates };
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  const setCardsPerRow = useCallback((cardsPerRow: number | null) => {
    save({ cardsPerRow });
  }, [save]);

  const addAnchor = useCallback((id: string) => {
    if (state.anchors.includes(id) || state.anchors.length >= MAX_ANCHORS) return;
    update({ anchors: [...state.anchors, id] });
  }, [state.anchors, update]);

  const removeAnchor = useCallback((id: string) => {
    update({ anchors: state.anchors.filter(a => a !== id) });
  }, [state.anchors, update]);

  return { state, update, addAnchor, removeAnchor, setCardsPerRow, isReady };
}

export default useMixUrlState;
