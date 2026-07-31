import { useCallback, useEffect, useState } from 'react';

/**
 * Which season control the sidebar renders: the `simple` one-season picker
 * (default) or the `advanced` multi-season chip list.
 *
 * This is a UI preference, not filter state, so it lives in `localStorage`
 * rather than the URL — same reasoning as the language toggle (`lib/i18n`),
 * and the same hydration rule: the server and the first client render always
 * use the default, and the stored value is applied in a mount effect. The two
 * surfaces that host a season filter (`/` and `/tier`) therefore share one
 * preference instead of carrying a persistent URL key each.
 */
export type SeasonSelectorMode = 'simple' | 'advanced';

const STORAGE_KEY = 'anime-app.seasonSelectorMode';
export const DEFAULT_SEASON_SELECTOR_MODE: SeasonSelectorMode = 'simple';

export function useSeasonSelectorMode(): [SeasonSelectorMode, (m: SeasonSelectorMode) => void] {
  const [mode, setModeState] = useState<SeasonSelectorMode>(DEFAULT_SEASON_SELECTOR_MODE);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'simple' || stored === 'advanced') setModeState(stored);
    } catch {
      /* localStorage unavailable — keep the default */
    }
  }, []);

  const setMode = useCallback((next: SeasonSelectorMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore persistence failure */
    }
  }, []);

  return [mode, setMode];
}

export default useSeasonSelectorMode;
