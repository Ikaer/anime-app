/**
 * Catalog-wide lookups for "every anime a given studio or AniList staff member
 * worked on" — powers the clickable studio/staff credits on the detail page.
 * Pure and client-safe (no `fs`); the catalog is passed in, same convention as
 * similarByCredits.ts.
 */

import type { AnimeForDisplay } from '@/models/anime';
import { getPrimaryTitle } from '@/lib/animeUtils';

export interface CreditedAnime {
  id: number;
  title: string;
  poster?: string;
  mean: number | null;
  mediaType?: string;
  year?: number;
  /** Only set for staff listings — the role credited on THIS anime. */
  role?: string;
}

export interface CreditsResult {
  name: string;
  items: CreditedAnime[];
}

function toCredited(a: AnimeForDisplay, role?: string): CreditedAnime {
  return {
    id: a.id,
    title: getPrimaryTitle(a),
    poster: a.main_picture?.medium || a.main_picture?.large,
    mean: a.mean ?? null,
    mediaType: a.media_type,
    year: a.start_season?.year,
    role,
  };
}

/** Deterministic ordering: MAL mean desc (unscored last), then id asc. */
function sortCredited(items: CreditedAnime[]): CreditedAnime[] {
  return items.sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1) || a.id - b.id);
}

export function listAnimeByStudio(studioId: number, catalog: AnimeForDisplay[]): CreditsResult | null {
  let name: string | null = null;
  const items: CreditedAnime[] = [];
  for (const a of catalog) {
    const studio = (a.studios || []).find(s => s.id === studioId);
    if (!studio) continue;
    if (!name) name = studio.name;
    items.push(toCredited(a));
  }
  if (!name) return null;
  return { name, items: sortCredited(items) };
}

export function listAnimeByStaff(staffId: number, catalog: AnimeForDisplay[]): CreditsResult | null {
  let name: string | null = null;
  const items: CreditedAnime[] = [];
  for (const a of catalog) {
    const credit = (a.anilistMeta?.staff || []).find(s => s.id === staffId);
    if (!credit) continue;
    if (!name) name = credit.name;
    items.push(toCredited(a, credit.role));
  }
  if (!name) return null;
  return { name, items: sortCredited(items) };
}
