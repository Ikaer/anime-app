/**
 * The user's view defaults — what the app shows before the URL says anything.
 *
 * There are **two kinds of key here and they need different mechanisms**, which
 * is the whole reason this module exists:
 *
 * - **Display keys** (`cardsPerRow`, `sidebarExpanded`) are "how it looks". They
 *   are NOT URL state at all — the `cpr` and `sb` params were removed. A card
 *   size is a preference, full stop; nobody wants a different one per bookmark,
 *   and a URL key for it only created the problem of what an absent key means.
 * - **Filter keys** (`mediaTypes`, score range) are "which anime", and they stay
 *   absolute in the URL: an absent `mt` means *no media-type filter*, a real
 *   value that a default must never quietly reinterpret. So filter defaults act
 *   on the **landing state** instead — the URL you get with none — plus the
 *   `applyPreset` baseline.
 *
 * `filters` is **sparse and layers ON TOP of the preset**. On top, because four
 * of the eleven `VIEW_PRESETS` pin `mediaTypes` themselves, so a default sitting
 * underneath would be shadowed exactly where it is most wanted. Sparse, so a key
 * you never set leaves every preset alone rather than pinning that preset's
 * value forever.
 *
 * There is deliberately **no default sort**: all eleven presets set `sortBy` and
 * `sortDir`, so the knob would be attached to nothing.
 *
 * Storage is `settings.json` (server), read by the client through the lean
 * `GET /api/anime/view-defaults` — this file is the pure, client-safe half and
 * knows nothing about either. The preset key is kept as a plain `string` and
 * validated by the caller: `animeParams.ts` owns `VIEW_PRESETS` and imports
 * this module, so checking it here would be a cycle.
 */

/** The shipped sidebar section states — the baseline `sidebarExpanded` resolves against. */
export const DEFAULT_SIDEBAR_EXPANDED: Record<string, boolean> = {
  account: true,
  sync: true,
  views: true,
  display: true,
  filters: true,
  // Collapsed by default: it is the tallest section in the sidebar, and the
  // default view (current-season TV) is not a genre-driven one.
  genres: false,
  sort: true,
  stats: true,
  simkl: true,
};

/** The preset `/` lands on when the URL carries no params. */
export const SHIPPED_PRESET = 'new_season_strict';

/**
 * Filter overrides applied on top of the landing preset. Sparse by design —
 * `undefined` means "not set", which is NOT the same as `[]` / `null` ("set to
 * no filter"), and only the difference between those two makes a default
 * revertible.
 */
export interface ViewFilterDefaults {
  mediaTypes?: string[];
  minScore?: number | null;
  maxScore?: number | null;
}

/**
 * Which of the three titles a provider supplies is shown as the primary one.
 *
 * The vocabulary is AniList's own (`userPreferredTitleLanguage`), because that
 * is the wording the owner already meets on the site the titles largely come
 * from. Each value names a field that genuinely exists on the record rather
 * than a locale to negotiate: `english` = `alternativeTitles.en`, `romaji` =
 * `catalog.title` (MAL's and AniList's default), `native` =
 * `alternativeTitles.ja`.
 *
 * ⚠️ **This is NOT the FR/EN UI language** (`lib/i18n.tsx`, localStorage-backed,
 * `anime-app.lang`). The two are constantly conflated and behave differently on
 * purpose: the UI language is a per-browser toggle, while this one is a stored
 * server-side preference that also decides what `/api/anime/catch-up`, the reco
 * feed and the MCP tools put in a `title` field. Reading an English UI with
 * Japanese titles is a legitimate combination.
 */
export type TitleLanguage = 'english' | 'romaji' | 'native';

export const TITLE_LANGUAGES: TitleLanguage[] = ['english', 'romaji', 'native'];

/**
 * English-first, which is what every call site hardcoded before this was
 * configurable — so an un-threaded reader keeps today's behaviour exactly.
 */
export const SHIPPED_TITLE_LANGUAGE: TitleLanguage = 'english';

export interface ViewDefaults {
  /** A `VIEW_PRESETS` key; an unknown one falls back to the shipped preset. */
  preset: string;
  filters: ViewFilterDefaults;
  /** Forced cards per row; null = adaptive (auto-fill). */
  cardsPerRow: number | null;
  sidebarExpanded: Record<string, boolean>;
  /**
   * Which title to show as primary. A display key like `cardsPerRow` — "how it
   * looks", never URL state — but unlike the rest of this file it is also read
   * SERVER-side, because several endpoints project a `title` string into their
   * payload and the client never sees the record to re-derive it from.
   */
  titleLanguage: TitleLanguage;
}

export const SHIPPED_VIEW_DEFAULTS: ViewDefaults = {
  preset: SHIPPED_PRESET,
  filters: {},
  cardsPerRow: null,
  sidebarExpanded: DEFAULT_SIDEBAR_EXPANDED,
  titleLanguage: SHIPPED_TITLE_LANGUAGE,
};

/** The filter keys the settings UI offers, so the form and the sanitizer agree. */
export const CONFIGURABLE_FILTER_DEFAULTS: (keyof ViewFilterDefaults)[] = [
  'mediaTypes',
  'minScore',
  'maxScore',
];

function sanitizeTitleLanguage(raw: unknown): TitleLanguage {
  return TITLE_LANGUAGES.includes(raw as TitleLanguage)
    ? (raw as TitleLanguage)
    : SHIPPED_TITLE_LANGUAGE;
}

function sanitizeCardsPerRow(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function sanitizeScore(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (raw === undefined) return undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseFloat(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function sanitizeFilters(raw: unknown): ViewFilterDefaults {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: ViewFilterDefaults = {};

  if (Array.isArray(src.mediaTypes)) {
    const types = src.mediaTypes.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    // `[]` survives as a real value — "explicitly no media-type filter" — which
    // is what lets a default be reverted rather than only ever widened.
    out.mediaTypes = Array.from(new Set(types));
  }
  const min = sanitizeScore(src.minScore);
  if (min !== undefined) out.minScore = min;
  const max = sanitizeScore(src.maxScore);
  if (max !== undefined) out.maxScore = max;

  return out;
}

/**
 * Resolve stored defaults over the shipped ones. Unknown sidebar keys are
 * dropped and missing ones fall through, so a section added later ships with its
 * own default rather than reading as collapsed out of a stale stored map.
 */
export function resolveViewDefaults(raw: unknown): ViewDefaults {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return SHIPPED_VIEW_DEFAULTS;
  const src = raw as Record<string, unknown>;

  const sidebarExpanded = { ...DEFAULT_SIDEBAR_EXPANDED };
  if (src.sidebarExpanded && typeof src.sidebarExpanded === 'object') {
    for (const [key, value] of Object.entries(src.sidebarExpanded as Record<string, unknown>)) {
      if (key in DEFAULT_SIDEBAR_EXPANDED && typeof value === 'boolean') sidebarExpanded[key] = value;
    }
  }

  return {
    preset: typeof src.preset === 'string' && src.preset.trim() !== '' ? src.preset : SHIPPED_PRESET,
    filters: sanitizeFilters(src.filters),
    cardsPerRow: sanitizeCardsPerRow(src.cardsPerRow),
    sidebarExpanded,
    titleLanguage: sanitizeTitleLanguage(src.titleLanguage),
  };
}

/**
 * The storable projection: everything equal to the shipped default is dropped,
 * for the same reason `sanitizeCatalogPrecedence` drops no-op entries — a value
 * the user never chose must not silently freeze a future change to the shipped
 * default. Returns `null` when nothing at all differs, so the settings key is
 * omitted rather than stored empty.
 */
export function sparseViewDefaults(defaults: ViewDefaults): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};

  if (defaults.preset !== SHIPPED_PRESET) out.preset = defaults.preset;
  if (defaults.cardsPerRow !== null) out.cardsPerRow = defaults.cardsPerRow;
  if (defaults.titleLanguage !== SHIPPED_TITLE_LANGUAGE) out.titleLanguage = defaults.titleLanguage;

  const filters = sanitizeFilters(defaults.filters);
  if (Object.keys(filters).length > 0) out.filters = filters;

  const sidebar: Record<string, boolean> = {};
  for (const [key, shipped] of Object.entries(DEFAULT_SIDEBAR_EXPANDED)) {
    if (!!defaults.sidebarExpanded[key] !== shipped) sidebar[key] = !!defaults.sidebarExpanded[key];
  }
  if (Object.keys(sidebar).length > 0) out.sidebarExpanded = sidebar;

  return Object.keys(out).length > 0 ? out : null;
}
