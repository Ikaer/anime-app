/**
 * URL encode/decode for the main list's filter state.
 *
 * The URL is this app's single source of truth for filters, and adding a
 * dimension touches ~6 places (the interface, `DEFAULT_FILTERS`, `PARAM_KEYS`,
 * encode, decode, plus the request-param build and the API handler). Forget the
 * encode or the decode half and nothing breaks loudly: the control still moves,
 * the list still renders, the filter just does not survive a reload or a shared
 * link — which is the one thing the URL exists to do.
 *
 * The round-trip below is the guard. Its sample is typed `AnimeFiltersState`,
 * so a **new field is a compile error here** until it is filled in, and once
 * filled in it fails at runtime until both halves handle it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeStateToUrl, decodeUrlToState, hasAnyParams, DEFAULT_FILTERS,
  type AnimeFiltersState,
} from '@/lib/url/animeParams';
import { applyNarrowingFilters } from '@/lib/domain/animeUtils';
import type { AnimeRecord, UserAnimeStatus, SeasonName, SortColumn } from '@/models/anime';

/** `encodeStateToUrl` returns a path (`/?s=…`), not a bare query string. */
const query = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1));
const roundTrip = (state: AnimeFiltersState) => decodeUrlToState(query(encodeStateToUrl(state)));

const keysOf = <T extends string>(o: Record<T, 0>) => Object.keys(o) as T[];

const STATUSES = keysOf({
  watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0, not_defined: 0,
} satisfies Record<UserAnimeStatus | 'not_defined', 0>);

const SEASONS = keysOf({
  winter: 0, spring: 0, summer: 0, fall: 0,
} satisfies Record<SeasonName, 0>);

const SORT_COLUMNS = keysOf({
  title: 0, mean: 0, start_date: 0, status: 0, num_episodes: 0,
  rank: 0, popularity: 0, num_list_users: 0, num_scoring_users: 0,
} satisfies Record<SortColumn, 0>);

/**
 * Every field set to something the defaults are not — including the awkward
 * ones: an ampersand and spaces in the search (URL escaping), two seasons
 * out of chronological order (the list is not sorted on the way through), a
 * fractional score bound, and a genre name containing a space.
 */
const FULL: AnimeFiltersState = {
  statusFilters: ['watching', 'dropped', 'not_defined'],
  searchQuery: 'cowboy bebop & co',
  seasons: [{ year: 2024, season: 'fall' }, { year: 1998, season: 'spring' }],
  mediaTypes: ['tv', 'ova'],
  genres: ['Action', 'Slice of Life', 'Sci-Fi'],
  hiddenOnly: true,
  discrepanciesOnly: true,
  unratedOnly: true,
  minScore: 6.5,
  maxScore: 9,
  sortBy: 'num_scoring_users',
  sortDir: 'asc',
};

/**
 * Guards the guard: if a default ever drifts to match the sample, that field's
 * round-trip would pass without the encoder touching it at all.
 */
test('the round-trip sample differs from the defaults in every field', () => {
  const same = (Object.keys(FULL) as (keyof AnimeFiltersState)[])
    .filter(k => JSON.stringify(FULL[k]) === JSON.stringify(DEFAULT_FILTERS[k]));
  assert.deepEqual(same, []);
});

test('every filter field survives a URL round-trip', () => {
  assert.deepEqual(roundTrip(FULL), FULL);
});

test('an empty URL decodes to exactly the defaults', () => {
  assert.deepEqual(decodeUrlToState(new URLSearchParams('')), DEFAULT_FILTERS);
});

/**
 * ⚠️ The status param is THREE-state, and the middle one is easy to lose:
 * absent means "all" (so the common case keeps the URL short), `s=` means
 * "none selected", and neither can be represented by the other. Collapse the
 * empty string into the absent case and deselecting every status silently
 * shows the whole catalog instead of nothing.
 */
test('statusFilters distinguishes absent (all) from empty (none)', () => {
  assert.deepEqual(decodeUrlToState(new URLSearchParams('')).statusFilters, DEFAULT_FILTERS.statusFilters);
  assert.deepEqual(roundTrip({ ...DEFAULT_FILTERS, statusFilters: [] }).statusFilters, []);
  assert.deepEqual(roundTrip({ ...DEFAULT_FILTERS, statusFilters: ['on_hold'] }).statusFilters, ['on_hold']);
});

/**
 * The status and season code tables have HAND-WRITTEN inverses, so a typo in
 * one direction or a code used twice is invisible until a URL comes back wrong.
 * Checked one value at a time so the failure names the value.
 */
test('every status code round-trips', () => {
  for (const status of STATUSES) {
    assert.deepEqual(roundTrip({ ...DEFAULT_FILTERS, statusFilters: [status] }).statusFilters, [status], status);
  }
});

test('every season code round-trips, year included', () => {
  for (const season of SEASONS) {
    assert.deepEqual(roundTrip({ ...DEFAULT_FILTERS, seasons: [{ year: 2011, season }] }).seasons,
      [{ year: 2011, season }], season);
  }
});

/**
 * `CODE_TO_SORT` is DERIVED from `SORT_TO_CODE`, so it can never disagree —
 * but a duplicate code on the encode side collapses two columns into one and
 * the derived inverse just picks the last. This is what would catch that.
 */
test('every sort column round-trips, in both directions', () => {
  for (const sortBy of SORT_COLUMNS) {
    assert.equal(roundTrip({ ...DEFAULT_FILTERS, sortBy }).sortBy, sortBy);
  }
  assert.equal(roundTrip({ ...DEFAULT_FILTERS, sortDir: 'asc' }).sortDir, 'asc');
  assert.equal(roundTrip({ ...DEFAULT_FILTERS, sortDir: 'desc' }).sortDir, 'desc');
});

/**
 * A hand-edited or stale URL must land on a usable list, never a crash — this
 * is a TV browser with no console anyone reads.
 */
test('unparseable params fall back to defaults instead of throwing', () => {
  const decoded = decodeUrlToState(new URLSearchParams('so=nope&d=x&sn=9999-q&s=zz'));
  assert.equal(decoded.sortBy, DEFAULT_FILTERS.sortBy);
  assert.equal(decoded.sortDir, DEFAULT_FILTERS.sortDir);
  assert.deepEqual(decoded.seasons, []);
  assert.deepEqual(decoded.statusFilters, [], 'an unknown status code selects nothing, not everything');
});

/**
 * ⚠️ A malformed score bound decodes to **NaN, not null** — it is a bare
 * `parseFloat`. That is not a bug to fix here, and tightening the decoder in
 * isolation would miss the point: the property that actually matters is that an
 * unusable bound never narrows anything, and it is `applyNarrowingFilters` that
 * guarantees it, by testing `Number.isFinite` before applying either bound.
 *
 * So the two halves are pinned together. Tighten the decode to null later and
 * this still passes; remove the downstream guard and it fails — which is the
 * end where a stale `?min=` would actually start hiding rows.
 *
 * (Worth knowing if you probe this by hand: `JSON.stringify(NaN)` is `"null"`,
 * so dumping the decoded state shows a tidy `null` and tells you nothing.)
 */
test('a malformed score bound never narrows the list', () => {
  const decoded = decodeUrlToState(new URLSearchParams('min=abc&max='));
  for (const bound of [decoded.minScore, decoded.maxScore]) {
    assert.ok(bound === null || !Number.isFinite(bound), 'an unusable bound must not be a usable number');
  }

  const rows = [
    { catalog: { mean: 8.5 } },
    { catalog: { mean: 4 } },
    { catalog: {} },
  ] as unknown as AnimeRecord[];

  assert.equal(
    applyNarrowingFilters(rows, { minScore: decoded.minScore, maxScore: decoded.maxScore }).length,
    rows.length,
    'every row survives a NaN bound',
  );
  // The same call with a real bound must still filter, or the assertion above
  // would pass just as well against a function that ignores bounds entirely.
  assert.equal(applyNarrowingFilters(rows, { minScore: 5 }).length, 1);
});

test('hasAnyParams tells an empty URL from a filtered one', () => {
  assert.equal(hasAnyParams(new URLSearchParams('')), false);
  assert.equal(hasAnyParams(query(encodeStateToUrl(FULL))), true);
});
