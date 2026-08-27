/**
 * Catalog-wide lookups for "every anime a given studio, AniList staff member or
 * seiyuu worked on" — powers the clickable studio/staff/seiyuu credits on the
 * detail page and /stats. Pure and client-safe (no `fs`); the catalog is passed
 * in, same convention as similarByCredits.ts.
 *
 * **Seiyuu are the odd one out, and unavoidably so.** Studio and staff credits
 * ride on the record itself (`catalog.studios` / `sources.anilist.staff`), so
 * their lookups are a scan of what `getAnimeForDisplay()` already returned.
 * Voice actors live in `catalog/anilist_cast.json` — the one AniList slice
 * deliberately kept OFF the row join (see `AniListCastEntry`) — so
 * `listAnimeBySeiyuu` takes that map as a second input rather than reading it,
 * which keeps this module pure. Two consequences the caller must own:
 *
 * - **Coverage is partial by construction.** The cast slice is filled lazily
 *   (one title on first view) plus by the /stats sweep over the statused list,
 *   never over the ~25k catalog — so a seiyuu filmography covers only titles
 *   already fetched. `castCovered` reports the denominator so the page can say
 *   so instead of silently under-reporting.
 * - **The credit is a character, not a role string.** A seiyuu can voice several
 *   characters in one title (a recast, a twin, a child self), so the match
 *   carries a `characters` list where staff carries a single `role`.
 */

import type { AniListCastEntry, AniListSeiyuuCredit, AniListSeiyuuEntry, AnimeRecord } from '@/models/anime';
import { getCatalogPrimaryTitle, getEffectiveScore, getEffectiveStatus } from '@/lib/domain/animeUtils';
import type { TitleLanguage } from '@/lib/url/viewDefaults';

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
  /** Only set for seiyuu listings — the character(s) voiced in THIS anime. */
  characters?: CreditedCharacter[];
  /** Effective (SIMKL > MAL > AniList > local) personal status; absent = not in any list. */
  status?: string;
  /** Effective personal score, when rated. */
  score?: number;
}

/** One character a seiyuu voiced on a matched title. `role` is AniList's
 *  `MAIN` | `SUPPORTING` | `BACKGROUND`, stored verbatim as everywhere else. */
export interface CreditedCharacter {
  id: number;
  name: string;
  role: string;
  /** AniList-hosted portrait, hot-linked like the cast section's. Present far
   *  more often than it is useful — AniList serves a grey placeholder rather
   *  than omitting the field (see `AniListCharacterEntry.image`). */
  image?: string;
}

/**
 * A matched record, carrying the role it was matched on for staff listings.
 * Kept as an `AnimeRecord` rather than projected up front so the page can run
 * `applyNarrowingFilters`/`sortAnimeRecords` over the real record — the extra
 * field survives both (they are generic over `T extends AnimeRecord`, same as
 * the reco feed's `recoMeta`).
 */
export type CreditedRecord = AnimeRecord & {
  creditRole?: string;
  creditCharacters?: CreditedCharacter[];
};

export interface CreditsResult {
  name: string;
  /** Japanese-script name, when the source has one — seiyuu only today. */
  nameNative?: string;
  /** AniList-hosted portrait, when the source has one — seiyuu only today. */
  image?: string;
  records: CreditedRecord[];
  /**
   * Seiyuu only: how many catalog titles had a cast entry at all, i.e. the pool
   * this filmography was actually drawn from. `undefined` for studio/staff,
   * whose credits cover the whole catalog.
   */
  castCovered?: number;
  /**
   * Seiyuu, AniList-sourced path only: credits AniList reports that the local
   * catalog does not know, so they cannot be rendered or filtered. Stated rather
   * than silently dropped — same posture as `castCovered`.
   */
  unresolved?: number;
  /** Seiyuu, AniList-sourced path only: false when the filmography was truncated
   *  at the page cap, so these are the most recent credits rather than all. */
  complete?: boolean;
}

// Studio/staff credits and MAL score are catalog-only fields, so the catalog
// half of this reads exclusively from `AnimeRecord.catalog`. The personal half
// goes through the effective-state helpers (never `sources.malPersonal`), so a
// SIMKL-, AniList- or local-only entry shows up. `id` is the outward canonical
// id — the detail-page route key.
export function toCredited(a: CreditedRecord, titleLang: TitleLanguage): CreditedAnime {
  return {
    id: a.id,
    title: getCatalogPrimaryTitle(a.catalog, titleLang),
    poster: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
    mean: a.catalog.mean ?? null,
    mediaType: a.catalog.mediaType,
    year: a.catalog.startSeason?.year,
    role: a.creditRole,
    characters: a.creditCharacters,
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

/**
 * Every anime in which a given AniList staff id is credited as a **Japanese
 * voice actor**. Same id space as `listAnimeByStaff` (AniList staff ids), but a
 * disjoint credit set: `sources.anilist.staff` holds production credits, which
 * by construction never contain seiyuu — which is exactly why this is a third
 * credit type rather than more rows on the staff page.
 *
 * `cast` is keyed by canonical id, so the catalog scan and the slice lookup join
 * on `a.id` with no crosswalk involved.
 */
/**
 * Every anime a seiyuu is credited on, built from AniList's OWN answer
 * (`catalog/anilist_seiyuu.json`, filled by `getOrFetchSeiyuuFilmography`)
 * rather than from the cast slice.
 *
 * **This is the one that can answer "what has she done that I haven't seen".**
 * Its sibling `listAnimeBySeiyuu` below scans `catalog/anilist_cast.json`, which
 * is filled per title and therefore covers the owner's watched list and little
 * else — so its filmography is, structurally, the titles already seen, and
 * filtering it to `not_defined` returns nothing however many credits exist.
 * Asking from the person's side removes that dependency entirely.
 *
 * `resolve` is the **ingest boundary** (E9): the caller owns the crosswalk and
 * hands back a canonical id, so this module stays pure. Resolution is
 * resolve-only — a credit naming a title the store has never heard of is
 * counted in `unresolved` and dropped, never minted.
 */
export function listAnimeBySeiyuuFilmography(
  entry: AniListSeiyuuEntry,
  catalog: AnimeRecord[],
  resolve: (credit: AniListSeiyuuCredit) => string | undefined,
): CreditsResult {
  const byId = new Map(catalog.map(a => [a.id, a]));
  const records: CreditedRecord[] = [];
  let unresolved = 0;

  for (const credit of entry.credits) {
    const canonicalId = resolve(credit);
    // Two different misses, counted the same: no id in the crosswalk, and an id
    // that resolves to a record the catalog does not hold. Either way the title
    // cannot be rendered or filtered, so saying how many is the honest answer.
    const record = canonicalId === undefined ? undefined : byId.get(canonicalId);
    if (!record) { unresolved++; continue; }
    records.push({
      ...record,
      creditCharacters: credit.characters.map(c => ({
        id: c.id,
        name: c.name,
        role: c.role,
        image: c.image,
      })),
    });
  }

  return {
    name: entry.name,
    nameNative: entry.nameNative,
    image: entry.image,
    records,
    unresolved,
    complete: entry.complete,
  };
}

export function listAnimeBySeiyuu(
  staffId: number,
  catalog: AnimeRecord[],
  cast: Record<string, AniListCastEntry>,
): CreditsResult | null {
  let name: string | null = null;
  let nameNative: string | undefined;
  let image: string | undefined;
  let castCovered = 0;
  const records: CreditedRecord[] = [];

  for (const a of catalog) {
    const entry = cast[a.id];
    if (!entry) continue;
    castCovered++;
    const characters: CreditedCharacter[] = [];
    for (const c of entry.characters) {
      const va = c.voiceActors.find(v => v.id === staffId);
      if (!va) continue;
      // First hit wins for the identity fields, but a later entry can still
      // fill a gap: AniList omits `nameNative`/`image` on some credits and
      // carries them on others for the same person.
      if (!name) name = va.name;
      nameNative = nameNative || va.nameNative;
      image = image || va.image;
      characters.push({ id: c.id, name: c.name, role: c.role, image: c.image });
    }
    if (characters.length > 0) records.push({ ...a, creditCharacters: characters });
  }

  if (!name) return null;
  return { name, nameNative, image, records, castCovered };
}
