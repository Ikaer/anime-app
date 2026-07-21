/**
 * "More like this" by production credits — a pure, client-safe similarity over
 * STUDIOS + AniList technical STAFF only (no genres, tags, personal state, or
 * crowd recos). Powers the detail-page recommendations panel.
 *
 * Scoring: for a candidate, sum the IDF of every studio/staff-id it shares with
 * the target. IDF (`log(N / (1 + df))`, same smoothing as recommendations.ts'
 * `computeIdf`) self-balances the two signals — a shared obscure studio or a
 * shared director counts far more than a ubiquitous studio like Toei — so no
 * arbitrary staff-vs-studio multiplier is needed. Staff data is optional and
 * empty until an AniList sync runs, so under partial coverage this degrades
 * gracefully to studio-only; the per-card `sharedStudios`/`sharedStaff`
 * breakdown makes that honest and self-documenting.
 *
 * No `fs` — reusable client-side. The catalog is passed in.
 */

import type { AnimeRecord } from '@/models/anime';
import { getCatalogPrimaryTitle } from '@/lib/animeUtils';

export interface SharedStaffCredit {
  name: string;
  role: string;
}

export interface SimilarByCredits {
  /** Canonical id (docs/PROVIDER-FREE-CUTOVER.md Phase D) — the detail-page route key. */
  id: string;
  title: string;
  poster?: string;
  score: number;
  sharedStudios: string[];
  sharedStaff: SharedStaffCredit[];
}

/**
 * Roles that describe SOURCE MATERIAL (the mangaka / light-novel author), not
 * the production/technical crew. Excluded so "staff similarity" means a shared
 * *production team* (director, composition, music…), not a shared adaptation
 * origin — the user asked specifically for *technical* staff.
 */
const SOURCE_ROLE_RE = /original creator|original story|^story$/i;

function isTechnicalStaff(role: string): boolean {
  return !SOURCE_ROLE_RE.test(role.trim());
}

type StaffEntry = NonNullable<NonNullable<AnimeRecord['sources']['anilist']>['staff']>[number];

// Records coming out of the store's row cache are stable references between
// data changes, so the per-record role filtering (a regex over ~15 credits ×
// the whole catalog, on every detail-page hit) memoizes cleanly on the record
// object itself. Self-evicting: a rebuilt row is a new key, the old one is GC'd.
const technicalStaffCache = new WeakMap<AnimeRecord, StaffEntry[]>();

/** Technical (non-source-author) staff credits for one anime. */
function technicalStaff(a: AnimeRecord): StaffEntry[] {
  let staff = technicalStaffCache.get(a);
  if (!staff) {
    staff = (a.sources.anilist?.staff || []).filter(s => isTechnicalStaff(s.role));
    technicalStaffCache.set(a, staff);
  }
  return staff;
}

/** The anime's own raw MAL id, when resolvable — for comparing against another title's raw MAL relation ids. */
function malIdOf(a: AnimeRecord): number {
  const mal = a.crosswalk.mal;
  return typeof mal === 'string' ? parseInt(mal, 10) : (mal as number);
}

/**
 * IDF per discrete value over the whole catalog: `max(0, log(N / (1 + df)))`.
 * Clamped at 0 so an ultra-common shared value can never *reduce* similarity.
 */
function computeIdf<T>(catalog: AnimeRecord[], extract: (a: AnimeRecord) => T[]): Map<T, number> {
  const df = new Map<T, number>();
  for (const a of catalog) {
    for (const v of new Set(extract(a))) df.set(v, (df.get(v) || 0) + 1);
  }
  const N = catalog.length;
  const idf = new Map<T, number>();
  df.forEach((count, v) => idf.set(v, Math.max(0, Math.log(N / (1 + count)))));
  return idf;
}

// The two IDF maps depend only on the catalog array, never on the target — and
// the store hands out the same array reference until the underlying data
// changes, so they memoize on it (WeakMap: a rebuilt catalog is a new key, the
// old entry is GC'd). Without this, every detail-page hit re-walked the whole
// ~25k-row catalog twice.
interface IdfMaps {
  studioIdf: Map<number, number>;
  staffIdf: Map<number, number>;
}
const idfCache = new WeakMap<AnimeRecord[], IdfMaps>();

function catalogIdf(catalog: AnimeRecord[]): IdfMaps {
  let maps = idfCache.get(catalog);
  if (!maps) {
    maps = {
      studioIdf: computeIdf(catalog, a => (a.catalog.studios || []).map(s => s.id)),
      staffIdf: computeIdf(catalog, a => technicalStaff(a).map(s => s.id)),
    };
    idfCache.set(catalog, maps);
  }
  return maps;
}

/**
 * Top-`limit` catalog anime most similar to `target` by shared studios +
 * technical staff. IDF is computed over the FULL catalog (target included — its
 * credits are part of the document frequency); the target and its
 * `related_anime` are excluded only from the *candidate* set (a franchise
 * entry trivially shares its whole crew and already has its own section).
 */
export function computeSimilarByCredits(
  target: AnimeRecord,
  catalog: AnimeRecord[],
  limit = 3,
): SimilarByCredits[] {
  const targetStudios = target.catalog.studios || [];
  const targetStaff = technicalStaff(target);
  const targetStudioIds = new Set(targetStudios.map(s => s.id));
  const targetStaffIds = new Set(targetStaff.map(s => s.id));
  if (targetStudioIds.size === 0 && targetStaffIds.size === 0) return [];

  const { studioIdf, staffIdf } = catalogIdf(catalog);

  // Display lookups from the target (names/roles as the target credits them).
  const studioName = new Map(targetStudios.map(s => [s.id, s.name]));
  const staffById = new Map(targetStaff.map(s => [s.id, s]));

  // Franchise exclusion is keyed by MAL id: `relatedAnime` ids come straight
  // off the raw MAL relation payload, so a candidate's own MAL id (not its
  // canonical id) is the only thing they're comparable against.
  const excludedMalIds = new Set<number>((target.catalog.relatedAnime || []).map(r => r.node.id));

  const scored: Array<SimilarByCredits & { mean: number }> = [];
  for (const cand of catalog) {
    if (cand.id === target.id) continue;
    if (excludedMalIds.has(malIdOf(cand))) continue;

    const candStudioIds = new Set((cand.catalog.studios || []).map(s => s.id));
    const candStaffIds = new Set(technicalStaff(cand).map(s => s.id));

    let score = 0;
    const sharedStudios: string[] = [];
    for (const sid of targetStudioIds) {
      if (candStudioIds.has(sid)) {
        score += studioIdf.get(sid) || 0;
        sharedStudios.push(studioName.get(sid) || String(sid));
      }
    }
    const sharedStaff: SharedStaffCredit[] = [];
    for (const stid of targetStaffIds) {
      if (candStaffIds.has(stid)) {
        score += staffIdf.get(stid) || 0;
        const s = staffById.get(stid);
        if (s) sharedStaff.push({ name: s.name, role: s.role });
      }
    }

    if (sharedStudios.length === 0 && sharedStaff.length === 0) continue;

    scored.push({
      id: cand.id,
      title: getCatalogPrimaryTitle(cand.catalog),
      poster: cand.catalog.mainPicture?.medium || cand.catalog.mainPicture?.large,
      score,
      sharedStudios,
      sharedStaff,
      mean: cand.catalog.mean ?? 0,
    });
  }

  // Deterministic ordering: score desc, then MAL mean desc, then id asc.
  scored.sort((a, b) => b.score - a.score || b.mean - a.mean || a.id.localeCompare(b.id));
  return scored.slice(0, limit).map(({ mean, ...rest }) => rest);
}
