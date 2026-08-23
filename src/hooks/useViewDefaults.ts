import { useCallback, useSyncExternalStore } from 'react';
import {
  SHIPPED_VIEW_DEFAULTS,
  ViewDefaults,
  resolveViewDefaults,
  type TitleLanguage,
} from '@/lib/url/viewDefaults';

/**
 * The user's view defaults, read from `settings.json` through the lean
 * `GET /api/anime/view-defaults`. See [viewDefaults.ts](../lib/url/viewDefaults.ts)
 * for what they cover and why display keys left the URL.
 *
 * **One module-level store, not per-hook state.** Several readers mount on the
 * same page — the URL-state hook that builds the landing URL, the sidebar that
 * renders its collapsed sections, the `DisplaySection` that edits cards-per-row —
 * and a per-instance `useState` would let one of them save a value the others
 * kept reading stale. It also means the fetch happens **once per page**, however
 * many components ask.
 *
 * `snapshot` MUST keep a stable identity between writes: `useSyncExternalStore`
 * loops forever on a getter returning a fresh object, and the URL-state hooks
 * fold defaults into `useMemo` keys.
 *
 * `loaded` is exposed because it is load-bearing, not diagnostic: `/`'s
 * empty-URL redirect has to wait for it, or it would redirect to the shipped
 * preset and latch before the user's landing view ever arrived.
 */
const ENDPOINT = '/api/anime/view-defaults';

let snapshot: ViewDefaults = SHIPPED_VIEW_DEFAULTS;
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach(listener => listener());
}

function ensureLoaded(): void {
  if (loaded || inflight) return;
  inflight = fetch(ENDPOINT)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((body: { viewDefaults?: unknown }) => {
      snapshot = resolveViewDefaults(body.viewDefaults);
    })
    .catch(() => {
      // Keep the shipped defaults; the app stays usable with the store
      // unreachable, and marking it loaded prevents a retry loop.
    })
    .finally(() => {
      loaded = true;
      inflight = null;
      emit();
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureLoaded();
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): ViewDefaults => snapshot;
/** Server + hydration snapshot: always the shipped defaults, so the two agree. */
const getServerSnapshot = (): ViewDefaults => SHIPPED_VIEW_DEFAULTS;

/**
 * Apply a patch locally *first*, then persist. Optimistic because these are
 * display preferences on a single-user app: waiting a round-trip to re-render
 * the grid would be a visible lag on every keystroke, and a failed write leaves
 * the next reload showing the stored value — a visible discrepancy rather than
 * silent data loss.
 */
export function saveViewDefaults(updates: Partial<ViewDefaults>): Promise<void> {
  snapshot = resolveViewDefaults({ ...snapshot, ...updates });
  loaded = true;
  emit();

  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((body: { viewDefaults?: unknown }) => {
      // Adopt the server's own resolution, so the in-memory value is exactly
      // what a reload would read back.
      snapshot = resolveViewDefaults(body.viewDefaults);
      emit();
    })
    .catch(() => {
      /* keep the optimistic value; the store is the one that disagrees */
    });
}

/** Drop the cached snapshot so the next subscriber refetches (used by /settings). */
export function invalidateViewDefaults(): void {
  loaded = false;
  ensureLoaded();
}

export interface UseViewDefaultsReturn {
  defaults: ViewDefaults;
  loaded: boolean;
  save: (updates: Partial<ViewDefaults>) => Promise<void>;
}

export function useViewDefaults(): UseViewDefaultsReturn {
  const defaults = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // `loaded` is read through the same subscription: it only ever changes in the
  // same tick as a snapshot change, so the re-render that reveals one reveals both.
  const isLoaded = useSyncExternalStore(subscribe, () => loaded, () => false);

  const save = useCallback((updates: Partial<ViewDefaults>) => saveViewDefaults(updates), []);

  return { defaults, loaded: isLoaded, save };
}

/**
 * Just the title-language preference — the one view default that most of its
 * readers want on its own, from components that care nothing for presets or
 * sidebar state (`AnimeCardView`, the tier board, the discrepancies table).
 *
 * It rides the same single fetch as the rest, so this costs nothing extra; it
 * exists so a card does not have to destructure a settings object to render a
 * title. Before the fetch lands it returns `SHIPPED_TITLE_LANGUAGE`, which is
 * what keeps SSR and the first client render in agreement.
 */
export function useTitleLanguage(): TitleLanguage {
  return useViewDefaults().defaults.titleLanguage;
}

export default useViewDefaults;
