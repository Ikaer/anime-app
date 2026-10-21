/**
 * Catalog-wide global search — powers the header search box. Matches anime by
 * title (English + original), plus studios, AniList staff and seiyuu by name, so
 * the box can jump straight to a detail page OR to a studio/staff/seiyuu page.
 *
 * Pure and client-safe (no `fs`); the catalog is passed in, same convention as
 * creditsCatalog.ts / similarByCredits.ts. The API route feeds it `getAnimeRecords()`.
 *
 * Matching is two passes: an exact substring pass (ranks 0-3), then a
 * typo-tolerant fallback over TITLES ONLY (ranks 4-5) that runs only when the
 * exact pass came up short. See "Fuzzy fallback" below for why it is shaped
 * that way.
 */

import type { AniListCastEntry, AniListSeiyuuEntry, AnimeRecord } from '@/models/anime';
import { getCatalogPrimaryTitle } from '@/lib/domain/animeUtils';
import type { TitleLanguage } from '@/lib/url/viewDefaults';

export interface AnimeSearchHit {
  /** Canonical id — the detail-page route key. */
  id: string;
  title: string;            // primary (English-first)
  secondary?: string;       // original title, only when it differs from the primary
  poster?: string;
  year?: number;
  mediaType?: string;
  mean: number | null;
  /** True when this hit came from the fuzzy pass — the query does not literally occur in any of its titles. */
  fuzzy?: boolean;
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
  seiyuu: CreditSearchHit[];
}

/**
 * Where the seiyuu come from. Neither slice is on the record — the cast slice is
 * deliberately off `getAnimeForDisplay()`'s join, and a filmography belongs to a
 * person — so the caller hands both in, keeping this module pure.
 *
 * ⚠️ BOTH, never the cast slice alone. The cast slice only covers titles that
 * were opened or swept (~the owner's own list), so a seiyuu met only through a
 * filmography — a favourite, or a page visited from a credit — would be
 * unfindable; and a filmography's credit count is the true one, where the cast
 * slice's counts only the titles it happens to hold.
 */
export interface SeiyuuSearchSource {
  cast: Record<string, AniListCastEntry>;
  filmographies: Record<string, AniListSeiyuuEntry>;
}

export const MIN_QUERY_LENGTH = 2;

const ANIME_LIMIT = 8;
const CREDIT_LIMIT = 6;

const EMPTY: GlobalSearchResults = { animes: [], studios: [], staff: [], seiyuu: [] };

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
  // `ja` included so a `native` reader can search for the title they are
  // actually shown — matching is deliberately preference-independent, unlike
  // the `titleLang` that decides which name is DISPLAYED on the hit.
  const candidates = [a.catalog.title, alt?.en, alt?.ja, ...(alt?.synonyms || [])];
  let best = Infinity;
  for (const c of candidates) {
    if (!c) continue;
    const r = matchRank(c, needle);
    if (r < best) best = r;
    if (best === 0) break;
  }
  return best;
}

function toAnimeHit(a: AnimeRecord, titleLang: TitleLanguage, fuzzy?: boolean): AnimeSearchHit {
  const primary = getCatalogPrimaryTitle(a.catalog, titleLang);
  const original = a.catalog.title;
  return {
    id: a.id,
    title: primary,
    secondary: original && original !== primary ? original : undefined,
    poster: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
    year: a.catalog.startSeason?.year,
    mediaType: a.catalog.mediaType,
    mean: a.catalog.mean ?? null,
    ...(fuzzy ? { fuzzy: true } : {}),
  };
}

// ============================================================================
// Fuzzy fallback — titles only, and only when the exact pass came up short
// ============================================================================

/**
 * Fuzzy hits rank STRICTLY below every exact rank (0-3), so a literal match can
 * never be displaced by a typo-tolerant one: rank 4 = one edit, rank 5 = two.
 */
const FUZZY_RANK_BASE = 4;

/**
 * Tolerance is indexed on query length, and that is the guard against flooding
 * the box rather than a nicety. Measured on the live store (26,432 titles,
 * 87,689 title strings): `stein` at k=2 matches 30,463 of them against 36
 * exact, and `sh` at k=1 matches 71% of the whole candidate universe. Below
 * FUZZY_MIN_LENGTH there is no tolerance at all, so short queries behave
 * exactly as they did before this shipped.
 */
const FUZZY_MIN_LENGTH = 5;
const FUZZY_TWO_EDIT_LENGTH = 10;

function fuzzyTolerance(len: number): number {
  if (len < FUZZY_MIN_LENGTH) return 0;
  return len < FUZZY_TWO_EDIT_LENGTH ? 1 : 2;
}

/**
 * Case and diacritics only. 3,036 of the live store's 87,689 title strings
 * carry a diacritic (`Rozen Maiden: Tr\u00e4umend`, `Fuka Ryouiki no D\u00e9j\u00e0 vu`), and
 * nobody types them.
 *
 * \u26a0\ufe0f It deliberately does NOT fold punctuation, though that looks like the
 * obvious next step for `Kaguya-sama` / `Steins;Gate` / `Spy x Family`. It was
 * built that way, measured against the live store, and reverted: the edit
 * budget already absorbs a lone `-` or `;` as one substitution, so folding
 * changed the result set for **none** of `kaguya sama`, `spy family`,
 * `steins gate`, `fate stay night`, `jojo bizarre`, `ghost in the shell` or
 * `fullmetal alchemist`. Where it did bite it made things worse: `re zero`
 * gained 15 hits, all noise (`Zero Sum Game`, `Ga-Rei: Zero`, `Macross Zero`),
 * because collapsing the separator lets the needle straddle word boundaries it
 * should not. Re-adding it needs that measurement redone, not an argument.
 */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Pigeonhole prefilter: any alignment within `k` edits must contain at least
 * one of the needle's pieces verbatim, so a cheap `indexOf` discards almost the
 * whole catalog before the DP runs — measured, 520 DP calls out of 87,689
 * candidate strings for "swort art online".
 *
 * ⚠️ SPLIT INTO k+2 PIECES, NOT k+1. The classic bound is k+1, but it assumes
 * one edit damages one piece — false for a Damerau transposition, which spans
 * two characters and so damages TWO pieces when it straddles their boundary.
 * Measured case: `freiren` against `frieren` at k=1 splits into `fre`/`iren`,
 * and the haystack contains neither, so the title silently vanishes from the
 * results; at k+2 the piece `fr` survives and it is found. The extra piece is
 * what absorbs the straddle.
 *
 * Note the failure needs the transposition to LAND on a boundary, so most
 * queries pass either way — which is exactly why this is pinned in
 * tests/domain/globalSearch.test.ts rather than trusted to review.
 */
function gatePieces(needle: string, k: number): string[] {
  const parts = k + 2;
  const size = Math.floor(needle.length / parts);
  if (size < 1) return [needle];
  const out: string[] = [];
  for (let i = 0; i < parts; i++) {
    out.push(i === parts - 1 ? needle.slice(i * size) : needle.slice(i * size, (i + 1) * size));
  }
  return out.filter(Boolean);
}

function passesGate(hay: string, pieces: string[]): boolean {
  for (const p of pieces) if (hay.indexOf(p) >= 0) return true;
  return false;
}

/**
 * Damerau-Levenshtein distance between `needle` and the CLOSEST SUBSTRING of
 * `hay` — start and end are free on the haystack, so `abbys` scores 1 against
 * `made in abyss` instead of paying for the prefix and the suffix.
 *
 * Damerau rather than plain Levenshtein because a transposition is the typo
 * people actually make and costs 2 without it: `nartuo` finds nothing at k=1,
 * and `sowrd art online` nothing at k=2.
 *
 * Returns `k + 1` ("further away than k") as soon as a whole row exceeds the
 * budget, which is what keeps the scan affordable on long titles.
 */
function fuzzyDistance(hay: string, needle: string, k: number): number {
  const n = needle.length;
  const m = hay.length;
  if (m + k < n) return k + 1;

  // Three rolling rows — the transposition term reads the row before last.
  // Row 0 being all zeros is what makes the match's START free.
  let before = new Array<number>(m + 1).fill(0);
  let prev = new Array<number>(m + 1).fill(0);
  let cur = new Array<number>(m + 1);

  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = i;
    const nc = needle.charCodeAt(i - 1);
    const nPrev = i > 1 ? needle.charCodeAt(i - 2) : -1;
    for (let j = 1; j <= m; j++) {
      const hc = hay.charCodeAt(j - 1);
      let v = prev[j - 1] + (nc === hc ? 0 : 1);
      const del = prev[j] + 1;
      if (del < v) v = del;
      const ins = cur[j - 1] + 1;
      if (ins < v) v = ins;
      if (i > 1 && j > 1 && nc === hay.charCodeAt(j - 2) && nPrev === hc) {
        const swap = before[j - 2] + 1;
        if (swap < v) v = swap;
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > k) return k + 1;
    const spare = before;
    before = prev;
    prev = cur;
    cur = spare;
  }

  // Free END: the best cell anywhere along the last row.
  let best = k + 1;
  for (let j = 0; j <= m; j++) if (prev[j] < best) best = prev[j];
  return best;
}

/**
 * Normalized title strings, memoized on the row array's IDENTITY — the same
 * trick `genreVocabulary` / `byCredits` use: the store hands out the same
 * reference until a slice actually changes on disk, so this normalizes once per
 * data change rather than once per keystroke. Measured on the live store:
 * 87,689 strings, 77ms to build, ~11MB resident.
 *
 * Titles only, deliberately. Studio and staff names are another 320,167
 * candidate strings, for a far rarer kind of query; they stay on the exact
 * path, and that is most of why this feature is affordable at all.
 */
const titleIndexCache = new WeakMap<AnimeRecord[], string[][]>();

function getNormalizedTitles(catalog: AnimeRecord[]): string[][] {
  let index = titleIndexCache.get(catalog);
  if (!index) {
    index = catalog.map(a => {
      const alt = a.catalog.alternativeTitles;
      const out: string[] = [];
      for (const c of [a.catalog.title, alt?.en, alt?.ja, ...(alt?.synonyms || [])]) {
        if (!c) continue;
        const n = normalize(c);
        if (n) out.push(n);
      }
      return out;
    });
    titleIndexCache.set(catalog, index);
  }
  return index;
}

// ============================================================================
// Seiyuu — one person per AniList staff id, off the cast + filmography slices
// ============================================================================

interface SeiyuuPerson { id: number; name: string; count: number; matchable: string[] }

/**
 * Every string a seiyuu answers to: AniList's given-family romanization, the
 * same two words family-first (the order Japanese sources and half the web use —
 * `Kiyoto Arisa` must find Arisa Kiyoto), and the native name.
 */
function seiyuuNames(name: string, nameNative?: string): string[] {
  const out = [name];
  const words = name.trim().split(/\s+/);
  if (words.length === 2) out.push(`${words[1]} ${words[0]}`);
  if (nameNative) out.push(nameNative);
  return out;
}

/**
 * Memoized on the cast slice's identity, then the filmography slice's — the
 * parse cache hands out the same object until the file changes on disk, so this
 * is rebuilt per data change, not per keystroke.
 */
const seiyuuIndexCache = new WeakMap<object, WeakMap<object, SeiyuuPerson[]>>();

function getSeiyuuIndex(source: SeiyuuSearchSource): SeiyuuPerson[] {
  let inner = seiyuuIndexCache.get(source.cast);
  if (!inner) {
    inner = new WeakMap();
    seiyuuIndexCache.set(source.cast, inner);
  }
  let index = inner.get(source.filmographies);
  if (index) return index;

  const people = new Map<number, { id: number; name: string; nameNative?: string; titles: Set<string>; credits?: number }>();
  for (const [titleId, entry] of Object.entries(source.cast)) {
    for (const character of entry.characters) {
      for (const va of character.voiceActors) {
        if (!va.name) continue;
        let p = people.get(va.id);
        if (!p) {
          p = { id: va.id, name: va.name, nameNative: va.nameNative, titles: new Set() };
          people.set(va.id, p);
        }
        // A Set, not a counter: a seiyuu voicing twins, or a character and its
        // child self, is one title.
        p.titles.add(titleId);
      }
    }
  }
  for (const f of Object.values(source.filmographies)) {
    if (!f.name) continue;
    const p = people.get(f.staff_id);
    if (p) p.credits = f.credits.length;
    else people.set(f.staff_id, { id: f.staff_id, name: f.name, nameNative: f.nameNative, titles: new Set(), credits: f.credits.length });
  }

  index = Array.from(people.values()).map(p => ({
    id: p.id,
    name: p.name,
    count: Math.max(p.credits ?? 0, p.titles.size),
    matchable: seiyuuNames(p.name, p.nameNative),
  }));
  inner.set(source.filmographies, index);
  return index;
}

/**
 * Search the catalog for anime / studios / staff / seiyuu matching `query`.
 * Returns empty for queries shorter than {@link MIN_QUERY_LENGTH}. Without
 * `people` the seiyuu group is simply empty.
 */
export function searchCatalog(
  query: string,
  catalog: AnimeRecord[],
  titleLang: TitleLanguage,
  people?: SeiyuuSearchSource,
): GlobalSearchResults {
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
      animeScored.push({
        hit: toAnimeHit(a, titleLang),
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

  // --- Fuzzy fallback ------------------------------------------------------
  // ⚠️ Gated on a THIN exact result, and that gate is the contract: a query
  // that already fills the list today does not pay for this pass and cannot
  // have its ordering changed by it. Only the empty slots below ANIME_LIMIT
  // are ever filled.
  const fuzzyNeedle = normalize(needle);
  const k = fuzzyTolerance(fuzzyNeedle.length);
  if (k > 0 && animeScored.length < ANIME_LIMIT) {
    const seen = new Set(animeScored.map(s => s.hit.id));
    const pieces = gatePieces(fuzzyNeedle, k);
    const titles = getNormalizedTitles(catalog);

    for (let i = 0; i < catalog.length; i++) {
      const a = catalog[i];
      if (seen.has(a.id)) continue;
      let best = k + 1;
      for (const c of titles[i]) {
        if (!passesGate(c, pieces)) continue;
        const d = fuzzyDistance(c, fuzzyNeedle, k);
        if (d < best) best = d;
        if (best === 0) break;
      }
      if (best > k) continue;
      // `best` can be 0 here — the title matched once punctuation and diacritics
      // were folded away (`kaguya sama` -> `Kaguya-sama`). That is still not a
      // literal match, so it stays inside the fuzzy band rather than outranking
      // titles the user's query really does occur in.
      animeScored.push({
        hit: toAnimeHit(a, titleLang, true),
        rank: FUZZY_RANK_BASE + Math.max(0, best - 1),
        mean: a.catalog.mean ?? -1,
      });
    }
  }

  // --- Seiyuu ------------------------------------------------------------
  // Exact path only, like studios and staff, over `seiyuuNames`.
  const seiyuuMap = new Map<number, CreditSearchHit & { rank: number }>();
  if (people) {
    for (const p of getSeiyuuIndex(people)) {
      let rank = Infinity;
      for (const n of p.matchable) rank = Math.min(rank, matchRank(n, needle));
      if (rank !== Infinity) seiyuuMap.set(p.id, { id: p.id, name: p.name, count: p.count, rank });
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
    seiyuu: sortCredits(seiyuuMap),
  };
}
