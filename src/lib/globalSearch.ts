/**
 * Catalog-wide global search — powers the header search box. Matches anime by
 * title (English + original), plus studios and AniList staff by name, so the
 * box can jump straight to a detail page OR to a studio/staff credits page.
 *
 * Pure and client-safe (no `fs`); the catalog is passed in, same convention as
 * creditsCatalog.ts / similarByCredits.ts. The API route feeds it `getAnimeRecords()`.
 */

import type { AnimeRecord } from '@/models/anime';
import { getCatalogPrimaryTitle } from '@/lib/animeUtils';

export interface AnimeSearchHit {
  /** Canonical id (docs/PROVIDER-FREE-CUTOVER.md Phase D) — the detail-page route key. */
  id: string;
  title: string;            // primary (English-first)
  secondary?: string;       // original title, only when it differs from the primary
  poster?: string;
  year?: number;
  mediaType?: string;
  mean: number | null;
}

export interface CreditSearchHit {
  id: number;               // studio id (MAL) or staff id (AniList)
  name: string;
  role?: string;            // staff only — a representative credited role
  count: number;            // how many catalog titles this credit appears on
}

export interface GlobalSearchResults {
  animes: AnimeSearchHit[];
  studios: CreditSearchHit[];
  staff: CreditSearchHit[];
}

export const MIN_QUERY_LENGTH = 2;

const ANIME_LIMIT = 8;
const CREDIT_LIMIT = 6;

const EMPTY: GlobalSearchResults = { animes: [], studios: [], staff: [] };

/**
 * Rank of a substring match: 0 = exact, 1 = prefix, 2 = word-boundary, 3 = any
 * substring, Infinity = no match. Lower is better.
 */
function matchRank(haystack: string, needle: string): number {
  const h = haystack.toLowerCase();
  if (h === needle) return 0;
  if (h.startsWith(needle)) return 1;
  const idx = h.indexOf(needle);
  if (idx < 0) return Infinity;
  // Word-boundary: the char before the match is a separator.
  return /[\s:.,\-–—/]/.test(h[idx - 1] || '') ? 2 : 3;
}

/** Best (lowest) match rank across a title's candidate strings. */
function bestTitleRank(a: AnimeRecord, needle: string): number {
  const alt = a.catalog.alternativeTitles;
  const candidates = [a.catalog.title, alt?.en, ...(alt?.synonyms || [])];
  let best = Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const r = matchRank(c, needle);
    if (r < best) best = r;
    if (best === 0) break;
  }
  return best;
}

/**
 * Search the catalog for anime / studios / staff matching `query`. Returns
 * empty for queries shorter than {@link MIN_QUERY_LENGTH}.
 */
export function searchCatalog(query: string, catalog: AnimeRecord[]): GlobalSearchResults {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) return EMPTY;

  // --- Anime ---------------------------------------------------------------
  const animeScored: Array<{ hit: AnimeSearchHit; rank: number; mean: number }> = [];
  // --- Credits (deduped across the catalog) --------------------------------
  const studioMap = new Map<number, CreditSearchHit & { rank: number }>();
  const staffMap = new Map<number, CreditSearchHit & { rank: number }>();

  for (const a of catalog) {
    const titleRank = bestTitleRank(a, needle);
    if (titleRank !== Infinity) {
      const primary = getCatalogPrimaryTitle(a.catalog);
      const original = a.catalog.title;
      animeScored.push({
        hit: {
          id: a.id,
          title: primary,
          secondary: original && original !== primary ? original : undefined,
          poster: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
          year: a.catalog.startSeason?.year,
          mediaType: a.catalog.mediaType,
          mean: a.catalog.mean ?? null,
        },
        rank: titleRank,
        mean: a.catalog.mean ?? -1,
      });
    }

    for (const studio of a.catalog.studios || []) {
      const rank = matchRank(studio.name, needle);
      if (rank === Infinity) continue;
      const existing = studioMap.get(studio.id);
      if (existing) {
        existing.count++;
        if (rank < existing.rank) existing.rank = rank;
      } else {
        studioMap.set(studio.id, { id: studio.id, name: studio.name, count: 1, rank });
      }
    }

    for (const credit of a.sources.anilist?.staff || []) {
      const rank = matchRank(credit.name, needle);
      if (rank === Infinity) continue;
      const existing = staffMap.get(credit.id);
      if (existing) {
        existing.count++;
        if (rank < existing.rank) existing.rank = rank;
      } else {
        staffMap.set(credit.id, { id: credit.id, name: credit.name, role: credit.role, count: 1, rank });
      }
    }
  }

  animeScored.sort((x, y) => x.rank - y.rank || y.mean - x.mean || x.hit.title.localeCompare(y.hit.title));

  const sortCredits = (m: Map<number, CreditSearchHit & { rank: number }>): CreditSearchHit[] =>
    Array.from(m.values())
      .sort((x, y) => x.rank - y.rank || y.count - x.count || x.name.localeCompare(y.name))
      .slice(0, CREDIT_LIMIT)
      .map(({ rank, ...hit }) => hit);

  return {
    animes: animeScored.slice(0, ANIME_LIMIT).map(s => s.hit),
    studios: sortCredits(studioMap),
    staff: sortCredits(staffMap),
  };
}
