/**
 * Favourite seiyuu — the rules that fail silently.
 *
 * Every one of these leaves a plausible ranking on screen: a twin role counted
 * twice quietly favours double-casting over leads, a dropped cast-slice union
 * leaves a just-starred favourite inert until the filmography lands, and a
 * stack of bit parts overtaking a lead just reads as "the knob is noisy".
 *
 * Each was verified by breaking the thing it guards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFavSeiyuuIndex,
  favSeiyuuValue,
  hasMainFavSeiyuu,
  FAV_SEIYUU_ROLE_WEIGHT,
  type FavSeiyuuHit,
  type SeiyuuFavorite,
} from '@/lib/reco/favSeiyuu';
import type { AniListCastEntry, AniListSeiyuuEntry } from '@/models/anime';

const fav = (id: number, name = `p${id}`): SeiyuuFavorite => ({ id, name, addedAt: '2026-10-14' });
const hit = (staffId: number, role: FavSeiyuuHit['role']): FavSeiyuuHit => ({ staffId, name: `p${staffId}`, role, characters: [] });

const film = (staffId: number, credits: { anilist: number; mal?: number; chars: [string, string][] }[]): AniListSeiyuuEntry => ({
  staff_id: staffId,
  name: `p${staffId}`,
  complete: true,
  fetched_at: '2026-10-14',
  credits: credits.map(c => ({
    anilist_id: c.anilist,
    mal_id: c.mal,
    characters: c.chars.map(([name, role], i) => ({ id: c.anilist * 100 + i, name, role })),
  })),
});

const castEntry = (chars: { name: string; role: string; vas: number[] }[]): AniListCastEntry => ({
  fetched_at: '2026-10-14',
  characters: chars.map((c, i) => ({ id: i, name: c.name, role: c.role, voiceActors: c.vas.map(id => ({ id, name: `p${id}` })) })),
});

const resolveBy = (anilist: Record<number, string>, mal: Record<number, string> = {}) =>
  (a: number, m?: number) => anilist[a] ?? (m != null ? mal[m] : undefined);

test('a favourite counts ONCE per title, at their best role — twins are not two hits', () => {
  const index = buildFavSeiyuuIndex(
    [fav(1)],
    { 1: film(1, [{ anilist: 10, chars: [['Twin A', 'SUPPORTING'], ['Twin B', 'MAIN']] }]) },
    {},
    resolveBy({ 10: 'a_1' }),
  );
  const hits = index.byAnime.get('a_1')!;
  assert.equal(hits.length, 1);
  assert.equal(hits[0].role, 'MAIN');
  assert.deepEqual(hits[0].characters, ['Twin A', 'Twin B']);
  assert.equal(favSeiyuuValue(hits), FAV_SEIYUU_ROLE_WEIGHT.MAIN);
});

test('noisy-OR: a second favourite adds, bit parts never overtake a lead, background weighs nothing', () => {
  const lead = favSeiyuuValue([hit(1, 'MAIN')]);
  assert.ok(favSeiyuuValue([hit(1, 'MAIN'), hit(2, 'MAIN')]) > lead);
  assert.ok(favSeiyuuValue([hit(1, 'SUPPORTING'), hit(2, 'SUPPORTING'), hit(3, 'SUPPORTING'), hit(4, 'SUPPORTING')]) < lead);
  assert.equal(favSeiyuuValue([hit(1, 'BACKGROUND')]), 0);
  assert.ok(favSeiyuuValue([hit(1, 'MAIN'), hit(2, 'MAIN'), hit(3, 'MAIN')]) <= 1);
});

test('the cast slice is unioned in, merged by person — not double-counted, and a pending favourite still scores', () => {
  const index = buildFavSeiyuuIndex(
    [fav(1), fav(2)],
    // 1 has a filmography naming a_1 as SUPPORTING; 2 has none yet (pending).
    { 1: film(1, [{ anilist: 10, chars: [['Hero', 'SUPPORTING']] }]) },
    {
      // The cast slice names 1 again on a_1 (now MAIN — announced late) and 2 on a_2.
      a_1: castEntry([{ name: 'Hero', role: 'MAIN', vas: [1] }]),
      a_2: castEntry([{ name: 'Rival', role: 'MAIN', vas: [2, 99] }]),
    },
    resolveBy({ 10: 'a_1' }),
  );
  assert.deepEqual(index.pending, [2]);
  assert.equal(index.byAnime.get('a_1')!.length, 1);
  assert.equal(index.byAnime.get('a_1')![0].role, 'MAIN');
  assert.equal(index.byAnime.get('a_2')!.map(h => h.staffId).join(), '2', 'a non-favourite VA (99) is ignored');
});

test('credits resolve AniList id first, MAL id second, and are skipped when neither resolves', () => {
  const index = buildFavSeiyuuIndex(
    [fav(1)],
    { 1: film(1, [
      { anilist: 10, chars: [['A', 'MAIN']] },
      { anilist: 11, mal: 500, chars: [['B', 'MAIN']] },
      { anilist: 12, mal: 501, chars: [['C', 'MAIN']] },
    ]) },
    {},
    resolveBy({ 10: 'a_1' }, { 500: 'a_2' }),
  );
  assert.deepEqual([...index.byAnime.keys()].sort(), ['a_1', 'a_2']);
});

test('the list filter is MAIN-only', () => {
  assert.equal(hasMainFavSeiyuu([hit(1, 'SUPPORTING')]), false);
  assert.equal(hasMainFavSeiyuu([hit(1, 'SUPPORTING'), hit(2, 'MAIN')]), true);
  assert.equal(hasMainFavSeiyuu(undefined), false);
});
