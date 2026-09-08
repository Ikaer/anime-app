/**
 * URL state for `/boxes/[id]` — one box, three tabs.
 *
 * The dynamic `id` segment is part of the PATH, not of this state: it names
 * which box, never how it is being looked at. So `encode` rebuilds the path from
 * the id it is given and this hook owns only the query string, the same split
 * every other per-page hook here makes.
 *
 * ⚠️ **Quick edit is a MODE on présentation, not a fourth tab** (§6.2). "What is
 * this box" stays the page's answer; filling it is something you do to that
 * answer — hence `edit` as a flag beside `tab`, never a fourth value of it.
 *
 * ⚠️ It replaced a hook of the same name at the swap (§2) and does NOT carry its
 * `v`/`cpr` keys, so an old bookmark loses its view and its cards-per-row
 * override. That is the explicitly accepted cost of the rename: there is one
 * user and the old URLs can break. `seen` survives but INVERTED — see below.
 */
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useViewDefaults } from '@/hooks/useViewDefaults';

/** `pres` says what the box is, `recos` is what it is FOR, `excluded` is the undo list. */
export type BoxTab = 'pres' | 'recos' | 'excluded';

const TABS: BoxTab[] = ['pres', 'recos', 'excluded'];

export interface BoxUrlState {
  tab: BoxTab;
  /** Quick-edit mode on présentation. Meaningless on the other two tabs. */
  edit: boolean;
  /**
   * Keep already-watched titles in the recos feed.
   *
   * ⚠️ **Defaults ON here, the opposite of `/mix` and of the page this replaced**, and
   * that is the sharpest change in the revamp (§6.3). With seen titles in, every
   * card is a QUESTION about the box — « Oui, c'est ça » files it, « Non » sets
   * it aside — which turns this tab into a labeling surface. It is the only fill
   * mechanism that works for a FORM axis, because the crowd graph encodes tone
   * even though no catalog field does. Once a box is well labeled, turning it
   * off gives actual watch suggestions, which is why the checkbox stays.
   */
  includeSeen: boolean;
  /**
   * Forced cards per row in the recos feed; null = adaptive.
   *
   * ⚠️ **Not a URL key — a `ViewDefaults` value**, the same as on `/` and
   * `/recommendations`. It says how the grid LOOKS, not which anime are shown,
   * so it is stored server-side under `settings.json.viewDefaults` and shared
   * across every card grid in the app. The v1 box page carried it as a `cpr`
   * param, which was out of step and would have made
   * `DisplaySection`'s own tooltip — « Enregistré comme valeur par défaut, sur
   * toutes les pages » — untrue on this one page. ⚠️ A `cpr=` in an old bookmark
   * is therefore ignored rather than honoured.
   */
  cardsPerRow: number | null;
}

export const BOX_DEFAULTS: BoxUrlState = {
  tab: 'pres',
  edit: false,
  includeSeen: true,
  cardsPerRow: null,
};

const KEYS = { tab: 't', edit: 'e', includeSeen: 'seen' } as const;

function decode(params: URLSearchParams, cardsPerRow: number | null): BoxUrlState {
  const tab = params.get(KEYS.tab);
  return {
    tab: TABS.includes(tab as BoxTab) ? (tab as BoxTab) : BOX_DEFAULTS.tab,
    edit: params.get(KEYS.edit) === '1',
    // ⚠️ The default is ON, so the URL carries the OFF case — `seen=0`, not
    // `seen=1`. Reading this as `=== '1'` would silently invert the flip §6.3
    // is about.
    includeSeen: params.get(KEYS.includeSeen) !== '0',
    cardsPerRow,
  };
}

function encode(boxId: string, state: BoxUrlState): string {
  const params = new URLSearchParams();
  // `pres` is the default and stays out of the URL.
  if (state.tab !== BOX_DEFAULTS.tab) params.set(KEYS.tab, state.tab);
  // Only meaningful on présentation, so it never rides along to another tab.
  if (state.edit && state.tab === 'pres') params.set(KEYS.edit, '1');
  // Written only when it differs from the default, which here means when it is OFF.
  if (!state.includeSeen) params.set(KEYS.includeSeen, '0');
  const qs = params.toString();
  const path = `/boxes/${encodeURIComponent(boxId)}`;
  return qs ? `${path}?${qs}` : path;
}

export interface UseBoxUrlStateReturn {
  /** The box id from the path. Empty until the router is ready. */
  boxId: string;
  state: BoxUrlState;
  update: (updates: Partial<BoxUrlState>) => void;
  /** Persist the cards-per-row default (shared with `/`, `/recommendations`, `/mix`). */
  setCardsPerRow: (value: number | null) => void;
  isReady: boolean;
}

export function useBoxUrlState(): UseBoxUrlStateReturn {
  const router = useRouter();
  const { defaults, save } = useViewDefaults();

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
    if (!router.isReady) return { ...BOX_DEFAULTS, cardsPerRow: defaults.cardsPerRow };
    return decode(new URLSearchParams(queryString), defaults.cardsPerRow);
  }, [router.isReady, queryString, defaults.cardsPerRow]);

  const update = useCallback((updates: Partial<BoxUrlState>) => {
    router.push(encode(boxId, { ...state, ...updates }), undefined, { shallow: true });
  }, [state, router, boxId]);

  const setCardsPerRow = useCallback((cardsPerRow: number | null) => {
    save({ cardsPerRow });
  }, [save]);

  return { boxId, state, update, setCardsPerRow, isReady };
}

export default useBoxUrlState;
