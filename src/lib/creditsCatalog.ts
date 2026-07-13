/**
 * Catalog-wide lookups for "every anime a given studio or AniList staff member
 * worked on" — powers the clickable studio/staff credits on the detail page.
 * Pure and client-safe (no `fs`); the catalog is passed in, same convention as
 * similarByCredits.ts.
 */

import type { AnimeRecord } from '@/models/anime';
import { getCatalogPrimaryTitle } from '@/lib/animeUtils';

export interface CreditedAnime {
  /** Canonical id (docs/PROVIDER-FREE-CUTOVER.md Phase D) — the detail-page route key. */
  id: string;
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

// Studio/staff credits and MAL score are catalog-only fields, so this reads
// exclusively from `AnimeRecord.catalog`/`sources.anilist` — no personal
// state involved. `id` is the outward canonical id (docs/PROVIDER-FREE-
// CUTOVER.md Phase D) — the detail-page route key.
function toCredited(a: AnimeRecord, role?: string): CreditedAnime {
  return {
    id: a.id,
    title: getCatalogPrimaryTitle(a.catalog),
    poster: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
    mean: a.catalog.mean ?? null,
    mediaType: a.catalog.mediaType,
    year: a.catalog.startSeason?.year,
    role,
  };
}

/** Deterministic ordering: MAL mean desc (unscored last), then id asc. */
function sortCredited(items: CreditedAnime[]): CreditedAnime[] {
  return items.sort((a, b) => (b.mean ?? -1) - (a.mean ?? -1) || a.id.localeCompare(b.id));
}

export function listAnimeByStudio(studioId: number, catalog: AnimeRecord[]): CreditsResult | null {
  let name: string | null = null;
  const items: CreditedAnime[] = [];
  for (const a of catalog) {
    const studio = (a.catalog.studios || []).find(s => s.id === studioId);
    if (!studio) continue;
    if (!name) name = studio.name;
    items.push(toCredited(a));
  }
  if (!name) return null;
  return { name, items: sortCredited(items) };
}

export function listAnimeByStaff(staffId: number, catalog: AnimeRecord[]): CreditsResult | null {
  let name: string | null = null;
  const items: CreditedAnime[] = [];
  for (const a of catalog) {
    const credit = (a.sources.anilist?.staff || []).find(s => s.id === staffId);
    if (!credit) continue;
    if (!name) name = credit.name;
    items.push(toCredited(a, credit.role));
  }
  if (!name) return null;
  return { name, items: sortCredited(items) };
}
