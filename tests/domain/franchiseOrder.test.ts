/**
 * `buildFranchiseView` — the watch line `/franchise/[id]` renders.
 *
 * What is pinned here is only what fails SILENTLY. The page is a list of rows
 * with dates on them; every failure below still renders a full, plausible page,
 * and the reader has no way to tell it is wrong:
 *
 *  - an undated entry drifting to the head of the line (the `NaN` comparator
 *    trap) means the watch order opens on a special;
 *  - the franchise being named after the catalog's first element rather than
 *    the earliest aired one means a 131-entry Gundam page titled after whatever
 *    the crawl landed first;
 *  - "watch next" pointing at something dropped, or at something not yet aired,
 *    means the one recommendation on the page is unactionable.
 *
 * Nothing here asserts the CONTENT of an ordering (that would just restate the
 * data), and nothing asserts the naming heuristic is good — that was a
 * measurement, recorded in the module, not an invariant.
 *
 * Each test below was verified by breaking the thing it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFranchiseView, compareByAirDate } from '@/lib/domain/franchiseOrder';
import type { AnimeRecord } from '@/models/anime';

/**
 * The minimum a record needs to reach this module: a canonical id, the catalog
 * fields the line reads, and a `personal` block, since the effective-state
 * helpers read the hydrated one rather than the raw slices.
 */
function rec(
  id: string,
  catalog: Partial<AnimeRecord['catalog']>,
  personal: Partial<AnimeRecord['personal']> = {}
): AnimeRecord {
  return {
    id,
    crosswalk: {},
    catalog: { title: id, ...catalog } as AnimeRecord['catalog'],
    personal: personal as AnimeRecord['personal'],
    sources: {},
    provenance: { catalog: {}, personal: {} },
  } as AnimeRecord;
}

/**
 * The load-bearing one. `Date.parse(undefined)` is `NaN`, and every comparison
 * against `NaN` is false — so a comparator that forwards it returns 0 for every
 * pair touching an undated entry, and Array#sort leaves those entries roughly
 * where the input put them. Feed the undated one FIRST, which is what a catalog
 * scan can hand over, and the symptom is a watch order that opens on it.
 */
test('an undated entry sorts to the end of the line, not the head', () => {
  const view = buildFranchiseView(
    [
      rec('a_undated', {}),
      rec('a_2007', { startDate: '2007-12-01' }),
      rec('a_2009', { startDate: '2009-08-08' }),
    ],
    'a_2007',
    'romaji'
  );
  assert.deepEqual(view.entries.map(e => e.id), ['a_2007', 'a_2009', 'a_undated']);
  assert.deepEqual(view.entries.map(e => e.position), [1, 2, 3]);
});

/** The same trap, at the comparator, in both argument orders. */
test('the undated sentinel holds whichever side it lands on', () => {
  const dated = rec('a_1', { startDate: '2007-12-01' });
  const undated = rec('a_2', {});
  assert.ok(compareByAirDate(undated, dated, 'romaji') > 0);
  assert.ok(compareByAirDate(dated, undated, 'romaji') < 0);
});

/**
 * The name is read off `entries[0]` AFTER the sort, which is the whole reason
 * the sort happens first. Reading `members[0]` instead would pass on any input
 * that happens to arrive in air order — so the input here deliberately does not.
 */
test('the franchise is named after its earliest aired member, not the input order', () => {
  const view = buildFranchiseView(
    [
      rec('a_late', { title: 'Gundam Perfect Mission', startDate: '2009-01-01' }),
      rec('a_first', { title: 'Mobile Suit Gundam', startDate: '1979-04-07' }),
    ],
    'a_late',
    'romaji'
  );
  assert.equal(view.name, 'Mobile Suit Gundam');
});

/**
 * `dropped` is a decision, not a gap: the line has moved past it. Without the
 * `SETTLED` set holding both statuses, the page's single call to action points
 * at an abandoned title forever, and re-points at it after every sync.
 */
test('watch-next steps over a dropped entry', () => {
  const view = buildFranchiseView(
    [
      rec('a_1', { startDate: '2001-01-01' }, { status: 'completed' }),
      rec('a_2', { startDate: '2002-01-01' }, { status: 'dropped' }),
      rec('a_3', { startDate: '2003-01-01' }),
    ],
    'a_1',
    'romaji'
  );
  assert.equal(view.nextUpId, 'a_3');
});

/**
 * A `watching` entry IS what to watch next — resuming it is the action. Pinned
 * because "not completed and not dropped" reads like it could be tightened to
 * "untouched", which would skip past a series you are halfway through.
 */
test('watch-next stops on an entry already in progress', () => {
  const view = buildFranchiseView(
    [
      rec('a_1', { startDate: '2001-01-01' }, { status: 'completed' }),
      rec('a_2', { startDate: '2002-01-01' }, { status: 'watching', progress: 5 }),
      rec('a_3', { startDate: '2003-01-01' }),
    ],
    'a_1',
    'romaji'
  );
  assert.equal(view.nextUpId, 'a_2');
});

/** You cannot watch what has not aired; the announced sequel is not the answer. */
test('watch-next skips an unaired entry and reports null once the line is done', () => {
  const view = buildFranchiseView(
    [
      rec('a_1', { startDate: '2001-01-01', airingStatus: 'finished_airing' }, { status: 'completed' }),
      rec('a_2', { startDate: '2027-01-01', airingStatus: 'not_yet_aired' }),
    ],
    'a_1',
    'romaji'
  );
  assert.equal(view.nextUpId, null);
  assert.equal(view.unairedCount, 1);
});

/**
 * `episodesRemaining` answers "how much is left", so it must exclude what has
 * aired-and-finished, exclude what cannot be watched yet, and credit progress
 * already made. Each clause is a separate way to overstate the number, and an
 * overstated one is indistinguishable from a correct one on screen.
 */
test('episodes remaining counts only aired, unfinished episodes and credits progress', () => {
  const view = buildFranchiseView(
    [
      rec('a_done', { startDate: '2001-01-01', numEpisodes: 12 }, { status: 'completed' }),
      rec('a_half', { startDate: '2002-01-01', numEpisodes: 24 }, { status: 'watching', progress: 19 }),
      rec('a_new', { startDate: '2003-01-01', numEpisodes: 13 }),
      rec('a_soon', { startDate: '2027-01-01', numEpisodes: 12, airingStatus: 'not_yet_aired' }),
    ],
    'a_done',
    'romaji'
  );
  assert.equal(view.progress.episodesRemaining, 5 + 13);
  // The total is every entry that HAS a count, unaired included — a different
  // question ("how big is this franchise") with a different answer.
  assert.equal(view.progress.episodesTotal, 12 + 24 + 13 + 12);
  assert.equal(view.progress.completed, 1);
  assert.equal(view.progress.started, 1);
  assert.equal(view.progress.untouched, 2);
});

/**
 * The focus mark is presentation only. Pinned because it would be natural to
 * "improve" the page by starting the line at the title you arrived from, which
 * would make the same franchise render differently through each of its members.
 */
test('the focus member marks a row without changing the order or the name', () => {
  const members = [
    rec('a_1', { title: 'First', startDate: '2001-01-01' }),
    rec('a_2', { title: 'Second', startDate: '2002-01-01' }),
  ];
  const fromFirst = buildFranchiseView(members, 'a_1', 'romaji');
  const fromSecond = buildFranchiseView(members, 'a_2', 'romaji');
  assert.deepEqual(
    fromFirst.entries.map(e => e.id),
    fromSecond.entries.map(e => e.id)
  );
  assert.equal(fromFirst.name, fromSecond.name);
  assert.deepEqual(fromSecond.entries.map(e => e.isFocus), [false, true]);
});
