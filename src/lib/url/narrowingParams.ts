/**
 * The narrowing-filter dimensions, encoded ONCE.
 *
 * `applyNarrowingFilters` is the one filter implementation (search, media type,
 * `mean` range, release-year range, genres). Its parameters used to be decoded
 * by hand in seven URL hooks and six API routes, each with its own `num`/`csv`
 * — so adding a dimension meant thirteen edits, and forgetting one was silent:
 * the control moved, the list rendered, the filter just never reached the
 * server or never survived a reload.
 *
 * Two key spaces, because they are two contracts:
 * - `NARROWING_URL_KEYS` — the page's address bar (short keys, `q`/`mt`/`g`…),
 *   shared by every page that mounts `RecoFiltersSection`, so a filter written
 *   on one page reads the same on another.
 * - `NARROWING_API_KEYS` — the query string the routes read (`search`,
 *   `mediaType`, …), parsed server-side by `parseNarrowingQuery`.
 *
 * A page that does not offer every dimension (`/activity` and `/catch-up` have
 * no genre filter) passes the subset it carries, so the codec never invents a
 * field the page's state has not got.
 *
 * Client-safe: no `fs`, imported by hooks and routes alike.
 */
import type { NarrowingFilters } from '@/lib/domain/animeUtils';

export interface NarrowingUrlState {
  search: string;
  mediaTypes: string[];
  minScore: number | null;
  maxScore: number | null;
  minYear: number | null;
  maxYear: number | null;
  /** MAL genre names — AND semantics, see `applyNarrowingFilters`. */
  genres: string[];
}

export type NarrowingField = keyof NarrowingUrlState;

export const NARROWING_DEFAULTS: NarrowingUrlState = {
  search: '',
  mediaTypes: [],
  minScore: null,
  maxScore: null,
  minYear: null,
  maxYear: null,
  genres: [],
};

export const NARROWING_URL_KEYS = {
  search: 'q',
  mediaTypes: 'mt',
  minScore: 'min',
  maxScore: 'max',
  minYear: 'miny',
  maxYear: 'maxy',
  genres: 'g',
} as const satisfies Record<NarrowingField, string>;

export const NARROWING_API_KEYS = {
  search: 'search',
  mediaTypes: 'mediaType',
  minScore: 'minScore',
  maxScore: 'maxScore',
  minYear: 'minYear',
  maxYear: 'maxYear',
  genres: 'genres',
} as const satisfies Record<NarrowingField, string>;

export const NARROWING_FIELDS = Object.keys(NARROWING_DEFAULTS) as NarrowingField[];

/** Every field but `genres` — what `/activity` and `/catch-up` offer. */
export const NARROWING_FIELDS_NO_GENRES = NARROWING_FIELDS.filter(f => f !== 'genres') as Exclude<
  NarrowingField,
  'genres'
>[];

const NUMBER_FIELDS = new Set<NarrowingField>(['minScore', 'maxScore', 'minYear', 'maxYear']);
const LIST_FIELDS = new Set<NarrowingField>(['mediaTypes', 'genres']);

/**
 * A URL number: empty or non-numeric is `null`, never `NaN`. Takes `unknown`
 * so a route can hand it a `req.query` value (an array reads as absent).
 */
export function parseUrlNumber(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** A comma-separated URL list, trimmed, empties dropped. `unknown` as above. */
export function parseUrlList(v: unknown): string[] {
  return (typeof v === 'string' ? v : '').split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Decode the given fields from the address bar.
 *
 * An ABSENT number key falls back to `defaults` — that is how
 * `/recommendations` carries its `minYear: 2000` default — while a present but
 * empty one decodes to `null`.
 */
export function decodeNarrowing<K extends NarrowingField>(
  params: URLSearchParams,
  fields: readonly K[],
  defaults: NarrowingUrlState = NARROWING_DEFAULTS,
): Pick<NarrowingUrlState, K> {
  const out = {} as Record<NarrowingField, unknown>;
  for (const f of fields) {
    const key = NARROWING_URL_KEYS[f];
    if (f === 'search') out[f] = params.get(key) || defaults.search;
    else if (LIST_FIELDS.has(f)) out[f] = params.has(key) ? parseUrlList(params.get(key)) : [...(defaults[f] as string[])];
    else out[f] = params.has(key) ? parseUrlNumber(params.get(key)) : defaults[f];
  }
  return out as Pick<NarrowingUrlState, K>;
}

/**
 * Write the given fields into `params`. A value equal to its default is
 * omitted, so a URL stays sparse; `keys` picks the URL or the API key space.
 *
 * For the API key space, keep `defaults` at `NARROWING_DEFAULTS`: a page
 * default (the feed's `minYear: 2000`) is a filter the server must receive.
 */
export function encodeNarrowing<K extends NarrowingField>(
  params: URLSearchParams,
  state: Pick<NarrowingUrlState, K>,
  fields: readonly K[],
  keys: Record<NarrowingField, string> = NARROWING_URL_KEYS,
  defaults: NarrowingUrlState = NARROWING_DEFAULTS,
): URLSearchParams {
  for (const f of fields) {
    const v = state[f] as NarrowingUrlState[NarrowingField];
    if (f === 'search') {
      if (v) params.set(keys[f], v as string);
    } else if (LIST_FIELDS.has(f)) {
      if ((v as string[]).length > 0) params.set(keys[f], (v as string[]).join(','));
    } else if (NUMBER_FIELDS.has(f)) {
      if (v !== null && v !== defaults[f]) params.set(keys[f], String(v));
    }
  }
  return params;
}

type Query = Partial<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * The server half: read every narrowing dimension off a route's `req.query`
 * (`NARROWING_API_KEYS`), ready for `applyNarrowingFilters`. Empty dimensions
 * come back `undefined`/`null`, which that function treats as "no filter".
 */
export function parseNarrowingQuery(query: Query): NarrowingFilters {
  const list = (f: NarrowingField) => {
    const l = parseUrlList(query[NARROWING_API_KEYS[f]]);
    return l.length > 0 ? l : undefined;
  };
  const num = (f: NarrowingField) => parseUrlNumber(query[NARROWING_API_KEYS[f]]);
  const search = one(query[NARROWING_API_KEYS.search])?.trim();
  return {
    search: search || undefined,
    mediaTypes: list('mediaTypes'),
    minScore: num('minScore'),
    maxScore: num('maxScore'),
    minYear: num('minYear'),
    maxYear: num('maxYear'),
    genres: list('genres'),
  };
}
