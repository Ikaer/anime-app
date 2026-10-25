import { useCallback, useEffect, useState } from 'react';
import type { CharacterFavorite } from '@/models/anime';
import type { CharacterFavoriteView } from '@/lib/domain/characterFavorites';

/** What a ★ needs to file a character: everything but the timestamp. */
export type CharacterFavoriteInput = Omit<CharacterFavorite, 'addedAt'>;

/**
 * The favourite characters, client side: the cast section's ★ reads and toggles
 * one, the /characters gallery renders the lot. Per-mount state rather than a
 * module store — `useSeiyuuFavorites`' reason, two consumers that never share
 * a page.
 *
 * `toggle` is optimistic with revert, like the tier board's writes. The
 * optimistic entry is thinner than what the server returns (no resolved title,
 * no voice actors), so `refresh` follows every success: on the cast section
 * nothing reads those fields, and on the gallery the card fills in a moment
 * later rather than appearing empty.
 */
export function useCharacterFavorites() {
  const [favorites, setFavorites] = useState<CharacterFavoriteView[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/character-favorites');
      if (!res.ok) return;
      const data = await res.json();
      setFavorites(data.favorites ?? []);
    } catch {
      // Non-critical: the stars simply stay off.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const isFavorite = useCallback((id: number) => favorites.some(f => f.id === id), [favorites]);

  const toggle = useCallback(async (fav: CharacterFavoriteInput) => {
    const was = favorites.some(f => f.id === fav.id);
    const previous = favorites;
    setFavorites(was
      ? favorites.filter(f => f.id !== fav.id)
      : [...favorites, { ...fav, addedAt: new Date().toISOString(), voiceActors: [] }]);
    try {
      const res = await fetch(`/api/anime/character-favorites/${fav.id}`, {
        method: was ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: was ? undefined : JSON.stringify(fav),
      });
      if (!res.ok) throw new Error(String(res.status));
      void refresh();
    } catch {
      setFavorites(previous);
    }
  }, [favorites, refresh]);

  return { favorites, loaded, isFavorite, toggle };
}
