/**
 * URL state for `/profiles/[id]` — what the profile is being TESTED against.
 *
 * ⚠️ **Only the preview's context, never the weights.** The weights are the
 * profile itself — stored state, saved on every slider release (`updateProfile`
 * replaces the map) — so carrying them in the URL would give one weighting two
 * homes that can disagree. What the URL says is "tested against this box, on
 * this pool", which is view state and bookmarkable like any other.
 *
 * The anchor is a box (`box`) XOR an ad-hoc set (`a` — `/mix`'s key, so a mix
 * becomes a profile test by carrying its own query string over). Setting one
 * clears the other: the preview route refuses both at once.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PREVIEW_POOLS, type PreviewPool } from '@/lib/reco/profileWeights';

export interface ProfileUrlState {
  /** The box the preview anchors on, or null. */
  box: string | null;
  /** …or a hand-picked set, in pick order. Empty unless `box` is null. */
  anchors: string[];
  /** `catalog` (default), `statused`, or `anchored` — the one reaching MAL / AniList. */
  pool: PreviewPool;
}

export const PROFILE_URL_DEFAULTS: ProfileUrlState = { box: null, anchors: [], pool: 'catalog' };

const KEYS = { box: 'box', anchors: 'a', pool: 'pool' } as const;

function decode(params: URLSearchParams): ProfileUrlState {
  const box = params.get(KEYS.box)?.trim() || null;
  const pool = params.get(KEYS.pool);
  return {
    box,
    anchors: box ? [] : (params.get(KEYS.anchors) || '').split(',').map(s => s.trim()).filter(Boolean),
    pool: PREVIEW_POOLS.includes(pool as PreviewPool) ? (pool as PreviewPool) : PROFILE_URL_DEFAULTS.pool,
  };
}

/** The query string alone — the list page carries it onto every profile link. */
export function toProfileQuery(state: ProfileUrlState): string {
  const params = new URLSearchParams();
  if (state.box) params.set(KEYS.box, state.box);
  else if (state.anchors.length > 0) params.set(KEYS.anchors, state.anchors.join(','));
  if (state.pool !== PROFILE_URL_DEFAULTS.pool) params.set(KEYS.pool, state.pool);
  return params.toString().replace(/%2C/g, ',');
}

export interface UseProfileUrlStateReturn {
  /** The profile id from the path. Empty until the router is ready. */
  profileId: string;
  state: ProfileUrlState;
  update: (updates: Partial<ProfileUrlState>) => void;
  isReady: boolean;
}

export function useProfileUrlState(): UseProfileUrlStateReturn {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (router.isReady) setIsReady(true);
  }, [router.isReady]);

  const profileId = typeof router.query.id === 'string' ? router.query.id : '';

  const queryString = useMemo(() => {
    if (!router.isReady) return '';
    const params = new URLSearchParams();
    Object.entries(router.query).forEach(([key, value]) => {
      // `id` is the path segment, not a query key — `useBoxUrlState`'s rule.
      if (key !== 'id' && typeof value === 'string') params.set(key, value);
    });
    params.sort();
    return params.toString();
  }, [router.isReady, router.query]);

  const state = useMemo<ProfileUrlState>(
    () => (router.isReady ? decode(new URLSearchParams(queryString)) : PROFILE_URL_DEFAULTS),
    [router.isReady, queryString]
  );

  const update = useCallback((updates: Partial<ProfileUrlState>) => {
    const next = { ...state, ...updates };
    // Box XOR anchors: whichever this update names wins.
    if (updates.box) next.anchors = [];
    else if (updates.anchors) next.box = null;
    const qs = toProfileQuery(next);
    const path = `/profiles/${encodeURIComponent(profileId)}`;
    router.push(qs ? `${path}?${qs}` : path, undefined, { shallow: true });
  }, [state, router, profileId]);

  return { profileId, state, update, isReady };
}

/** Decode a plain query object — the list page's view of the same keys. */
export function decodeProfileQuery(query: Record<string, string | string[] | undefined>): ProfileUrlState {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (typeof value === 'string') params.set(key, value); });
  return decode(params);
}

export default useProfileUrlState;
