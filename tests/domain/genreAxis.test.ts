/**
 * `genreAxis` — the three axes hiding inside `catalog.genres`.
 *
 * What is pinned here is NOT that the classification is complete: `theme` is
 * the designed fall-through, so an unclassified name is a correct answer and
 * there is nothing to assert about coverage. What IS pinned is the one thing
 * the module can get silently wrong — a name that SHOULD be `genre` or
 * `demographic` falling through to `theme` anyway. That failure is invisible:
 * the filter still renders, the name still appears, it is merely in the wrong
 * group, and nothing in the build or the UI says so.
 *
 * The alias case below is the specific ⚠️ CLAUDE.md carries. Everything else
 * here is the cheap surrounding structure that makes a regression in `key()` or
 * `buildSet()` show up as a named failure rather than as one odd chip on a TV.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genreAxis, groupByAxis, GENRE_AXES } from '@/lib/domain/genreAxis';

/**
 * The load-bearing one. `buildSet` runs every whitelist entry through the same
 * alias map `unionGenres` applies, so the set holds AniList's `Thriller` under
 * MAL's spelling — which is the spelling the store actually contains, since the
 * union normalizes on the way in. Drop the alias from `buildSet` and this is
 * the only symptom: `Suspense` becomes a theme, on 1,000+ titles, silently.
 *
 * `Thriller` itself is deliberately NOT asserted. It cannot reach this function
 * from store data (the union rewrites it), so pinning its answer would freeze a
 * boundary rather than an invariant.
 */
test('the aliased genre keeps the axis under the name the store actually holds', () => {
  assert.equal(genreAxis('Suspense'), 'genre');
});

test('AniList GenreCollection members classify as genre', () => {
  for (const name of ['Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy',
    'Horror', 'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological',
    'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural']) {
    assert.equal(genreAxis(name), 'genre', `${name} should be a genre`);
  }
});

/**
 * The one hand-curated judgement in the module, and therefore the one most
 * likely to be "tidied" away by someone who reads the whitelist as purely
 * transcribed from AniList.
 */
test('the MAL-only genres are genres, not themes', () => {
  for (const name of ['Avant Garde', 'Boys Love', 'Erotica', 'Gag Humor', 'Girls Love', 'Gourmet']) {
    assert.equal(genreAxis(name), 'genre', `${name} should be a genre`);
  }
});

test('the demographic set is exactly the five values, and outranks the genre set', () => {
  for (const name of ['Josei', 'Kids', 'Seinen', 'Shoujo', 'Shounen']) {
    assert.equal(genreAxis(name), 'demographic', `${name} should be a demographic`);
  }
});

/**
 * The fall-through is the design, not a gap — a genre a provider adds next year
 * lands in `theme`, which is imprecise but never unclassified and never a crash.
 */
test('unknown names fall through to theme rather than throwing', () => {
  for (const name of ['Isekai', 'School', 'Vampire', 'Iyashikei', 'Some Genre MAL Adds In 2027', '']) {
    assert.equal(genreAxis(name), 'theme', `${name} should fall through`);
  }
});

/**
 * `key()` trims and lowercases. This is the same class of bug as an
 * unnormalized `staffRoleTier` lookup, which drops 1,549 credits out of their
 * tier — a whitelist match against an unnormalized string fails quietly. Note
 * that failure needs BOTH of staffRole's trims removed; each also guards a case
 * of its own (see tests/domain/staffRole.test.ts).
 */
test('lookup is insensitive to case and surrounding whitespace', () => {
  assert.equal(genreAxis('  Sci-Fi  '), 'genre');
  assert.equal(genreAxis('sci-fi'), 'genre');
  assert.equal(genreAxis('SHOUNEN'), 'demographic');
  assert.equal(genreAxis(' suspense'), 'genre');
});

test('groupByAxis splits all three axes and preserves input order within each', () => {
  const grouped = groupByAxis(['School', 'Action', 'Shounen', 'Isekai', 'Romance']);
  assert.deepEqual(grouped, {
    genre: ['Action', 'Romance'],
    demographic: ['Shounen'],
    theme: ['School', 'Isekai'],
  });
});

test('groupByAxis returns every axis key even when a group is empty', () => {
  const grouped = groupByAxis([]);
  assert.deepEqual(Object.keys(grouped).sort(), [...GENRE_AXES].sort());
  for (const axis of GENRE_AXES) assert.deepEqual(grouped[axis], []);
});
