/**
 * « Anime court » — `domain/quickAnime.ts`.
 *
 * Every failure below leaves a feed that renders perfectly: the cards look like
 * any other card, the filter's button is lit, and the reader finds out it lied
 * three episodes in or twenty-six. That is the whole reason this file exists.
 *
 *  - an unknown episode count admitted (`(numEpisodes || 0) <= 15`) lets in
 *    exactly the population whose length is the open question — everything
 *    currently airing;
 *  - reading MAL's `catalog.relatedAnime` alone calls nearly every sequel-having
 *    show standalone: that field is populated on 48 of ~25k titles while
 *    AniList's covers 11k, which is the trap `domain/relations.ts` was written
 *    for;
 *  - treating a side story or a spin-off as a continuation would empty the
 *    filter of most of what it is for — an OVA hanging off a 12-episode show
 *    does not make that show longer to watch.
 *
 * Nothing here asserts the cap's VALUE (15 is a judgement, recorded in the
 * module) and nothing restates the types. Each test was verified by breaking
 * the thing it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuickAnime, hasShortRun, isSingleSeason, QUICK_MAX_EPISODES } from '@/lib/domain/quickAnime';
import { buildRelationIndex } from '@/lib/domain/relations';
import type { AnimeRecord, AniListRelationEntry } from '@/models/anime';

/** The minimum a record needs here: an id, an episode count, and relations. */
function rec(
  id: string,
  numEpisodes: number | undefined,
  opts: { anilistId?: number; malId?: number; anilistRelations?: AniListRelationEntry[]; malRelations?: AnimeRecord['catalog']['relatedAnime'] } = {}
): AnimeRecord {
  return {
    id,
    crosswalk: { anilist: opts.anilistId, mal: opts.malId },
    catalog: { title: id, numEpisodes, relatedAnime: opts.malRelations } as AnimeRecord['catalog'],
    personal: {} as AnimeRecord['personal'],
    sources: opts.anilistRelations ? { anilist: { relations: opts.anilistRelations } } : {},
    provenance: { catalog: {}, personal: {} },
  } as AnimeRecord;
}

/**
 * The load-bearing one. MAL leaves `num_episodes` at 0/absent on everything it
 * has not finished counting, so "not known to be short" has to read as a NO —
 * an airing 24-episode show is the single most likely thing to slip through.
 */
test('an unknown episode count is not short', () => {
  assert.equal(hasShortRun(rec('a_undef', undefined)), false);
  assert.equal(hasShortRun(rec('a_zero', 0)), false);
  assert.equal(hasShortRun(rec('a_13', 13)), true);
});

test('the cap is inclusive, and one past it is out', () => {
  assert.equal(hasShortRun(rec('a_at', QUICK_MAX_EPISODES)), true);
  assert.equal(hasShortRun(rec('a_over', QUICK_MAX_EPISODES + 1)), false);
});

/**
 * The relations trap: the sequel edge exists ONLY on AniList's payload, which
 * is the normal case on this store. A check reading `catalog.relatedAnime`
 * passes this title as a standalone.
 */
test('a sequel known only to AniList disqualifies', () => {
  const s1 = rec('a_s1', 12, { anilistId: 1, anilistRelations: [{ id: 2, relationType: 'SEQUEL' }] });
  const s2 = rec('a_s2', 12, { anilistId: 2 });
  const index = buildRelationIndex([s1, s2]);
  assert.equal(isSingleSeason(s1, index), false);
  assert.equal(isQuickAnime(s1, index), false);
});

/**
 * And the other direction: a title whose only edge is a PREQUEL is itself a
 * season of something, so it is not a standalone either — even though nothing
 * continues after it.
 */
test('a prequel edge disqualifies too', () => {
  const s1 = rec('a_s1', 12, { anilistId: 1 });
  const s2 = rec('a_s2', 12, { anilistId: 2, anilistRelations: [{ id: 1, relationType: 'PREQUEL' }] });
  const index = buildRelationIndex([s1, s2]);
  assert.equal(isSingleSeason(s2, index), false);
});

/**
 * MAL's own edge still counts where it exists — this is a union of the two
 * payloads, not a switch to AniList's.
 */
test("MAL's own sequel edge disqualifies", () => {
  const s1 = rec('a_s1', 12, {
    malId: 10,
    malRelations: [{ node: { id: 20, title: 'S2' }, relation_type: 'sequel', relation_type_formatted: 'Sequel' }] as AnimeRecord['catalog']['relatedAnime'],
  });
  const s2 = rec('a_s2', 12, { malId: 20 });
  const index = buildRelationIndex([s1, s2]);
  assert.equal(isSingleSeason(s1, index), false);
});

/**
 * The stuff hanging off a show is not a continuation of it. If these counted,
 * the filter would reject most single-cour shows, since an OVA, a recap or a
 * short is nearly universal — and it would reject them silently, looking merely
 * strict.
 */
test('side stories, OVAs, spin-offs and alternatives leave a title standalone', () => {
  const main = rec('a_main', 12, {
    anilistId: 1,
    anilistRelations: [
      { id: 2, relationType: 'SIDE_STORY' },
      { id: 3, relationType: 'SPIN_OFF' },
      { id: 4, relationType: 'SUMMARY' },
      { id: 5, relationType: 'ALTERNATIVE' },
      { id: 6, relationType: 'CHARACTER' },
    ],
  });
  const others = [2, 3, 4, 5, 6].map(n => rec(`a_${n}`, 12, { anilistId: n }));
  const index = buildRelationIndex([main, ...others]);
  assert.equal(isSingleSeason(main, index), true);
  assert.equal(isQuickAnime(main, index), true);
});

/** Both conditions, not either: a self-contained long show is not quick. */
test('both conditions are required', () => {
  const long = rec('a_long', 50, { anilistId: 1 });
  const index = buildRelationIndex([long]);
  assert.equal(isSingleSeason(long, index), true);
  assert.equal(isQuickAnime(long, index), false);
});
