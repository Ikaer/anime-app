/**
 * The shared narrowing-filter codec (`lib/url/narrowingParams.ts`).
 *
 * Seven URL hooks and six API routes used to decode these dimensions by hand.
 * The failure that consolidation removes — and that these tests keep removed —
 * is silent: a dimension one half forgets still moves its control and still
 * renders a list; it just never reaches the server, or never survives a reload.
 *
 * The sample is typed `NarrowingUrlState`, so a NEW dimension is a compile error
 * here until it is filled in, and a runtime failure until the codec carries it
 * through all three paths (URL round-trip, API encode, server parse).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeNarrowing, encodeNarrowing, parseNarrowingQuery, NARROWING_API_KEYS, NARROWING_DEFAULTS,
  NARROWING_FIELDS, NARROWING_FIELDS_NO_GENRES, NARROWING_URL_KEYS, type NarrowingUrlState,
} from '@/lib/url/narrowingParams';

/** Every field off its default, so an omitted one cannot pass by accident. */
const SAMPLE: NarrowingUrlState = {
  search: 'steins gate',
  mediaTypes: ['tv', 'movie'],
  minScore: 7.5,
  maxScore: 9,
  minYear: 1998,
  maxYear: 2011,
  genres: ['Sci-Fi', 'Suspense'],
};

const toQuery = (p: URLSearchParams) => Object.fromEntries(p.entries());

test('every field round-trips through the URL key space', () => {
  const params = encodeNarrowing(new URLSearchParams(), SAMPLE, NARROWING_FIELDS);
  assert.deepEqual(decodeNarrowing(params, NARROWING_FIELDS), SAMPLE);
});

test('every field reaches the server through the API key space', () => {
  const params = encodeNarrowing(new URLSearchParams(), SAMPLE, NARROWING_FIELDS, NARROWING_API_KEYS);
  // `NarrowingFilters` and `NarrowingUrlState` share field names on purpose.
  assert.deepEqual(parseNarrowingQuery(toQuery(params)), SAMPLE);
});

test('the two key spaces are each collision-free and cover every field', () => {
  for (const keys of [NARROWING_URL_KEYS, NARROWING_API_KEYS]) {
    assert.deepEqual(Object.keys(keys).sort(), [...NARROWING_FIELDS].sort());
    assert.equal(new Set(Object.values(keys)).size, NARROWING_FIELDS.length);
  }
});

test('defaults stay out of the URL, and an empty filter reads as no filter', () => {
  assert.equal(encodeNarrowing(new URLSearchParams(), NARROWING_DEFAULTS, NARROWING_FIELDS).toString(), '');
  assert.deepEqual(parseNarrowingQuery({}), {
    search: undefined, mediaTypes: undefined, minScore: null, maxScore: null,
    minYear: null, maxYear: null, genres: undefined,
  });
});

// `/recommendations` defaults `minYear` to 2000. An absent key must decode to
// that default (not null), and the default must not be written back — while the
// API encode still sends it, or the server would rank the whole back catalog.
test('a page default rides on absence in the URL but is still sent to the API', () => {
  const recoDefaults = { ...NARROWING_DEFAULTS, minYear: 2000 };
  const state = decodeNarrowing(new URLSearchParams(), NARROWING_FIELDS, recoDefaults);
  assert.equal(state.minYear, 2000);
  assert.equal(encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS, NARROWING_URL_KEYS, recoDefaults).toString(), '');
  const api = encodeNarrowing(new URLSearchParams(), state, NARROWING_FIELDS, NARROWING_API_KEYS);
  assert.equal(parseNarrowingQuery(toQuery(api)).minYear, 2000);
});

test('garbage numbers decode to null, never NaN', () => {
  // NaN is the old routes' `parseFloat` failure mode: `!= null` lets it through
  // and every `mean >= NaN` comparison then drops the whole list.
  const q = parseNarrowingQuery({ minScore: 'abc', maxYear: '', minYear: ['1999', '2000'] });
  assert.equal(q.minScore, null);
  assert.equal(q.maxYear, null);
  assert.equal(q.minYear, null);
});

test('a page without genres neither reads nor writes them', () => {
  const params = new URLSearchParams({ g: 'Drama', q: 'x' });
  const state = decodeNarrowing(params, NARROWING_FIELDS_NO_GENRES);
  assert.equal('genres' in state, false);
  assert.equal(state.search, 'x');
});
