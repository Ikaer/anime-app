/**
 * The favourite-character registry's join — two contracts, both silent.
 *
 * Nothing here crashes when it breaks. Drop the cast-slice preference and the
 * registry quietly freezes into whatever AniList said the day each ★ was
 * clicked, which a 25 → 100 character refill makes stale in bulk; drop the
 * stored fallback and a title that left the cast slice renders a blank card
 * instead of an error. Both were verified by breaking the thing they guard.
 *
 * `joinCharacterFavorites` takes its data as arguments, so this needs no store
 * on disk — the reason the join lives in `domain/` and the file I/O does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinCharacterFavorites } from '@/lib/domain/characterFavorites';
import type { AniListCastEntry, CharacterFavorite } from '@/models/anime';

const fav = (over: Partial<CharacterFavorite> = {}): CharacterFavorite => ({
  id: 714,
  name: 'Milly Thompson',
  nameNative: 'ミリィ・トンプソン',
  image: 'https://s4.anilist.co/old.jpg',
  role: 'SUPPORTING',
  animeId: 'a_3',
  addedAt: '2026-10-25T00:00:00.000Z',
  ...over,
});

/** Only the fields the join reads. */
const castEntry = (characters: AniListCastEntry['characters']): AniListCastEntry =>
  ({ characters, fetched_at: '2026-10-25T00:00:00.000Z' });

const liveMilly = castEntry([{
  id: 714,
  name: 'Millie Thompson',
  nameNative: 'ミリィ・トンプソン',
  image: 'https://s4.anilist.co/fresh.jpg',
  role: 'MAIN',
  voiceActors: [{ id: 95011, name: 'Satsuki Yukino' }],
}]);

const titleOf = (id: string) => (id === 'a_3' ? 'Trigun' : undefined);

test('the cast slice wins over the stored copy — a refill must reach the registry', () => {
  const [row] = joinCharacterFavorites([fav()], { a_3: liveMilly }, titleOf);
  assert.equal(row.name, 'Millie Thompson');
  assert.equal(row.image, 'https://s4.anilist.co/fresh.jpg');
  // The role is per title and the slice is the authority on it too: a character
  // promoted between a recap and its series must not stay stamped SUPPORTING.
  assert.equal(row.role, 'MAIN');
});

test('the stored copy survives a title that left the cast slice', () => {
  // `refill-anilist-cast.js` drops entries outright, and a transient AniList
  // failure is deliberately never persisted — so an absent entry is normal.
  const [row] = joinCharacterFavorites([fav()], {}, titleOf);
  assert.equal(row.name, 'Milly Thompson');
  assert.equal(row.image, 'https://s4.anilist.co/old.jpg');
  assert.equal(row.role, 'SUPPORTING');
  assert.equal(row.nameNative, 'ミリィ・トンプソン');
  // No cast entry means no voice actors, and an empty array rather than
  // undefined: the gallery maps over it unguarded.
  assert.deepEqual(row.voiceActors, []);
});

test('an unresolvable title leaves animeTitle undefined rather than inventing one', () => {
  // The card then shows the character alone; a placeholder string would link
  // the reader to a page that is not there.
  const [row] = joinCharacterFavorites([fav({ animeId: 'a_gone' })], {}, titleOf);
  assert.equal(row.animeTitle, undefined);
  assert.equal(row.animeId, 'a_gone');
});

test('several favourites from one title each keep their OWN identity', () => {
  // One cast entry serves them all, so a lookup that forgot to key on the
  // favourite's own id would hand every row the first character's name, face
  // and voice actor — a page of plausible, wrong cards.
  const cast = { a_3: castEntry([...liveMilly.characters, {
    id: 713, name: 'Meryl Stryfe', role: 'MAIN', voiceActors: [{ id: 95008, name: 'Hiromi Tsuru' }],
  }]) };

  const rows = joinCharacterFavorites(
    [fav(), fav({ id: 713, name: 'Meryl Stryfe', image: undefined })], cast, titleOf);

  assert.deepEqual(rows.map(r => r.name), ['Millie Thompson', 'Meryl Stryfe']);
  assert.deepEqual(rows.map(r => r.voiceActors[0].name), ['Satsuki Yukino', 'Hiromi Tsuru']);
  assert.deepEqual(rows.map(r => r.animeTitle), ['Trigun', 'Trigun']);
});
