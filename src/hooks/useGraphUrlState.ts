/**
 * URL state for the "/graph" ego explorer.
 *
 * Same principle as the rest of the app — URL is the single source of truth —
 * and its own shape for the same reason `/tier`'s and `/stats`' are. What is
 * specific here is that **the focal node lives in the URL too**, so every step
 * of a browse is a linkable graph rather than a transient client state, and the
 * browser's back button walks back through the path you took.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GRAPH_FOCAL_TYPES, type GraphFocalType } from '@/lib/domain/animeGraph';
import { STAFF_ROLE_TIERS, type StaffRoleTier } from '@/lib/domain/staffRole';

/** What node colour encodes. */
export type GraphColourMode = 'kind' | 'status';

export const GRAPH_COLOUR_MODES: GraphColourMode[] = ['kind', 'status'];

export interface GraphUrlState {
  focalType: GraphFocalType;
  /** Canonical id for an anime, AniList staff id for a person. Empty = show the picker. */
  focalKey: string;
  /** Character roles (`MAIN`/`SUPPORTING`/`BACKGROUND`), empty = all. */
  roles: string[];
  /** Staff tiers. Empty means the API's T1+T2 default. */
  tiers: StaffRoleTier[];
  mediaTypes: string[];
  tag: string;
  /** Only titles carrying an effective status. */
  inList: boolean;
  /**
   * Collapse sibling anime to one node per franchise.
   *
   * A DISPLAY filter, not a different graph: the server always returns per-title
   * nodes (see `animeGraph.ts` on why the node is never a franchise), and this
   * keeps the best-ranked member of each component with a "×N" mark. Off by
   * default — it hides franchise recasts, which are usually what you came for.
   */
  collapseFranchise: boolean;
  colour: GraphColourMode;
}

export const GRAPH_DEFAULTS: GraphUrlState = {
  focalType: 'anime',
  focalKey: '',
  roles: [],
  tiers: [],
  mediaTypes: [],
  tag: '',
  inList: false,
  collapseFranchise: false,
  colour: 'kind',
};

const KEYS = {
  focalType: 't',
  focalKey: 'id',
  roles: 'r',
  tiers: 'ti',
  mediaTypes: 'mt',
  tag: 'tg',
  inList: 'il',
  collapseFranchise: 'fr',
  colour: 'col',
} as const;

const csv = (value: string | null): string[] =>
  (value || '').split(',').map(s => s.trim()).filter(Boolean);

function decode(params: URLSearchParams): GraphUrlState {
  const rawType = params.get(KEYS.focalType) || '';
  const rawColour = params.get(KEYS.colour) || '';
  return {
    // An unknown/hand-edited value falls back rather than rendering nothing —
    // the same tolerance `/stats` applies to its dimension key.
    focalType: GRAPH_FOCAL_TYPES.includes(rawType as GraphFocalType)
      ? (rawType as GraphFocalType)
      : GRAPH_DEFAULTS.focalType,
    focalKey: (params.get(KEYS.focalKey) || '').trim(),
    roles: csv(params.get(KEYS.roles)).map(r => r.toUpperCase()),
    tiers: csv(params.get(KEYS.tiers))
      .map(Number)
      .filter((n): n is StaffRoleTier => STAFF_ROLE_TIERS.includes(n as StaffRoleTier)),
    mediaTypes: csv(params.get(KEYS.mediaTypes)),
    tag: (params.get(KEYS.tag) || '').trim(),
    inList: params.get(KEYS.inList) === '1',
    collapseFranchise: params.get(KEYS.collapseFranchise) === '1',
    colour: GRAPH_COLOUR_MODES.includes(rawColour as GraphColourMode)
      ? (rawColour as GraphColourMode)
      : GRAPH_DEFAULTS.colour,
  };
}

function encode(state: GraphUrlState): string {
  const params = new URLSearchParams();
  if (state.focalType !== GRAPH_DEFAULTS.focalType) params.set(KEYS.focalType, state.focalType);
  if (state.focalKey) params.set(KEYS.focalKey, state.focalKey);
  if (state.roles.length) params.set(KEYS.roles, state.roles.join(','));
  if (state.tiers.length) params.set(KEYS.tiers, state.tiers.join(','));
  if (state.mediaTypes.length) params.set(KEYS.mediaTypes, state.mediaTypes.join(','));
  if (state.tag) params.set(KEYS.tag, state.tag);
  if (state.inList) params.set(KEYS.inList, '1');
  if (state.collapseFranchise) params.set(KEYS.collapseFranchise, '1');
  if (state.colour !== GRAPH_DEFAULTS.colour) params.set(KEYS.colour, state.colour);
  const qs = params.toString().replace(/%2C/g, ',');
  return qs ? `/graph?${qs}` : '/graph';
}

export interface UseGraphUrlStateReturn {
  state: GraphUrlState;
  update: (updates: Partial<GraphUrlState>) => void;
  /**
   * Re-centre on a new node. Filters are deliberately KEPT — you are still
   * asking the same question ("main roles only", "female characters") of a new
   * subject — but it pushes a real history entry rather than replacing, so back
   * retraces the browse.
   */
  recentre: (focalType: GraphFocalType, focalKey: string) => void;
  isReady: boolean;
}

export function useGraphUrlState(): UseGraphUrlStateReturn {
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

  const state = useMemo<GraphUrlState>(() => {
    if (!router.isReady) return { ...GRAPH_DEFAULTS };
    return decode(new URLSearchParams(queryString));
  }, [router.isReady, queryString]);

  const update = useCallback((updates: Partial<GraphUrlState>) => {
    router.push(encode({ ...state, ...updates }), undefined, { shallow: true });
  }, [state, router]);

  const recentre = useCallback((focalType: GraphFocalType, focalKey: string) => {
    // Character roles mean nothing on a staff ego, so they are dropped on that
    // hop rather than silently emptying the graph.
    const next = focalType === 'staff'
      ? { ...state, focalType, focalKey, roles: [] }
      : { ...state, focalType, focalKey };
    router.push(encode(next), undefined, { shallow: true });
  }, [state, router]);

  return { state, update, recentre, isReady };
}

export default useGraphUrlState;
