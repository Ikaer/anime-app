/**
 * Favourite characters — `user/character_favorites.json`, the owner's own
 * registry of characters they care about.
 *
 * ⚠️ Durable user data, like `boxes.json` and `seiyuu_favorites.json`: no
 * provider can re-supply which characters the owner chose. It belongs in the
 * posture doc's "costs that are real" list.
 *
 * **It lives in `lib/user/` rather than in `lib/reco/` beside
 * `seiyuuFavorites.ts`, and that is a statement, not filing.** Everything in
 * `reco/` is an engine annotation: a seed mute removes a term from the sum, a
 * favourite seiyuu adds one. This one feeds NO ranker, no filter and no cron
 * step — see the measurement on `CharacterFavorite` in `@/models/anime` for
 * why a character cannot carry the signal a seiyuu does. Putting it in `reco/`
 * would advertise a knob that does not exist.
 *
 * Server-only (`fs` via `jsonStore`), hence the entry in the client-safety
 * eslint block. It is off the seven-slice join, so a write here changes no
 * assembled row and does not invalidate the row cache — `seedMutes.ts`' reason.
 */

import type { CharacterFavorite } from '@/models/anime';
import { getAnimeByCanonicalId, getAllAnilistCast } from '@/lib/store';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import type { TitleLanguage } from '@/lib/url/viewDefaults';
import { getPrimaryTitle } from '@/lib/domain/animeUtils';
import { joinCharacterFavorites, type CharacterFavoriteView } from '@/lib/domain/characterFavorites';

const CHARACTER_FAVORITES_FILE = dataFile('user/character_favorites.json');

export function getCharacterFavorites(): CharacterFavorite[] {
  return readJsonFile<CharacterFavorite[]>(CHARACTER_FAVORITES_FILE, []);
}

/**
 * Returns false when the id was already a favourite. The caller supplies the
 * denormalized identity because the one surface that stars a character (the
 * detail page's cast section) is already holding it — re-reading the cast slice
 * here to find a row the client just rendered would be a 8 MB parse for nothing.
 */
export function addCharacterFavorite(fav: Omit<CharacterFavorite, 'addedAt'>): boolean {
  const favs = getCharacterFavorites();
  if (favs.some(f => f.id === fav.id)) return false;
  writeJsonFile(CHARACTER_FAVORITES_FILE, [...favs, { ...fav, addedAt: new Date().toISOString() }]);
  return true;
}

export function removeCharacterFavorite(id: number): void {
  const favs = getCharacterFavorites();
  const next = favs.filter(f => f.id !== id);
  if (next.length !== favs.length) writeJsonFile(CHARACTER_FAVORITES_FILE, next);
}

/**
 * The registry joined for display. The join itself — which of the stored copy
 * and the cast slice wins, and why both are needed — is the pure
 * `joinCharacterFavorites`, pinned in tests/domain/characterFavorites.test.ts.
 */
export function listCharacterFavorites(titleLang: TitleLanguage): CharacterFavoriteView[] {
  const favs = getCharacterFavorites();
  if (favs.length === 0) return [];
  return joinCharacterFavorites(favs, getAllAnilistCast(), animeId => {
    const record = getAnimeByCanonicalId(animeId);
    return record ? getPrimaryTitle(record, titleLang) : undefined;
  });
}
