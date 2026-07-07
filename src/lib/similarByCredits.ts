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

import type { AnimeForDisplay } from '@/models/anime';

export interface SharedStaffCredit {
  name: string;
  role: string;
}

export interface SimilarByCredits {
  id: number;
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

/** Technical (non-source-author) staff credits for one anime. */
function technicalStaff(a: AnimeForDisplay) {
  return (a.anilistTags?.staff || []).filter(s => isTechnicalStaff(s.role));
}

/**
 * IDF per discrete value over the whole catalog: `max(0, log(N / (1 + df)))`.
 * Clamped at 0 so an ultra-common shared value can never *reduce* similarity.
 */
function computeIdf<T>(catalog: AnimeForDisplay[], extract: (a: AnimeForDisplay) => T[]): Map<T, number> {
  const df = new Map<T, number>();
  for (const a of catalog) {
    for (const v of new Set(extract(a))) df.set(v, (df.get(v) || 0) + 1);
  }
  const N = catalog.length;
  const idf = new Map<T, number>();
  df.forEach((count, v) => idf.set(v, Math.max(0, Math.log(N / (1 + count)))));
  return idf;
}

/**
 * Top-`limit` catalog anime most similar to `target` by shared studios +
 * technical staff. IDF is computed over the FULL catalog (target included — its
 * credits are part of the document frequency); the target and its
 * `related_anime` are excluded only from the *candidate* set (a franchise
 * entry trivially shares its whole crew and already has its own section).
 */
export function computeSimilarByCredits(
  target: AnimeForDisplay,
  catalog: AnimeForDisplay[],
  limit = 3,
): SimilarByCredits[] {
  const targetStudios = target.studios || [];
  const targetStaff = technicalStaff(target);
  const targetStudioIds = new Set(targetStudios.map(s => s.id));
  const targetStaffIds = new Set(targetStaff.map(s => s.id));
  if (targetStudioIds.size === 0 && targetStaffIds.size === 0) return [];

  const studioIdf = computeIdf(catalog, a => (a.studios || []).map(s => s.id));
  const staffIdf = computeIdf(catalog, a => technicalStaff(a).map(s => s.id));

  // Display lookups from the target (names/roles as the target credits them).
  const studioName = new Map(targetStudios.map(s => [s.id, s.name]));
  const staffById = new Map(targetStaff.map(s => [s.id, s]));

  const excluded = new Set<number>([target.id, ...(target.related_anime || []).map(r => r.node.id)]);

  const scored: Array<SimilarByCredits & { mean: number }> = [];
  for (const cand of catalog) {
    if (excluded.has(cand.id)) continue;

    const candStudioIds = new Set((cand.studios || []).map(s => s.id));
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
      title: cand.title,
      poster: cand.main_picture?.medium || cand.main_picture?.large,
      score,
      sharedStudios,
      sharedStaff,
      mean: cand.mean ?? 0,
    });
  }

  // Deterministic ordering: score desc, then MAL mean desc, then id asc.
  scored.sort((a, b) => b.score - a.score || b.mean - a.mean || a.id - b.id);
  return scored.slice(0, limit).map(({ mean, ...rest }) => rest);
}
