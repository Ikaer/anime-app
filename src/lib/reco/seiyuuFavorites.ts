/**
 * Favourite seiyuu — `user/seiyuu_favorites.json`, and the memoized index the
 * rankers read. Server-only (uses `fs` via `jsonStore`); the arithmetic is the
 * client-safe `favSeiyuu.ts`.
 *
 * ⚠️ Durable user data, like `boxes.json`: no provider can re-supply which
 * voice actors the owner chose. Keyed by AniList staff id, the one id space a
 * person has here (same as `catalog/anilist_seiyuu.json`).
 *
 * Lives in `reco/` for `seedMutes.ts`' reason: an engine annotation off the
 * seven-slice join, so a write here changes no assembled row and does not
 * invalidate the row cache. The index is memoized on the identity of its four
 * inputs instead — each `readJsonFile` result is the same object until its file
 * changes on disk, so this self-invalidates exactly like the row cache.
 */

import type { AnimeRecord } from '@/models/anime';
import { getAnimeForDisplay, getAllAnilistCast, getAllAnilistSeiyuu, buildCrosswalkIndexes } from '@/lib/store';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { buildFavSeiyuuIndex, EMPTY_FAV_SEIYUU_INDEX, type FavSeiyuuIndex, type SeiyuuFavorite } from '@/lib/reco/favSeiyuu';

const SEIYUU_FAVORITES_FILE = dataFile('user/seiyuu_favorites.json');

export function getSeiyuuFavorites(): SeiyuuFavorite[] {
  return readJsonFile<SeiyuuFavorite[]>(SEIYUU_FAVORITES_FILE, []);
}

/** Returns false when the id was already a favourite. */
export function addSeiyuuFavorite(id: number, name: string): boolean {
  const favs = getSeiyuuFavorites();
  if (favs.some(f => f.id === id)) return false;
  writeJsonFile(SEIYUU_FAVORITES_FILE, [...favs, { id, name, addedAt: new Date().toISOString() }]);
  return true;
}

export function removeSeiyuuFavorite(id: number): void {
  const favs = getSeiyuuFavorites();
  const next = favs.filter(f => f.id !== id);
  if (next.length !== favs.length) writeJsonFile(SEIYUU_FAVORITES_FILE, next);
}

let cache: {
  favorites: SeiyuuFavorite[];
  filmographies: object;
  cast: object;
  rows: AnimeRecord[];
  index: FavSeiyuuIndex;
} | null = null;

/**
 * The favourites inverted onto canonical ids. The row array is part of the key
 * because the registry moves with it (a crawl that adds an AniList id lets a
 * previously unresolvable credit resolve). Cheap with no favourites: the
 * cast/filmography slices are not even read.
 */
export function getFavSeiyuuIndex(): FavSeiyuuIndex {
  const favorites = getSeiyuuFavorites();
  if (favorites.length === 0) return EMPTY_FAV_SEIYUU_INDEX;
  const filmographies = getAllAnilistSeiyuu();
  const cast = getAllAnilistCast();
  const rows = getAnimeForDisplay();
  if (cache && cache.favorites === favorites && cache.filmographies === filmographies && cache.cast === cast && cache.rows === rows) {
    return cache.index;
  }
  const { byAnilist, byMal } = buildCrosswalkIndexes();
  const index = buildFavSeiyuuIndex(favorites, filmographies, cast, (anilistId, malId) =>
    byAnilist.get(anilistId) ?? (malId != null ? byMal.get(malId) : undefined));
  cache = { favorites, filmographies, cast, rows, index };
  return index;
}
