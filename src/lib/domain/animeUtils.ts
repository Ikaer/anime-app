import type {
  AnimeRecord, AnimeCatalog, AnimePersonal, CatalogSource,
  ProvenanceSource, SeasonName, SeasonInfo, MALAnime, MALPersonalEntry, SimklPersonalEntry, AniListMetaEntry, AniListPersonalEntry,
  LocalPersonalEntry, SourceIds, Discrepancy, Genre,
} from '@/models/anime';
import type { TFunction, TranslationKey } from '@/lib/i18n';
import { buildProviderStates, toAnimePersonal } from '@/lib/providers/personalState';

// ============================================================================
// Display titles (English-first)
// ============================================================================

type TitleFields = Pick<AnimeRecord, 'catalog'>;
type CatalogTitleFields = { title: string; alternativeTitles?: { en: string } };

/** Primary display title: the English title when present, else the original (romaji) title. */
export function getPrimaryTitle(a: TitleFields): string {
  return getCatalogPrimaryTitle(a.catalog);
}

/** Secondary title: the original (romaji) title, returned only when it differs from the primary. */
export function getSecondaryTitle(a: TitleFields): string | undefined {
  const primary = getPrimaryTitle(a);
  return a.catalog.title && a.catalog.title !== primary ? a.catalog.title : undefined;
}

/** `getPrimaryTitle` for `AnimeRecord.catalog` (camelCase field names). */
export function getCatalogPrimaryTitle(c: CatalogTitleFields): string {
  return c.alternativeTitles?.en || c.title;
}

// ============================================================================
// Narrowing filters (shared by /api/anime/animes and /api/anime/recommendations)
// ============================================================================

export interface NarrowingFilters {
  mediaTypes?: string[];
  search?: string;
  minScore?: number | null;
  maxScore?: number | null;
  minYear?: number | null;
  maxYear?: number | null;
  /** MAL genre names (not AniList tags) — AND semantics: every listed genre must be present. */
  genres?: string[];
}

/** Release year, preferring the season year, falling back to the start date. */
function animeYear(a: AnimeRecord): number | undefined {
  if (a.catalog.startSeason?.year) return a.catalog.startSeason.year;
  if (a.catalog.startDate && a.catalog.startDate.length >= 4) {
    const y = parseInt(a.catalog.startDate.slice(0, 4), 10);
    return Number.isFinite(y) ? y : undefined;
  }
  return undefined;
}

/**
 * Apply the "narrowing" filter dimensions that make sense on any anime list —
 * including the ranked recommendations feed. Deliberately excludes status,
 * season, hidden and sort (those are page-specific). `minScore`/`maxScore`
 * filter MAL's `mean` (not the personal score), matching CLAUDE.md.
 * Generic over the item type so extra fields (e.g. `recoMeta`) survive.
 */
export function applyNarrowingFilters<T extends AnimeRecord>(
  items: T[],
  f: NarrowingFilters
): T[] {
  let out = items;

  if (f.mediaTypes && f.mediaTypes.length > 0) {
    const wanted = f.mediaTypes.map(t => t.toLowerCase());
    out = out.filter(a => wanted.includes((a.catalog.mediaType || '').toLowerCase()));
  }

  if (f.search && f.search.trim()) {
    const term = f.search.toLowerCase();
    out = out.filter(a =>
      (a.catalog.title || '').toLowerCase().includes(term) ||
      (a.catalog.alternativeTitles?.en || '').toLowerCase().includes(term)
    );
  }

  if (f.minScore != null && Number.isFinite(f.minScore)) {
    out = out.filter(a => !!a.catalog.mean && a.catalog.mean >= f.minScore!);
  }

  if (f.maxScore != null && Number.isFinite(f.maxScore)) {
    out = out.filter(a => !!a.catalog.mean && a.catalog.mean <= f.maxScore!);
  }

  if (f.minYear != null && Number.isFinite(f.minYear)) {
    out = out.filter(a => { const y = animeYear(a); return y != null && y >= f.minYear!; });
  }

  if (f.maxYear != null && Number.isFinite(f.maxYear)) {
    out = out.filter(a => { const y = animeYear(a); return y != null && y <= f.maxYear!; });
  }

  if (f.genres && f.genres.length > 0) {
    const wanted = f.genres;
    out = out.filter(a => {
      const names = new Set((a.catalog.genres || []).map(g => g.name));
      return wanted.every(g => names.has(g));
    });
  }

  return out;
}

// Utility function to format season display with nice labels and colors

export const formatSeason = (year: number, season: string, t?: TFunction) => {
  const seasonMap: Record<string, { label: string; color: string }> = {
    'spring': { label: 'Spring', color: '#10B981' }, // Green
    'summer': { label: 'Summer', color: '#F59E0B' }, // Orange
    'fall': { label: 'Fall', color: '#EF4444' },     // Red
    'winter': { label: 'Winter', color: '#3B82F6' }  // Blue
  };

  const seasonInfo = seasonMap[season] || { label: season, color: '#6B7280' };
  // When a translator is supplied (client components), localize the season word;
  // server callers (no `t`) keep the English label.
  const seasonWord = t && seasonMap[season] ? t(`seasonName.${season}` as TranslationKey) : seasonInfo.label;
  return {
    label: `${seasonWord} ${year}`,
    color: seasonInfo.color
  };
}


export type SeasonInfos = { current: SeasonInfo; previous: SeasonInfo; next: SeasonInfo };

/**
 * The current season plus its neighbours, derived from today's date. This is
 * the single implementation of the season arithmetic — everything that needs a
 * "which season are we in" answer calls it.
 */
export function getSeasonInfos(): SeasonInfos {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();

  // Determine current season
  const month = currentDate.getMonth(); // 0-11
  let currentSeason: SeasonName;
  if (month >= 0 && month <= 2) currentSeason = 'winter';
  else if (month >= 3 && month <= 5) currentSeason = 'spring';
  else if (month >= 6 && month <= 8) currentSeason = 'summer';
  else currentSeason = 'fall';

  // Determine previous season
  let prevYear = currentYear;
  let prevSeason: SeasonName;
  if (currentSeason === 'winter') { prevSeason = 'fall'; prevYear--; }
  else if (currentSeason === 'spring') prevSeason = 'winter';
  else if (currentSeason === 'summer') prevSeason = 'spring';
  else prevSeason = 'summer';

  // Determine next season
  let nextYear = currentYear;
  let nextSeason: SeasonName;
  if (currentSeason === 'winter') nextSeason = 'spring';
  else if (currentSeason === 'spring') nextSeason = 'summer';
  else if (currentSeason === 'summer') nextSeason = 'fall';
  else { nextSeason = 'winter'; nextYear++; }

  return {
    current: { year: currentYear, season: currentSeason },
    previous: { year: prevYear, season: prevSeason },
    next: { year: nextYear, season: nextSeason },
  };
}

// ============================================================================
// Effective personal state (the "local cache authority" seam)
// ============================================================================
//
// The user notes anime in SIMKL (SIMKL → MAL one-way), so SIMKL is the
// authority for PERSONAL fields; MAL is the fallback; an anonymously-imported
// The AniList list is the LOWEST fallback tier, so an
// AniList-only user still gets their state while existing MAL/SIMKL users are
// unaffected (their higher tiers win). Precedence: SIMKL > MAL > AniList. Every
// personal read used for filtering, seeding, or exclusion goes through these
// three helpers so the precedence lives in exactly one place. Catalog fields
// (mean, genres, studios…) stay MAL — these helpers are personal-only.

/**
 * Effective personal watch status (SIMKL-first, then MAL, then AniList). A thin
 * read of the hydration engine's `personal` projection — `toAnimeRecord` already
 * applied this precedence via `DEFAULT_PERSONAL_PRECEDENCE`, so there is one
 * implementation, not two.
 */
export function getEffectiveStatus(anime: AnimeRecord): string | undefined {
  return anime.personal.status;
}

/** Effective personal score on the shared 1–10 scale. See `getEffectiveStatus`. */
export function getEffectiveScore(anime: AnimeRecord): number | undefined {
  return anime.personal.score;
}

/** Effective watched-episode progress. See `getEffectiveStatus`. */
export function getEffectiveProgress(anime: AnimeRecord): number | undefined {
  return anime.personal.progress;
}

export function formatUserStatus(status?: string) {
  if (!status) return 'Unknown';
  return status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ============================================================================
// Hydration engine
// ============================================================================
//
// One generic mechanism for both `catalog` and `personal`: each provider
// exposes a partial extractor (`catalogFromMal`, `catalogFromAnilist`, …), a
// precedence-merge walks every field the extractors produced and picks the
// first source in precedence order that has a defined value, and records that
// source in a sibling `provenance` map. Values stay flat — `record.catalog.title`
// is the string, no `.value` wrapper — so no consumer needs to change shape.

/**
 * Default catalog field precedence: MAL-first, matching pre-Phase-C behavior
 * exactly. AniList wins only where MAL is absent (e.g. an AniList-only title)
 * — flipping the DEFAULT before MAL coverage is universal would blank fields
 * for titles the AniList crawler hasn't reached yet. `simkl` is included for
 * uniformity (see `catalogFromSimkl`) but never wins today: it contributes no
 * catalog fields.
 */
export const DEFAULT_CATALOG_PRECEDENCE: CatalogSource[] = ['mal', 'anilist', 'simkl'];

/**
 * Per-field catalog precedence overrides, layered over
 * `DEFAULT_CATALOG_PRECEDENCE`. A field absent from this map uses the default,
 * so the common case stays a one-liner and this map holds only the fields whose
 * ordering is a deliberate, argued decision.
 *
 * Since E5 this is the **shipped default**, not the last word: the user's
 * `settings.json` overrides layer on top of it (`getCatalogPrecedenceByField` in
 * `config/settings.ts`). Clearing a field in `/settings` restores the entry
 * here, which is why the arguments below still matter.
 *
 * The point of per-field ordering (docs/FULL Precedence E1) is that "which
 * provider is the catalog authority" is not one question — MAL wins `mean` on
 * voter count while AniList would win a field like `synopsis` on freshness, and
 * a single global array cannot express both.
 *
 * Current entries:
 *
 * - **`mean` → MAL, explicitly.** MAL's larger voter base gives a more reliable
 *   central tendency, and `mean` backs the `minScore`/`maxScore` filters — a
 *   mixed source would mean mixed filter semantics inside one sorted list. It
 *   already won by falling through the default; pinning it states the reason so
 *   a future default flip cannot silently take it.
 *
 * Deliberately NOT here:
 *
 * - **`genres`** — not a precedence question at all. Merged element-wise by
 *   `unionGenres`, which runs after this map and overrides whatever it chose.
 * - **`studios`** — measured, and MAL simply covers more (15,391 titles vs
 *   12,254). AniList's 524 unique titles already fall through under the default,
 *   so an override would gain nothing and only swap id namespaces. See
 *   docs/FULL Precedence/studio-id-namespace.md.
 */
export const CATALOG_PRECEDENCE_BY_FIELD: Partial<Record<keyof AnimeCatalog, CatalogSource[]>> = {
  mean: ['mal', 'anilist', 'simkl'],
};

/**
 * The precedence a given catalog field resolves under. Single seam, so the
 * inspector page (E6) and the `/settings` editor (E5) report exactly what the
 * merge did rather than re-deriving it.
 */
export function catalogPrecedenceFor(
  field: keyof AnimeCatalog,
  base: CatalogSource[] = DEFAULT_CATALOG_PRECEDENCE,
  byField: Partial<Record<keyof AnimeCatalog, CatalogSource[]>> = CATALOG_PRECEDENCE_BY_FIELD
): CatalogSource[] {
  return byField[field] ?? base;
}

// ── The configurable surface (E5) ────────────────────────────────────────────
//
// Client-safe: the settings page renders from these and the settings API
// validates against them, so the editor's option list and the merge's accepted
// values cannot drift apart. The *stored* shape stays a full ordering array —
// the mechanism is general — even though the UI only asks "who wins", for the
// reason stated on `CATALOG_CONTRIBUTORS`.

/** A per-field catalog ordering map, as stored in `settings.json`. */
export type CatalogPrecedenceOverrides = Partial<Record<keyof AnimeCatalog, CatalogSource[]>>;

/**
 * Providers that can actually supply a catalog field. `catalogFromSimkl` and
 * `catalogFromLocal` return `{}` — SIMKL's public API adds nothing MAL doesn't
 * already give, and the local provider is personal-only — so ordering them is a
 * knob attached to nothing. The real question every configurable field asks is
 * MAL or AniList, and offering the six permutations of a three-element array
 * would dress that up as five decisions it isn't.
 */
export const CATALOG_CONTRIBUTORS: CatalogSource[] = ['mal', 'anilist'];

/**
 * Catalog fields whose ordering is worth configuring: the ones **both**
 * contributors produce, so precedence genuinely arbitrates. Every other field
 * has exactly one possible supplier and a setting for it would be inert.
 *
 * Tracks `catalogFromAnilist`'s key set (MAL's is a superset) minus `genres`,
 * which is not a precedence question at all — `unionGenres` merges it
 * element-wise afterwards and overrides whatever the merge chose. Adding an
 * AniList catalog field means adding it here too; the inspector page shows the
 * field either way, so the failure mode is a missing knob, not a wrong value.
 */
export const CONFIGURABLE_CATALOG_FIELDS: (keyof AnimeCatalog)[] = [
  'title',
  'alternativeTitles',
  'mainPicture',
  'pictures',
  'synopsis',
  'startDate',
  'mean',
  'numListUsers',
  'mediaType',
  'airingStatus',
  'numEpisodes',
  'startSeason',
  'studios',
];

/**
 * The full ordering that makes `winner` win: it moves to the front and everyone
 * else keeps their relative order in `base`. Storing the whole array rather than
 * just the winner keeps `settings.json` in the shape `mergeWithProvenance`
 * consumes, so nothing has to reconstitute an ordering at read time.
 */
export function catalogOrderingWithWinner(
  winner: CatalogSource,
  base: CatalogSource[] = DEFAULT_CATALOG_PRECEDENCE
): CatalogSource[] {
  return [winner, ...base.filter(s => s !== winner)];
}

/** The provider an ordering puts first — the inverse of `catalogOrderingWithWinner`. */
export function catalogWinnerOf(ordering: CatalogSource[]): CatalogSource | undefined {
  return ordering[0];
}

/**
 * Personal-state precedence: SIMKL > MAL > AniList — exactly the pre-Phase-C
 * `getEffective*` order. `local`'s position is NOT baked here: it's inserted by
 * `resolveLocalPrecedence` (top or bottom) only when the local provider is
 * enabled, so the default array preserves today's behavior byte-for-byte.
 */
export const DEFAULT_PERSONAL_PRECEDENCE: ProvenanceSource[] = ['simkl', 'mal', 'anilist'];

/** How the local tier sits relative to the external providers. */
export type LocalPrecedenceMode = 'auto' | 'localTop' | 'localBottom';

/**
 * Insert `local` into a base personal-precedence array.
 * Pure and client-safe so the settings page can preview the resolved order.
 *
 * - `localTop`    → local wins over every external source.
 * - `localBottom` → local is the last resort (never shadows an external edit).
 * - `auto`        → bottom when a writable external provider is connected (model B,
 *                   "write-through, no shadowing"), top when local is the only source.
 */
export function resolveLocalPrecedence(
  mode: LocalPrecedenceMode,
  base: ProvenanceSource[],
  opts: { hasWritableExternal: boolean }
): ProvenanceSource[] {
  if (mode === 'localTop') return ['local', ...base];
  if (mode === 'localBottom') return [...base, 'local'];
  return opts.hasWritableExternal ? [...base, 'local'] : ['local', ...base];
}

/**
 * Generic precedence merge: for every field any extractor produced, walk that
 * field's precedence and take the first source with a defined value, recording
 * which source won in a sibling provenance map. A field no source touched is
 * simply absent from both `merged` and `provenance`.
 *
 * Precedence is resolved **per field**: `byField` supplies an ordering for the
 * fields that have a deliberate one, and everything else uses `precedence`.
 * Passing no `byField` reproduces the old single-array behaviour exactly, which
 * is what the personal merge still does (SIMKL > MAL > AniList is one decision
 * for the whole block, not a per-field one).
 *
 * Note `value !== undefined` is the test, so a field an extractor sets to an
 * empty array WINS. Extractors must emit `undefined` for "this provider has no
 * value" — see the `genres`/`studios` note in `providers/anilist/sync.ts`.
 */
function mergeWithProvenance<T extends object>(
  precedence: ProvenanceSource[],
  extracted: Partial<Record<ProvenanceSource, Partial<T>>>,
  byField?: Partial<Record<keyof T, ProvenanceSource[]>>
): { merged: Partial<T>; provenance: Partial<Record<keyof T, ProvenanceSource>> } {
  const merged: Partial<T> = {};
  const provenance: Partial<Record<keyof T, ProvenanceSource>> = {};
  const allKeys = new Set<keyof T>();
  for (const values of Object.values(extracted)) {
    if (!values) continue;
    for (const key of Object.keys(values) as (keyof T)[]) allKeys.add(key);
  }
  for (const key of allKeys) {
    for (const source of byField?.[key] ?? precedence) {
      const values = extracted[source];
      const value = values ? values[key] : undefined;
      if (value !== undefined) {
        merged[key] = value;
        provenance[key] = source;
        break;
      }
    }
  }
  return { merged, provenance };
}

// ── Genre union ──────────────────────────────────────────────────────────────
//
// `genres` is the ONE catalog field merged element-wise instead of by precedence
// (docs/FULL Precedence/genre-vocabulary.md, option C). Every other field takes
// its value wholesale from the first provider in precedence that has one.
//
// Why genres get the exception, when `studios` explicitly does NOT:
//
//  - Genres are identified by NAME. AniList exposes them as names only (synthetic
//    `id: 0`) and every consumer keys on `name`, so dedupe is a Set and no
//    cross-source identity problem exists. Studios are id-keyed across two
//    namespaces, so a union there needs an identity answer first — and measured,
//    it would list the same studio twice on 4.6% of titles while adding a real
//    one on only 7.6%.
//  - The union genuinely adds data: measured on the live store, AniList
//    contributes a genre MAL omits on 45.6% of both-present titles (11,087
//    assignments — `Slice of Life` alone on 1,893 titles).
//
// Vocabulary is unaffected: MAL carries 78 values, AniList 19, and `Thriller` is
// the only AniList-only name — which is MAL's `Suspense` under another label.

/**
 * AniList genre names that denote a MAL genre under a different label. Without
 * the alias the union lists both spellings as separate genres, splitting the
 * filter and the reco IDF profile for one concept.
 */
const GENRE_ALIASES: Record<string, string> = { thriller: 'Suspense' };

/**
 * Identity key for a catalog value that is named rather than stably identified
 * — genres and studios both qualify, for the same reason: their provider ids do
 * not survive a crossing between MAL's and AniList's namespaces, so the name is
 * the only key the two sources agree on.
 *
 * Case- and punctuation-insensitive, whitespace stripped, which is what makes
 * `P.A. Works` and `P.A.WORKS` one studio. Measured agreement across the live
 * store: **87.9%** of titles carrying studios from both providers have
 * name-identical sets under this key. The residue is genuine aliasing
 * (`Gallop` / `Studio Gallop`) that only a hand-written table would collapse —
 * see docs/FULL Precedence/studio-id-namespace.md.
 */
export const catalogNameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Element-wise union of every provider's genres, deduped by normalized name and
 * ordered by catalog precedence — so a genre both providers carry keeps the
 * higher-precedence provider's entry (and therefore MAL's real genre id, rather
 * than AniList's synthetic 0).
 *
 * Returns `undefined` rather than `[]` when no provider had genres, matching the
 * merge's own "absent means absent" contract.
 */
function unionGenres(
  precedence: ProvenanceSource[],
  extracted: Partial<Record<ProvenanceSource, Partial<AnimeCatalog>>>
): Genre[] | undefined {
  const out: Genre[] = [];
  const seen = new Set<string>();
  for (const source of precedence) {
    for (const genre of extracted[source]?.genres ?? []) {
      const name = GENRE_ALIASES[catalogNameKey(genre.name)] ?? genre.name;
      const key = catalogNameKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...genre, name });
    }
  }
  return out.length > 0 ? out : undefined;
}

/** MAL's raw shape → the provider-neutral `AnimeCatalog` field names. */
function catalogFromMal(mal?: MALAnime): Partial<AnimeCatalog> {
  if (!mal) return {};
  return {
    title: mal.title,
    alternativeTitles: mal.alternative_titles,
    mainPicture: mal.main_picture,
    pictures: mal.pictures,
    synopsis: mal.synopsis,
    background: mal.background,
    startDate: mal.start_date,
    endDate: mal.end_date,
    mean: mal.mean,
    rank: mal.rank,
    popularity: mal.popularity,
    numListUsers: mal.num_list_users,
    numScoringUsers: mal.num_scoring_users,
    nsfw: mal.nsfw,
    genres: mal.genres,
    mediaType: mal.media_type,
    airingStatus: mal.status,
    numEpisodes: mal.num_episodes,
    startSeason: mal.start_season,
    broadcast: mal.broadcast,
    source: mal.source,
    averageEpisodeDuration: mal.average_episode_duration,
    rating: mal.rating,
    relatedAnime: mal.related_anime,
    studios: mal.studios,
  };
}

/**
 * AniList's catalog crawler shape → `AnimeCatalog` field names (see
 * `AniListMetaEntry.catalog`'s doc comment — already MAL-vocabulary-normalized
 * at crawl time). This is what lets an AniList-only title (no MAL slice)
 * render a full row.
 */
function catalogFromAnilist(entry?: AniListMetaEntry): Partial<AnimeCatalog> {
  const c = entry?.catalog;
  if (!c) return {};
  return {
    title: c.title,
    alternativeTitles: c.titleEnglish ? { synonyms: [], en: c.titleEnglish, ja: c.titleRomaji ?? '' } : undefined,
    mainPicture: c.coverImage,
    pictures: c.coverImage ? [c.coverImage] : undefined,
    synopsis: c.synopsis,
    startDate: c.startDate,
    mean: c.mean,
    numListUsers: c.numListUsers,
    genres: c.genres,
    mediaType: c.mediaType,
    airingStatus: c.airingStatus,
    numEpisodes: c.numEpisodes,
    startSeason: c.startSeason,
    studios: c.studios,
  };
}

/**
 * SIMKL contributes no catalog fields today (its public API has no tags/genre
 * detail beyond what MAL already gives — see CLAUDE.md's SIMKL section). Wired
 * uniformly with the other extractors so a future SIMKL catalog field is a
 * one-line addition here, not a new merge path.
 */
function catalogFromSimkl(): Partial<AnimeCatalog> {
  return {};
}

/**
 * The local provider is personal-only — it contributes no catalog fields.
 * No-op, wired uniformly with the other catalog extractors (`CatalogSource =
 * ProvenanceSource`, so `'local'` is nominally a catalog source); it never wins
 * a catalog field, being absent from `DEFAULT_CATALOG_PRECEDENCE`.
 */
function catalogFromLocal(): Partial<AnimeCatalog> {
  return {};
}

/**
 * The raw per-provider slices `toAnimeRecord` hydrates from — exactly what
 * `getAnimeRecord` gathers per canonical id before any merging happens.
 * `mal` is optional: a canonical id anchored only by AniList (no MAL slice)
 * still produces a full record.
 */
export interface RawAnimeSlices {
  mal?: MALAnime;
  malPersonal?: MALPersonalEntry;
  simkl?: SimklPersonalEntry;
  anilistMeta?: AniListMetaEntry;
  anilistPersonal?: AniListPersonalEntry;
  local?: LocalPersonalEntry;
  hidden?: boolean;
  discrepancy?: Discrepancy | null;
  crosswalk?: SourceIds;
}

// ============================================================================
// Precedence inspector (E6) — a READER, not a new data path
// ============================================================================

/** Per-provider normalized catalog views — the inputs the merge chose between. */
export type CatalogBySource = Partial<Record<CatalogSource, Partial<AnimeCatalog>>>;

/**
 * Rebuild each provider's normalized catalog view from a record's raw slices.
 *
 * The same extractors `toAnimeRecord` feeds the merge, so the inspector compares
 * providers on the **neutral field names** (`numEpisodes`) rather than on their
 * raw shapes (MAL's `num_episodes` vs AniList's `numEpisodes`) — which is the
 * only way the comparison is readable by eye.
 */
export function extractCatalogBySource(sources: AnimeRecord['sources']): CatalogBySource {
  return {
    mal: catalogFromMal(sources.mal),
    anilist: catalogFromAnilist(sources.anilist),
    simkl: catalogFromSimkl(),
    local: catalogFromLocal(),
  };
}

/** How a field's final value was arrived at. */
export type CatalogMergeMode = 'precedence' | 'union';

export interface CatalogFieldExplain {
  field: keyof AnimeCatalog;
  mergeMode: CatalogMergeMode;
  /** The ordering this field resolved under — its override, or the default. */
  precedence: CatalogSource[];
  /**
   * Which provider supplied the value. `undefined` for a `union` field, where
   * "who won" is the wrong question.
   */
  winner?: ProvenanceSource;
  /** The value actually sitting on `record.catalog`. */
  effective: unknown;
  /** Every provider's value for this field, losers included. */
  bySource: Partial<Record<CatalogSource, unknown>>;
  /** More than one provider offered a value — i.e. precedence really decided something. */
  contested: boolean;
}

/**
 * Per-field account of how `record.catalog` was assembled: the winning value,
 * the winning provider, the ordering in force, and every provider's raw value.
 *
 * Everything here already exists on the record — this only arranges it, which is
 * why the inspector needs no bespoke API. Pure and client-safe.
 *
 * Contested fields sort first: on a debugging surface the interesting rows are
 * the ones where providers disagreed, not the thirty where only MAL had anything.
 */
export function explainCatalogPrecedence(
  record: AnimeRecord,
  base: CatalogSource[] = DEFAULT_CATALOG_PRECEDENCE,
  byField: Partial<Record<keyof AnimeCatalog, CatalogSource[]>> = CATALOG_PRECEDENCE_BY_FIELD
): CatalogFieldExplain[] {
  const bySource = extractCatalogBySource(record.sources);

  // Field list = every key any provider produced. Derived rather than hardcoded,
  // so a new catalog field appears here without touching this function.
  const fields = new Set<keyof AnimeCatalog>();
  for (const values of Object.values(bySource)) {
    for (const key of Object.keys(values ?? {}) as (keyof AnimeCatalog)[]) fields.add(key);
  }

  const rows = [...fields].map<CatalogFieldExplain>(field => {
    const values: Partial<Record<CatalogSource, unknown>> = {};
    let present = 0;
    for (const source of Object.keys(bySource) as CatalogSource[]) {
      const value = bySource[source]?.[field];
      if (value === undefined) continue;
      values[source] = value;
      present++;
    }
    // `genres` is unioned AFTER the merge, so its provenance entry names whoever
    // the merge happened to pick and means nothing. Reporting that as a winner is
    // the one lie this page could most easily tell, on the page whose entire job
    // is to stop people re-deriving this.
    const mergeMode: CatalogMergeMode = field === 'genres' ? 'union' : 'precedence';
    return {
      field,
      mergeMode,
      precedence: catalogPrecedenceFor(field, base, byField),
      winner: mergeMode === 'union' ? undefined : record.provenance.catalog[field],
      effective: record.catalog[field],
      bySource: values,
      contested: present > 1,
    };
  });

  return rows.sort((a, b) =>
    Number(b.contested) - Number(a.contested) || a.field.localeCompare(b.field)
  );
}

/**
 * Build the provider-neutral `AnimeRecord` from a canonical id's raw slices
 * via the generic hydration engine above. `personal` reproduces the exact
 * `getEffective*` precedence (SIMKL > MAL > AniList) so there remains one
 * implementation of "which source wins" for personal state; `sources` keeps
 * every raw slice verbatim so nothing is lost in the merge.
 */
export function toAnimeRecord(
  slices: RawAnimeSlices,
  canonicalId: string,
  catalogPrecedence: CatalogSource[] = DEFAULT_CATALOG_PRECEDENCE,
  personalPrecedence: ProvenanceSource[] = DEFAULT_PERSONAL_PRECEDENCE,
  catalogPrecedenceByField: Partial<Record<keyof AnimeCatalog, CatalogSource[]>> = CATALOG_PRECEDENCE_BY_FIELD
): AnimeRecord {
  const { mal, malPersonal, simkl, anilistMeta, anilistPersonal, local, hidden, discrepancy, crosswalk } = slices;

  const catalogExtracted = {
    mal: catalogFromMal(mal),
    anilist: catalogFromAnilist(anilistMeta),
    simkl: catalogFromSimkl(),
    local: catalogFromLocal(),
  };
  const { merged: catalogMerged, provenance: catalogProvenance } = mergeWithProvenance<AnimeCatalog>(
    catalogPrecedence,
    catalogExtracted,
    catalogPrecedenceByField
  );
  // `genres` is unioned across providers rather than taken wholesale — see
  // `unionGenres`. Provenance keeps naming the highest-precedence contributor
  // (what the merge already chose); the inspector page surfaces every provider's
  // raw list, which is where the full picture belongs.
  const unionedGenres = unionGenres(catalogPrecedence, catalogExtracted);
  if (unionedGenres) catalogMerged.genres = unionedGenres;
  const providerStates = buildProviderStates({ mal, malPersonal, simkl, anilist: anilistPersonal, local, anilistMeta }, personalPrecedence);
  const { merged: personalMerged, provenance: personalProvenance } = mergeWithProvenance<AnimePersonal>(
    personalPrecedence,
    {
      mal: toAnimePersonal(providerStates.mal),
      simkl: toAnimePersonal(providerStates.simkl),
      anilist: toAnimePersonal(providerStates.anilist),
      local: toAnimePersonal(providerStates.local),
    }
  );

  return {
    id: canonicalId,
    crosswalk: crosswalk ?? (mal ? { mal: mal.id } : {}),
    catalog: {
      // `title`/`genres`/`pictures`/`relatedAnime`/`studios` are non-optional on
      // `AnimeCatalog` — fall back to empty rather than `undefined` when no
      // source had a value (should only happen for a not-yet-hydrated record).
      ...catalogMerged,
      title: catalogMerged.title ?? '',
      genres: catalogMerged.genres ?? [],
      pictures: catalogMerged.pictures ?? [],
      relatedAnime: catalogMerged.relatedAnime ?? [],
      studios: catalogMerged.studios ?? [],
    },
    personal: personalMerged,
    provenance: { catalog: catalogProvenance, personal: personalProvenance },
    sources: { mal, malPersonal, simkl, anilist: anilistMeta, anilistPersonal, local },
    hidden,
    discrepancy,
  };
}
