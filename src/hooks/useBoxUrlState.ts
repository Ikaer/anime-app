/**
 * URL state for "/boxes/[id]" — one box, three views.
 *
 * The dynamic `id` segment is part of the PATH, not of this state: it names
 * which box, never how it is being looked at. So `encode` rebuilds the path from
 * the id it is given and this hook only owns the query string, the same split
 * every other per-page hook here makes.
 *
 * `feed` is the only view with knobs of its own (`seen`, `cardsPerRow`) because
 * it is the only one that ranks anything. `grow` and `members` are lists whose
 * order is fixed by the engine and by airing date respectively — a sort control
 * on either would contradict the view, the same reasoning that keeps `sort` off
 * `/recommendations` and `/activity`.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** `grow` fills the box, `members` audits it, `feed` is what the box is FOR. */
export type BoxView = 'grow' | 'members' | 'feed';

const VIEWS: BoxView[] = ['grow', 'members', 'feed'];

export interface BoxUrlState {
  view: BoxView;
  /** Keep already-watched titles in the box's feed (off by default). */
  includeSeen: boolean;
  /** Forced cards per row in the feed view; null = adaptive. */
  cardsPerRow: number | null;
}

export const BOX_DEFAULTS: BoxUrlState = {
  view: 'grow',
  includeSeen: false,
  cardsPerRow: null,
};

const KEYS = {
  view: 'v',
  includeSeen: 'seen',
  cardsPerRow: 'cpr',
} as const;

function decode(params: URLSearchParams): BoxUrlState {
  const v = params.get(KEYS.view);
  const cpr = params.get(KEYS.cardsPerRow);
  const n = cpr === null ? NaN : parseInt(cpr, 10);
  return {
    view: VIEWS.includes(v as BoxView) ? (v as BoxView) : BOX_DEFAULTS.view,
    includeSeen: params.get(KEYS.includeSeen) === '1',
    cardsPerRow: Number.isFinite(n) && n > 0 ? n : null,
  };
}

function encode(boxId: string, state: BoxUrlState): string {
  const params = new URLSearchParams();
  // `grow` is the default view and stays out of the URL.
  if (state.view !== BOX_DEFAULTS.view) params.set(KEYS.view, state.view);
  if (state.includeSeen) params.set(KEYS.includeSeen, '1');
  if (state.cardsPerRow !== null) params.set(KEYS.cardsPerRow, String(state.cardsPerRow));
  const qs = params.toString();
  return qs ? `/boxes/${encodeURIComponent(boxId)}?${qs}` : `/boxes/${encodeURIComponent(boxId)}`;
}

export interface UseBoxUrlStateReturn {
  /** The box id from the path. Empty until the router is ready. */
  boxId: string;
  state: BoxUrlState;
  update: (updates: Partial<BoxUrlState>) => void;
  isReady: boolean;
}

export function useBoxUrlState(): UseBoxUrlStateReturn {
  const router = useRouter();

  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (router.isReady) setIsReady(true);
  }, [router.isReady]);

  const boxId = typeof router.query.id === 'string' ? router.query.id : '';

  const queryString = useMemo(() => {
    if (!router.isReady) return '';
    const params = new URLSearchParams();
    Object.entries(router.query).forEach(([key, value]) => {
      // `id` is the path segment, not a query key — including it would echo it
      // back into the query string on the first update.
      if (key !== 'id' && typeof value === 'string') params.set(key, value);
    });
    params.sort();
    return params.toString();
  }, [router.isReady, router.query]);

  const state = useMemo<BoxUrlState>(() => {
    if (!router.isReady) return { ...BOX_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<BoxUrlState>) => {
    router.push(encode(boxId, { ...state, ...updates }), undefined, { shallow: true });
  }, [state, router, boxId]);

  return { boxId, state, update, isReady };
}

export default useBoxUrlState;
