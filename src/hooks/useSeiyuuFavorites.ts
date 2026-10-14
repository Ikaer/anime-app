import { useCallback, useEffect, useState } from 'react';
import type { SeiyuuFavorite } from '@/lib/reco/favSeiyuu';

/**
 * The favourite seiyuu, client side: the /stats marker reads it, the
 * /credits/seiyuu/[id] button reads and toggles it. Per-mount state rather than
 * a module store — two consumers that never share a page.
 *
 * `toggle` is optimistic with revert, like the tier board's writes: the click
 * has to read as done immediately, and the POST also starts a filmography fetch
 * the response does not wait for.
 */
export function useSeiyuuFavorites() {
  const [favorites, setFavorites] = useState<SeiyuuFavorite[]>([]);
  const [pending, setPending] = useState<number[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/anime/seiyuu-favorites');
      if (!res.ok) return;
      const data = await res.json();
      setFavorites(data.favorites ?? []);
      setPending(data.pending ?? []);
    } catch {
      // Non-critical: the markers simply stay off.
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const isFavorite = useCallback((id: number) => favorites.some(f => f.id === id), [favorites]);

  const toggle = useCallback(async (id: number, name: string) => {
    const was = favorites.some(f => f.id === id);
    const previous = favorites;
    setFavorites(was ? favorites.filter(f => f.id !== id) : [...favorites, { id, name, addedAt: new Date().toISOString() }]);
    try {
      const res = await fetch(`/api/anime/seiyuu-favorites/${id}`, {
        method: was ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: was ? undefined : JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      void refresh();
    } catch {
      setFavorites(previous);
    }
  }, [favorites, refresh]);

  return { favorites, pending, loaded, isFavorite, toggle };
}
