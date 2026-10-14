/**
 * Favourite seiyuu — the pure half: which titles a favourite voices, and how
 * much that weighs. Client-safe (no `fs`); the store and the memoized index live
 * in `seiyuuFavorites.ts`.
 *
 * **The index is built from the FILMOGRAPHY slice, unioned with the cast slice
 * — never from the cast slice alone.** `catalog/anilist_cast.json` is keyed by
 * title and filled per title (detail-page views + the /stats sweep over the
 * statused list): 743 entries on the live store, essentially the owner's own
 * list. A knob reading it would score 0 on every unseen candidate — the signal
 * structurally absent exactly where a recommendation needs it, the same trap
 * the seiyuu page fell into. `catalog/anilist_seiyuu.json` is keyed by PERSON
 * and covers the whole catalog, which is why favouriting someone fetches their
 * filmography. The cast slice is still unioned in: it is free, and a title
 * opened on its detail page since the filmography was fetched may be newer.
 *
 * **Each favourite counts ONCE per title, at their best role.** A seiyuu voicing
 * twins, a recast or a child + adult self is one person on that title, not two
 * hits — otherwise prolific double-casting would outrank a lead role.
 *
 * **Combined as a noisy-OR across people**: `1 − Π(1 − w(role))`. Bounded in
 * [0,1] like every source, a second favourite always adds something, and a
 * stack of minor roles never overtakes a lead (four SUPPORTING ≈ 0.68 < one
 * MAIN + one SUPPORTING ≈ 0.78).
 *
 * ⚠️ **No harness can tune this, and that is not a defect.** The owner picks
 * favourites BECAUSE of shows they loved, so `scripts/backtest-reco.js` would
 * "discover" the held-out favourites through the very choice that made them
 * favourites — pure hindsight, `num_list_users`' trap. It is the owner speaking
 * directly, the seed mutes' category: ships at weight 0 on the feed, and the
 * role weights below are a stated preference, not a measurement.
 */

import type { AniListCastEntry, AniListSeiyuuEntry } from '@/models/anime';

export type SeiyuuRole = 'MAIN' | 'SUPPORTING' | 'BACKGROUND';

/**
 * How much one favourite on a title weighs, by their best role there.
 * BACKGROUND is 0: a crowd voice is not a reason to watch anything. MAIN is
 * below 1 so two leads still rank above one (noisy-OR saturates at 1).
 */
export const FAV_SEIYUU_ROLE_WEIGHT: Record<SeiyuuRole, number> = {
  MAIN: 0.7,
  SUPPORTING: 0.25,
  BACKGROUND: 0,
};

const ROLE_RANK: Record<SeiyuuRole, number> = { MAIN: 2, SUPPORTING: 1, BACKGROUND: 0 };

/** AniList stores the role verbatim; anything unknown reads as BACKGROUND (weight 0). */
export function normalizeRole(raw: string | undefined): SeiyuuRole {
  return raw === 'MAIN' || raw === 'SUPPORTING' ? raw : 'BACKGROUND';
}

export interface SeiyuuFavorite {
  /** AniList staff id — the id space of `AniListVoiceActorEntry.id`. */
  id: number;
  /** Kept on the favourite itself so the list renders before (or without) a filmography. */
  name: string;
  addedAt: string;
}

/** One favourite on one title. */
export interface FavSeiyuuHit {
  staffId: number;
  name: string;
  /** Best role across every character they voice on this title. */
  role: SeiyuuRole;
  characters: string[];
}

export interface FavSeiyuuIndex {
  /** canonical id -> the favourites credited on it, best role first. */
  byAnime: Map<string, FavSeiyuuHit[]>;
  /** Favourites with no filmography stored yet — they score only through the cast slice. */
  pending: number[];
}

export const EMPTY_FAV_SEIYUU_INDEX: FavSeiyuuIndex = { byAnime: new Map(), pending: [] };

/**
 * Invert the two slices over the favourite set. `resolve` maps an AniList media
 * id (then its MAL id) to a canonical id — resolve-only, never mint, the
 * filmography's own ingest rule; an unresolvable credit is simply not indexed.
 */
export function buildFavSeiyuuIndex(
  favorites: SeiyuuFavorite[],
  filmographies: Record<string, AniListSeiyuuEntry>,
  cast: Record<string, AniListCastEntry>,
  resolve: (anilistId: number, malId?: number) => string | undefined,
): FavSeiyuuIndex {
  if (favorites.length === 0) return EMPTY_FAV_SEIYUU_INDEX;
  const names = new Map(favorites.map(f => [f.id, f.name]));
  // canonical id -> staff id -> hit, so a person is merged across both slices.
  const acc = new Map<string, Map<number, FavSeiyuuHit>>();

  const add = (animeId: string, staffId: number, role: SeiyuuRole, character: string) => {
    let perStaff = acc.get(animeId);
    if (!perStaff) { perStaff = new Map(); acc.set(animeId, perStaff); }
    const hit = perStaff.get(staffId);
    if (!hit) {
      perStaff.set(staffId, { staffId, name: names.get(staffId) ?? '', role, characters: character ? [character] : [] });
      return;
    }
    if (ROLE_RANK[role] > ROLE_RANK[hit.role]) hit.role = role;
    if (character && !hit.characters.includes(character)) hit.characters.push(character);
  };

  const pending: number[] = [];
  for (const fav of favorites) {
    const entry = filmographies[String(fav.id)];
    if (!entry) { pending.push(fav.id); continue; }
    for (const credit of entry.credits) {
      const animeId = resolve(credit.anilist_id, credit.mal_id);
      if (!animeId) continue;
      for (const ch of credit.characters) add(animeId, fav.id, normalizeRole(ch.role), ch.name);
    }
  }

  for (const [animeId, entry] of Object.entries(cast)) {
    for (const ch of entry.characters) {
      for (const va of ch.voiceActors) {
        if (names.has(va.id)) add(animeId, va.id, normalizeRole(ch.role), ch.name);
      }
    }
  }

  const byAnime = new Map<string, FavSeiyuuHit[]>();
  for (const [animeId, perStaff] of acc) {
    byAnime.set(animeId, [...perStaff.values()].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name)));
  }
  return { byAnime, pending };
}

/** The `favSeiyuu` source value: noisy-OR over people, each at their best role. */
export function favSeiyuuValue(hits: readonly FavSeiyuuHit[] | undefined): number {
  if (!hits || hits.length === 0) return 0;
  let miss = 1;
  for (const hit of hits) miss *= 1 - FAV_SEIYUU_ROLE_WEIGHT[hit.role];
  return 1 - miss;
}

/** The list filter's predicate: a favourite holds a MAIN role on this title. */
export function hasMainFavSeiyuu(hits: readonly FavSeiyuuHit[] | undefined): boolean {
  return !!hits?.some(h => h.role === 'MAIN');
}

/** « Pourquoi ? » text: the hits that weigh anything, as `Name (Character)`. */
export function describeFavSeiyuu(hits: readonly FavSeiyuuHit[] | undefined): string | undefined {
  const parts = (hits ?? [])
    .filter(h => FAV_SEIYUU_ROLE_WEIGHT[h.role] > 0)
    .map(h => (h.characters.length ? `${h.name} (${h.characters.slice(0, 2).join(', ')})` : h.name));
  return parts.length ? parts.join(', ') : undefined;
}
