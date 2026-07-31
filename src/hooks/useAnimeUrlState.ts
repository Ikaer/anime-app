/**
 * Hook for managing anime page state via URL query parameters
 *
 * The URL is the single source of truth for FILTERS. This hook:
 * - Redirects empty URLs to the user's landing view (preset + filter defaults)
 * - Parses URL params into filter state
 * - Provides update functions that modify the URL via router.push
 *
 * Display state (cards per row, sidebar sections) is NOT in the URL — it comes
 * from the user's view defaults (see lib/url/viewDefaults.ts). It is returned
 * here anyway, as one `display` block, so pages have a single place to read
 * view state from.
 */

import { useRouter } from 'next/router';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AnimeFiltersState,
  AnimeDisplayState,
  AnimeUrlState,
  decodeUrlToState,
  encodeStateToUrl,
  hasAnyParams,
  getDefaultViewUrl,
  withFilterDefaults,
  DEFAULT_FILTERS,
  PERSISTENT_UI_KEYS,
} from '@/lib/url/animeParams';
import useViewDefaults from '@/hooks/useViewDefaults';

export interface UseAnimeUrlStateReturn {
  filters: AnimeFiltersState;
  display: AnimeDisplayState;
  updateFilters: (updates: Partial<AnimeFiltersState>) => void;
  updateState: (updates: Partial<AnimeUrlState>) => void;
  applyPreset: (presetState: Partial<AnimeUrlState>) => void;
  /**
   * Set the sidebar's expanded sections. This saves a DEFAULT rather than
   * pushing a URL — "which sections are open" is a preference nobody wants to
   * re-declare per bookmark, which is why `sb` is gone.
   */
  setSidebarExpanded: (expanded: Record<string, boolean>) => void;
  /** Set the cards-per-row default. Same rule as above; `cpr` is gone too. */
  setCardsPerRow: (value: number | null) => void;
  isReady: boolean;
}

export function useAnimeUrlState(): UseAnimeUrlStateReturn {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [hasRedirected, setHasRedirected] = useState(false);
  const { defaults, loaded: defaultsLoaded, save } = useViewDefaults();

  // Serialize query to string for stable dependency comparison
  const queryString = useMemo(() => {
    if (!router.isReady) return '';
    const params = new URLSearchParams();
    Object.entries(router.query).forEach(([key, value]) => {
      if (typeof value === 'string') {
        params.set(key, value);
      }
    });
    // Sort keys for consistent ordering
    params.sort();
    return params.toString();
  }, [router.isReady, router.query]);

  // Parse current URL state - use queryString as stable dependency
  const currentState = useMemo((): AnimeUrlState => {
    if (!router.isReady) {
      return { ...DEFAULT_FILTERS };
    }

    const params = new URLSearchParams(queryString);
    return decodeUrlToState(params);
  }, [router.isReady, queryString]);

  // Handle redirect for empty URLs
  useEffect(() => {
    if (!router.isReady) return;

    const params = new URLSearchParams(queryString);

    // Check if we're on /anime with no recognized params
    if (router.pathname === '/' && !hasAnyParams(params)) {
      // Check for legacy 'auth' param (OAuth callback) - don't redirect if present
      if (!params.has('auth') && !params.has('simkl_auth') && !hasRedirected) {
        // WAIT for the stored defaults. Redirecting first would land on the
        // shipped preset and latch `hasRedirected`, so the user's own landing
        // view would never be applied on the one URL it exists for.
        if (!defaultsLoaded) return;
        setHasRedirected(true);
        router.push(getDefaultViewUrl(defaults));
        return;
      }
    }

    // Set ready once we have valid params (either initially or after redirect)
    if (!isReady && hasAnyParams(params)) {
      setIsReady(true);
    }
  }, [router.isReady, router.pathname, queryString, hasRedirected, isReady, router, defaults, defaultsLoaded]);

  // Update filters and push to URL
  const updateFilters = useCallback((updates: Partial<AnimeFiltersState>) => {
    const newState: AnimeUrlState = {
      ...currentState,
      ...updates,
    };
    router.push(encodeStateToUrl(newState), undefined, { shallow: true });
  }, [currentState, router]);

  // Update any state and push to URL
  const updateState = useCallback((updates: Partial<AnimeUrlState>) => {
    const newState: AnimeUrlState = {
      ...currentState,
      ...updates,
    };
    router.push(encodeStateToUrl(newState), undefined, { shallow: true });
  }, [currentState, router]);

  // Apply a preset while preserving persistent filter keys
  const applyPreset = useCallback((presetState: Partial<AnimeUrlState>) => {
    // 1. Capture current persistent values
    const currentPersistentState: Partial<AnimeUrlState> = {};
    PERSISTENT_UI_KEYS.forEach(key => {
      if (currentState[key] !== undefined) {
        (currentPersistentState as any)[key] = currentState[key];
      }
    });

    // 2. Baseline -> Persistent -> Preset -> the user's filter defaults, which
    //    layer ON TOP for the same reason they do on the landing URL: four
    //    presets pin `mediaTypes`, and a default underneath would be shadowed
    //    exactly where it matters. Sparse, so an unset key leaves the preset be.
    const newState = withFilterDefaults(
      {
        ...DEFAULT_FILTERS,
        ...currentPersistentState,
        ...presetState,
      },
      defaults.filters
    );

    router.push(encodeStateToUrl(newState), undefined, { shallow: true });
  }, [currentState, defaults, router]);

  const setSidebarExpanded = useCallback((sidebarExpanded: Record<string, boolean>) => {
    save({ sidebarExpanded });
  }, [save]);

  const setCardsPerRow = useCallback((cardsPerRow: number | null) => {
    save({ cardsPerRow });
  }, [save]);

  // Memoize filters to prevent unnecessary re-renders
  const filters: AnimeFiltersState = useMemo(() => ({
    statusFilters: currentState.statusFilters,
    searchQuery: currentState.searchQuery,
    seasons: currentState.seasons,
    mediaTypes: currentState.mediaTypes,
    genres: currentState.genres,
    hiddenOnly: currentState.hiddenOnly,
    discrepanciesOnly: currentState.discrepanciesOnly,
    unratedOnly: currentState.unratedOnly,
    minScore: currentState.minScore,
    maxScore: currentState.maxScore,
    sortBy: currentState.sortBy,
    sortDir: currentState.sortDir,
  }), [currentState]);

  const display: AnimeDisplayState = useMemo(() => ({
    sidebarExpanded: defaults.sidebarExpanded,
    cardsPerRow: defaults.cardsPerRow,
  }), [defaults]);

  return {
    filters,
    display,
    updateFilters,
    updateState,
    applyPreset,
    setSidebarExpanded,
    setCardsPerRow,
    isReady,
  };
}

export default useAnimeUrlState;
