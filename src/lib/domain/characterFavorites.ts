/**
 * Favourite characters — the pure half: turning the stored registry into what
 * the gallery renders. Client-safe (no `fs`); the store itself is
 * `lib/user/characterFavorites.ts`.
 *
 * Same split as `reco/favSeiyuu.ts` / `reco/seiyuuFavorites.ts`, for the same
 * reason: the arithmetic is testable without a store on disk, and the module
 * that opens files is not.
 */

import type { AniListCastEntry, CharacterFavorite } from '@/models/anime';

/** One favourite as the gallery reads it. */
export interface CharacterFavoriteView extends CharacterFavorite {
  /** The origin title, under the owner's `titleLanguage`. Absent when the
   *  canonical id no longer resolves — the card then shows the character alone
   *  rather than linking nowhere. */
  animeTitle?: string;
  /** The character's Japanese voice actor(s) on that title, so the gallery can
   *  hand the reader straight to `/credits/seiyuu/[id]`. The genuinely
   *  predictive favourite is the PERSON; this is the path to finding them. */
  voiceActors: { id: number; name: string; image?: string }[];
}

/**
 * Join the registry against the cast slice for display.
 *
 * ⚠️ **Two rules, and each one fails silently if it is dropped.**
 *
 * 1. **The cast entry WINS over the stored copy** wherever it still holds the
 *    character: a refill may have improved the portrait (the 25 → 100 character
 *    cap change replaced thousands of entries), and AniList occasionally
 *    renames. Keep the stored copy first and the registry slowly becomes a
 *    museum of whatever AniList said the day each ★ was clicked.
 * 2. **The stored copy is the fallback, never dead weight.** A title can leave
 *    the cast slice — `refill-anilist-cast.js` drops entries outright, and a
 *    transient AniList failure is deliberately never persisted — and a favourite
 *    must survive that. "Simplifying" this to read the slice alone blanks the
 *    card instead of failing, which is exactly the kind of nothing-looks-wrong
 *    breakage the suite exists for.
 *
 * `titleOf` is a parameter rather than a store read so this stays a pure
 * function of what it is handed; the caller resolves the canonical id under the
 * owner's `titleLanguage`, at the outermost boundary.
 */
export function joinCharacterFavorites(
  favorites: readonly CharacterFavorite[],
  cast: Record<string, AniListCastEntry>,
  titleOf: (animeId: string) => string | undefined,
): CharacterFavoriteView[] {
  // One cast entry serves every favourite starred from the same title.
  const entries = new Map<string, AniListCastEntry | undefined>();

  return favorites.map(fav => {
    if (!entries.has(fav.animeId)) entries.set(fav.animeId, cast[fav.animeId]);
    const live = entries.get(fav.animeId)?.characters.find(c => c.id === fav.id);
    return {
      ...fav,
      name: live?.name || fav.name,
      nameNative: live?.nameNative ?? fav.nameNative,
      image: live?.image ?? fav.image,
      role: live?.role ?? fav.role,
      animeTitle: titleOf(fav.animeId),
      voiceActors: (live?.voiceActors ?? []).map(va => ({ id: va.id, name: va.name, image: va.image })),
    };
  });
}
