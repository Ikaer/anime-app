/**
 * Hook for managing anime page state via URL query parameters
 * 
 * URL is the single source of truth. This hook:
 * - Redirects empty URLs to the default preset
 * - Parses URL params into filter/display state
 * - Provides update functions that modify the URL via router.push
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
  getDefaultPresetUrl,
  DEFAULT_FILTERS,
  DEFAULT_DISPLAY,
  PERSISTENT_UI_KEYS,
} from '@/lib/animeUrlParams';

export interface UseAnimeUrlStateReturn {
  filters: AnimeFiltersState;
  display: AnimeDisplayState;
  updateFilters: (updates: Partial<AnimeFiltersState>) => void;
  updateDisplay: (updates: Partial<AnimeDisplayState>) => void;
  updateState: (updates: Partial<AnimeUrlState>) => void;
  applyPreset: (presetState: Partial<AnimeUrlState>) => void;
  isReady: boolean;
}

export function useAnimeUrlState(): UseAnimeUrlStateReturn {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [hasRedirected, setHasRedirected] = useState(false);

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
      return { ...DEFAULT_FILTERS, ...DEFAULT_DISPLAY };
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
      if (!params.has('auth') && !hasRedirected) {
        setHasRedirected(true);
        router.push(getDefaultPresetUrl());
        return;
      }
    }

    // Set ready once we have valid params (either initially or after redirect)
    if (!isReady && hasAnyParams(params)) {
      setIsReady(true);
    }
  }, [router.isReady, router.pathname, queryString, hasRedirected, isReady, router]);

  // Update filters and push to URL
  const updateFilters = useCallback((updates: Partial<AnimeFiltersState>) => {
    const newState: AnimeUrlState = {
      ...currentState,
      ...updates,
    };
    const url = encodeStateToUrl(newState);
    router.push(url, undefined, { shallow: true });
  }, [currentState, router]);

  // Update display settings and push to URL
  const updateDisplay = useCallback((updates: Partial<AnimeDisplayState>) => {
    const newState: AnimeUrlState = {
      ...currentState,
      ...updates,
    };
    const url = encodeStateToUrl(newState);
    router.push(url, undefined, { shallow: true });
  }, [currentState, router]);

  // Update any state and push to URL
  const updateState = useCallback((updates: Partial<AnimeUrlState>) => {
    const newState: AnimeUrlState = {
      ...currentState,
      ...updates,
    };
    const url = encodeStateToUrl(newState);
    router.push(url, undefined, { shallow: true });
  }, [currentState, router]);

  // Apply a preset while preserving UI preferences
  const applyPreset = useCallback((presetState: Partial<AnimeUrlState>) => {
    // 1. Capture current persistent values
    const currentPersistentState: Partial<AnimeUrlState> = {};
    PERSISTENT_UI_KEYS.forEach(key => {
      if (currentState[key] !== undefined) {
        (currentPersistentState as any)[key] = currentState[key];
      }
    });

    // 2. Build new state: Baseline -> Persistent -> Preset
    const newState: AnimeUrlState = {
      ...DEFAULT_FILTERS,
      ...DEFAULT_DISPLAY,
      ...currentPersistentState,
      ...presetState,
    };

    const url = encodeStateToUrl(newState);
    router.push(url, undefined, { shallow: true });
  }, [currentState, router]);

  // Memoize filters to prevent unnecessary re-renders
  const filters: AnimeFiltersState = useMemo(() => ({
    statusFilters: currentState.statusFilters,
    searchQuery: currentState.searchQuery,
    seasons: currentState.seasons,
    mediaTypes: currentState.mediaTypes,
    hiddenOnly: currentState.hiddenOnly,
    minScore: currentState.minScore,
    maxScore: currentState.maxScore,
    sortBy: currentState.sortBy,
    sortDir: currentState.sortDir,
  }), [currentState]);

  // Memoize display to prevent unnecessary re-renders
  const display: AnimeDisplayState = useMemo(() => ({
    imageSize: currentState.imageSize,
    visibleColumns: currentState.visibleColumns,
    sidebarExpanded: currentState.sidebarExpanded,
    layout: currentState.layout,
  }), [currentState]);

  return {
    filters,
    display,
    updateFilters,
    updateDisplay,
    updateState,
    applyPreset,
    isReady,
  };
}

export default useAnimeUrlState;
