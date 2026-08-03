/**
 * Catalog-wide lookups for "every anime a given studio or AniList staff member
 * worked on" — powers the clickable studio/staff credits on the detail page.
 * Pure and client-safe (no `fs`); the catalog is passed in, same convention as
 * similarByCredits.ts.
 */

import type { AnimeRecord } from '@/models/anime';
import { getCatalogPrimaryTitle, getEffectiveScore, getEffectiveStatus } from '@/lib/domain/animeUtils';

export interface CreditedAnime {
  /** Canonical id — the detail-page route key. */
  id: string;
  title: string;
  poster?: string;
  mean: number | null;
  mediaType?: string;
  year?: number;
  /** Only set for staff listings — the role credited on THIS anime. */
  role?: string;
  /** Effective (SIMKL > MAL > AniList > local) personal status; absent = not in any list. */
  status?: string;
  /** Effective personal score, when rated. */
  score?: number;
}

/**
 * A matched record, carrying the role it was matched on for staff listings.
 * Kept as an `AnimeRecord` rather than projected up front so the page can run
 * `applyNarrowingFilters`/`sortAnimeRecords` over the real record — the extra
 * field survives both (they are generic over `T extends AnimeRecord`, same as
 * the reco feed's `recoMeta`).
 */
export type CreditedRecord = AnimeRecord & { creditRole?: string };

export interface CreditsResult {
  name: string;
  records: CreditedRecord[];
}

// Studio/staff credits and MAL score are catalog-only fields, so the catalog
// half of this reads exclusively from `AnimeRecord.catalog`. The personal half
// goes through the effective-state helpers (never `sources.malPersonal`), so a
// SIMKL-, AniList- or local-only entry shows up. `id` is the outward canonical
// id — the detail-page route key.
export function toCredited(a: CreditedRecord): CreditedAnime {
  return {
    id: a.id,
    title: getCatalogPrimaryTitle(a.catalog),
    poster: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
    mean: a.catalog.mean ?? null,
    mediaType: a.catalog.mediaType,
    year: a.catalog.startSeason?.year,
    role: a.creditRole,
    status: getEffectiveStatus(a) ?? undefined,
    score: getEffectiveScore(a) ?? undefined,
  };
}

export function listAnimeByStudio(studioId: number, catalog: AnimeRecord[]): CreditsResult | null {
  let name: string | null = null;
  const records: CreditedRecord[] = [];
  for (const a of catalog) {
    const studio = (a.catalog.studios || []).find(s => s.id === studioId);
    if (!studio) continue;
    if (!name) name = studio.name;
    records.push(a);
  }
  if (!name) return null;
  return { name, records };
}

export function listAnimeByStaff(staffId: number, catalog: AnimeRecord[]): CreditsResult | null {
  let name: string | null = null;
  const records: CreditedRecord[] = [];
  for (const a of catalog) {
    const credit = (a.sources.anilist?.staff || []).find(s => s.id === staffId);
    if (!credit) continue;
    if (!name) name = credit.name;
    records.push({ ...a, creditRole: credit.role });
  }
  if (!name) return null;
  return { name, records };
}
