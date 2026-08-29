/**
 * `searchCatalog`'s fuzzy fallback — the typo-tolerant second pass.
 *
 * What is pinned here is only what fails SILENTLY. A fuzzy miss is not a crash
 * and not a build error: the header box simply renders one row fewer, and the
 * title the user was reaching for is indistinguishable from a title the catalog
 * does not hold. Nothing else in the pipeline can tell you the difference.
 *
 * Three invariants, each verified by breaking it first:
 *
 *  1. The k+2 pigeonhole split. At k+1 (the classic bound) `freiren` loses
 *     `Frieren` outright, because a Damerau transposition straddling a piece
 *     boundary damages TWO pieces with one edit. This is the ⚠️ the module
 *     carries and the reason the test exists at all. It is also the ONLY
 *     discriminating case among the ten typo fixtures measured against the live
 *     store — every other one passes either split — so review would not have
 *     caught a regression here and this assertion is the whole defence.
 *  2. Damerau over Levenshtein. Drop the transposition term and `nartuo`,
 *     `mononkoe`, `bersrek` and `freiren` all return nothing — a transposition
 *     costs 2 under plain Levenshtein, which busts a k=1 budget.
 *  3. The exact/fuzzy ordering and the thinness gate. A fuzzy hit must never
 *     displace a literal one, and a query that already fills the list must not
 *     be touched by the second pass at all.
 *
 * NOT pinned: which titles a given query returns beyond the one asserted, or
 * how many. The tolerance ladder is a tuning choice measured against the live
 * store, not an invariant, and freezing a result count here would turn every
 * future tuning run red for no reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchCatalog } from '@/lib/domain/globalSearch';
import type { AnimeRecord } from '@/models/anime';

/** Minimal record: the fields `searchCatalog` actually reads, nothing else. */
function rec(id: string, title: string, extra?: { en?: string; ja?: string; synonyms?: string[]; mean?: number }): AnimeRecord {
  return {
    id,
    crosswalk: {},
    catalog: {
      title,
      alternativeTitles: {
        en: extra?.en ?? '',
        ja: extra?.ja ?? '',
        synonyms: extra?.synonyms ?? [],
      },
      pictures: [],
      genres: [],
      relatedAnime: [],
      studios: [],
      mean: extra?.mean,
    },
    personal: {},
    sources: {},
    provenance: { catalog: {}, personal: {} },
  };
}

const CATALOG: AnimeRecord[] = [
  rec('a_1', 'Steins;Gate', { mean: 9.07 }),
  rec('a_13', 'Rozen Maiden: Träumend', { mean: 7.6 }),
  // TWO diacritics: NFD alone leaves two combining marks, i.e. two edits, which
  // busts the k=1 budget a 7-character query gets. Only STRIPPING them matches.
  rec('a_15', 'Fuka Ryouiki no Déjà vu', { mean: 8.1 }),
  // Carries "monoke" mid-word (rank 3, the weakest exact rank) with a LOW mean,
  // against a_10 "Mononoke" which is one edit away with a HIGH one. That pairing
  // is what makes the exact/fuzzy band boundary observable — see the ordering test.
  rec('a_14', 'Amonoken', { mean: 6.0 }),
  // Eight titles sharing a literal token, so a query for it saturates ANIME_LIMIT
  // on the exact pass alone — the setup the thinness gate is about.
  ...Array.from({ length: 8 }, (_, i) => rec(`a_2${i}0`, `Gundam ${i + 1}`, { mean: 7 + i / 10 })),
  // One edit from "gundam", and never an exact match for it.
  rec('a_99', 'Gundan Chronicle', { mean: 9.9 }),
  rec('a_2', 'Sword Art Online', { mean: 7.2 }),
  rec('a_3', 'Naruto', { mean: 8.0 }),
  rec('a_4', 'Kaguya-sama wa Kokurasetai: Ultra Romantic', { mean: 9.1 }),
  rec('a_5', 'Made in Abyss', { mean: 8.7 }),
  rec('a_6', 'Sousou no Frieren', { mean: 9.3 }),
  rec('a_7', 'Cowboy Bebop', { mean: 8.75 }),
  rec('a_8', 'Mushishi', { mean: 8.6 }),
  rec('a_9', 'Monster', { mean: 8.9 }),
  rec('a_10', 'Mononoke', { mean: 8.4 }),
  rec('a_11', 'Berserk', { mean: 8.5 }),
  rec('a_12', 'Bleach', { mean: 7.9 }),
];

const ids = (q: string) => searchCatalog(q, CATALOG, 'romaji').animes.map(h => h.id);

// ---------------------------------------------------------------------------
// 1. The k+2 pigeonhole split — the load-bearing one.
// ---------------------------------------------------------------------------

/**
 * `freiren` -> `frieren` is one Damerau edit (the `ie`/`ei` swap), well inside
 * the k=1 budget a 7-character query gets. The DP would find it. The PREFILTER
 * is what loses it: at k+1 the pieces are `fre` / `iren`, the transposition sits
 * across their boundary and corrupts both, neither occurs in `frieren`, and the
 * title is discarded before the DP ever runs. At k+2 the pieces are
 * `fr` / `ei` / `ren` and `fr` survives.
 *
 * Set `parts = k + 1` in gatePieces and this is the only test in the file that
 * fails — verified.
 */
test('k+2 pigeonhole split: a transposition straddling a piece boundary still matches', () => {
  assert.ok(ids('freiren').includes('a_6'), 'Frieren must survive the prefilter');
});

// ---------------------------------------------------------------------------
// 2. Damerau, not Levenshtein.
// ---------------------------------------------------------------------------

/** 6 chars -> k=1. A transposition is 1 edit under Damerau and 2 under Levenshtein. */
test('Damerau: a transposition inside the tolerance is one edit, not two', () => {
  assert.ok(ids('nartuo').includes('a_3'), 'nartuo -> Naruto needs the transposition term');
});

/**
 * Two more k=1 transpositions, kept because they cover different positions
 * (interior and adjacent-to-the-end) and each fails on its own when the
 * transposition term is removed.
 */
test('Damerau: interior and trailing transpositions both match at k=1', () => {
  assert.ok(ids('mononkoe').includes('a_10'), 'mononkoe -> Mononoke');
  assert.ok(ids('bersrek').includes('a_11'), 'bersrek -> Berserk');
});

/**
 * The two long-query shapes. Neither NEEDS Damerau — at k=2 a transposition is
 * affordable as two substitutions, measured — so these pin the tolerance ladder
 * (that a 16-character query gets a budget of 2 at all), not the DP's recurrence.
 */
test('a long query tolerates a substitution and a transposition alike', () => {
  assert.ok(ids('swort art online').includes('a_2'), 'substitution');
  assert.ok(ids('sowrd art online').includes('a_2'), 'transposition');
});

// ---------------------------------------------------------------------------
// 3. Normalization — punctuation the user does not type.
// ---------------------------------------------------------------------------

/**
 * Diacritic folding, the one half of `normalize` that survived measurement:
 * `traumend` must reach `Träumend`. Drop the combining-mark strip and this
 * fails — the umlaut is an edit the budget then has to pay for, and at k=1 for
 * an 8-character query there is none to spare.
 *
 * Punctuation folding is deliberately NOT tested, because it is deliberately
 * not done — see the ⚠️ on `normalize`.
 */
test('diacritics are stripped, not merely decomposed', () => {
  // One diacritic is not enough to prove anything: NFD splits it into a base
  // letter plus one combining mark, which the edit budget absorbs on its own.
  assert.ok(ids('traumend').includes('a_13'), 'traumend -> Traeumend');
  // Two of them cost two edits against a 7-char query's budget of one, so this
  // half only passes when the combining marks are actually removed.
  assert.ok(ids('deja vu').includes('a_15'), 'deja vu -> Deja vu');
});

/**
 * Punctuation still costs an edit rather than being folded, so this passes on
 * the tolerance budget alone. Pinned to record that the punctuation cases DO
 * work, so nobody re-adds the folding to "fix" them.
 */
test('a punctuation difference is absorbed by the edit budget', () => {
  assert.ok(ids('kaguya sama').includes('a_4'), 'kaguya sama -> Kaguya-sama');
  assert.ok(ids('steins gate').includes('a_1'), 'steins gate -> Steins;Gate');
});

/**
 * `deja vu` against `Deja vu` is distance ZERO once the diacritics are stripped,
 * yet the query does not literally occur in the stored title. It must therefore
 * still be reported as fuzzy and stay inside the fuzzy rank band — the rank
 * arithmetic (`FUZZY_RANK_BASE + max(0, best - 1)`) is what keeps a distance-0
 * fuzzy hit from landing on rank 3 and outranking real substring matches.
 */
test('a diacritics-only match is reported as fuzzy, not exact', () => {
  const hit = searchCatalog('deja vu', CATALOG, 'romaji').animes.find(h => h.id === 'a_15');
  assert.ok(hit, 'Deja vu must be found');
  assert.equal(hit.fuzzy, true);
});

// ---------------------------------------------------------------------------
// 4. Ordering and the thinness gate.
// ---------------------------------------------------------------------------

/**
 * The band boundary, set up to be genuinely at risk: `monoke` occurs literally
 * in `Amonoken` (a_14) but only mid-word, which is rank 3 — the WEAKEST exact
 * rank — and that title is scored 6.0. `Mononoke` (a_10) is one edit away and
 * scored 8.4. Ties break on mean, so the moment the fuzzy band overlaps rank 3
 * the higher-scored fuzzy hit jumps the literal one.
 *
 * Lower FUZZY_RANK_BASE from 4 to 3 and this test fails — verified. Without the
 * low-mean/high-mean pairing it does not, which is why the fixture is shaped
 * this way rather than using any two titles that happen to match.
 */
test('a weak exact hit still outranks a strong fuzzy one', () => {
  const hits = searchCatalog('monoke', CATALOG, 'romaji').animes;
  const exact = hits.findIndex(h => h.id === 'a_14');
  const fuzzy = hits.findIndex(h => h.id === 'a_10');
  assert.ok(exact >= 0, 'Amonoken is a literal substring match and must be present');
  assert.ok(fuzzy >= 0, 'Mononoke is one edit away and must be present');
  assert.ok(exact < fuzzy, 'a fuzzy hit was ordered above a literal one');
  assert.equal(hits[exact].fuzzy, undefined);
  assert.equal(hits[fuzzy].fuzzy, true);
});

/**
 * A saturated query is unchanged by the feature: eight titles carry `Gundam`
 * literally, and `Gundan Chronicle` is one edit away and scored 9.9 — higher
 * than every real Gundam here — yet must not appear.
 *
 * ⚠️ This pins the RANK BANDS, not the thinness gate. Removing the gate leaves
 * this green (verified), because a fuzzy hit is rank >= 4 and can never reach a
 * slice already full of rank-1 hits. That is precisely why the gate is only an
 * optimization and is documented as one — there is no way to observe it from
 * out here, so no test claims to.
 */
test('a query that already fills the list is unchanged by the fuzzy band', () => {
  const hits = searchCatalog('gundam', CATALOG, 'romaji').animes;
  assert.equal(hits.length, 8);
  assert.ok(hits.every(h => !h.fuzzy), 'no fuzzy hit may appear once the exact pass is full');
  assert.ok(!hits.some(h => h.id === 'a_99'), 'Gundan must not displace a real Gundam');
});

/**
 * The gate that makes this feature cheap AND safe: below FUZZY_MIN_LENGTH
 * there is no tolerance, so short queries behave exactly as they did before the
 * fuzzy pass existed. `berserk` mistyped short must not drag in the catalog.
 */
test('queries shorter than the fuzzy minimum stay strictly exact', () => {
  // `bles` is one edit from `Bleach`'s prefix, but 4 chars -> k=0.
  assert.deepEqual(ids('bles'), []);
});

test('a query with no exact and no near match returns nothing', () => {
  assert.deepEqual(ids('zzzzzqqqqq'), []);
});

/**
 * An exact query must be untouched by the second pass — same rows, all marked
 * non-fuzzy. This is the "a query that works today cannot change" contract.
 */
test('an exact query is not altered by the fuzzy pass', () => {
  const hits = searchCatalog('cowboy bebop', CATALOG, 'romaji').animes;
  assert.deepEqual(hits.map(h => h.id), ['a_7']);
  assert.equal(hits[0].fuzzy, undefined);
});

// ---------------------------------------------------------------------------
// 5. The index is memoized on the catalog's identity.
// ---------------------------------------------------------------------------

/**
 * A stale normalized index would answer from the previous catalog — invisible,
 * since the rows it returns are perfectly well-formed. The WeakMap keys on the
 * array's identity, so a rebuilt catalog must be re-normalized.
 */
test('a rebuilt catalog is re-normalized rather than answered from the old index', () => {
  // Warm the cache on one array...
  const first = [rec('a_100', 'Vinland Saga')];
  assert.deepEqual(searchCatalog('vinladn saga', first, 'romaji').animes.map(h => h.id), ['a_100']);

  // ...then query a DIFFERENT array with a fuzzy term only its own title can
  // satisfy. A single-slot or mis-keyed cache would still hold "vinland saga"
  // here and find nothing — while returning a perfectly well-formed empty list.
  const second = [rec('a_200', 'Mushishi')];
  assert.deepEqual(searchCatalog('mushsihi', second, 'romaji').animes.map(h => h.id), ['a_200']);
});
