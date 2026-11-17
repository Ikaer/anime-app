/**
 * « Où plusieurs se croisent » — unseen titles where SEVERAL favourite seiyuu
 * hold a real role, one row per franchise. Client-safe and pure: the caller
 * (`/favorite-seiyuu`'s getServerSideProps) decides eligibility and hands over
 * lean candidates, so every rule below is testable without a store.
 *
 * Rules, each of which fails silently if dropped (pinned in
 * tests/reco/favSeiyuuCrossings.test.ts):
 *
 * - **Only roles that weigh count** (`FAV_SEIYUU_ROLE_WEIGHT > 0`). A crowd
 *   voice is not a crossing; counting BACKGROUND would put every long-runner
 *   with a big extras cast on top.
 * - **Two distinct people minimum.** The index already holds a person once per
 *   title at their best role, so a seiyuu voicing twins is never two.
 * - **One row per franchise.** Measured on the live store when this shipped:
 *   264 qualifying entries, 161 franchises — *Kanojo, Okarishimasu* alone was 10
 *   rows (seasons, Petit shorts, date movies), all one casting.
 * - **The face is the EARLIEST-AIRED non-sequel qualifying entry**, not the
 *   strongest one. Picking by strength opened *Rent-a-Girlfriend* on a short
 *   ONA date movie (three leads there, one in the TV series) and *KonoSuba* on
 *   its film; a sequel face would open *Isekai Quartet 3* to someone who has not
 *   seen the first. A franchise whose only crossings are sequels is still
 *   listed, marked `sequel`.
 * - **The row's people are the UNION over its qualifying entries**, each at
 *   their best role there, and the row ranks on that union. The row is a
 *   statement about the franchise; ranking on the face alone would sink a
 *   franchise whose strongest crossing is not its first entry.
 * - **Ordered by leads, then people — NOT by `favSeiyuuValue`.** The noisy-OR
 *   saturates: two MAIN roles already give 0.91, so dozens of rows tie on the
 *   reco value while the counts still separate them. The community mean breaks
 *   ties; it is never a filter (a casting says nothing about quality, so the
 *   mean is shown rather than used to hide).
 * - **PVs, CMs and music videos are never rows** — `/catch-up`'s rule: a 30s
 *   promo where four favourites say one line each is noise, not a show.
 */

import { FAV_SEIYUU_ROLE_WEIGHT, type FavSeiyuuHit } from './favSeiyuu';

const NOT_A_SHOW = new Set(['pv', 'cm', 'music']);

export interface CrossingCandidate {
  id: string;
  hits: readonly FavSeiyuuHit[];
  mediaType?: string;
  /** `catalog.startDate`, any precision; undated sorts last. */
  startDate?: string;
  mean?: number | null;
  /** Any stable id shared by every entry of the franchise (its first member's id). */
  franchiseKey: string;
  /** `isPrematureSequel` — a prequel the owner has not watched exists. */
  sequel: boolean;
}

export interface Crossing {
  /** The entry the row shows and links to. */
  id: string;
  /** Favourites with a weighing role anywhere in the qualifying entries, best role each, leads first. */
  hits: FavSeiyuuHit[];
  main: number;
  count: number;
  /** Other qualifying entries of the same franchise, folded into this row. */
  others: number;
  sequel: boolean;
  mean: number | null;
}

interface Scored {
  c: CrossingCandidate;
  hits: FavSeiyuuHit[];
  main: number;
}

const byStrength = (a: Scored, b: Scored) =>
  b.main - a.main || b.hits.length - a.hits.length;

const byAirDate = (a: Scored, b: Scored) => {
  // Undated last — '' would otherwise sort FIRST.
  const da = a.c.startDate || '￿';
  const db = b.c.startDate || '￿';
  return da < db ? -1 : da > db ? 1 : 0;
};

export function findCrossings(candidates: readonly CrossingCandidate[]): Crossing[] {
  const groups = new Map<string, Scored[]>();
  for (const c of candidates) {
    if (c.mediaType && NOT_A_SHOW.has(c.mediaType)) continue;
    const hits = c.hits.filter(h => FAV_SEIYUU_ROLE_WEIGHT[h.role] > 0);
    if (hits.length < 2) continue;
    const scored: Scored = { c, hits, main: hits.filter(h => h.role === 'MAIN').length };
    const g = groups.get(c.franchiseKey);
    if (g) g.push(scored); else groups.set(c.franchiseKey, [scored]);
  }

  const rows: Crossing[] = [];
  for (const entries of groups.values()) {
    entries.sort((a, b) => Number(a.c.sequel) - Number(b.c.sequel) || byAirDate(a, b) || byStrength(a, b));
    const face = entries[0];
    const people = new Map<number, FavSeiyuuHit>();
    for (const e of entries) {
      for (const h of e.hits) {
        const prev = people.get(h.staffId);
        if (!prev) { people.set(h.staffId, { ...h, characters: [...h.characters] }); continue; }
        if (h.role === 'MAIN' && prev.role !== 'MAIN') { prev.role = 'MAIN'; prev.characters = [...h.characters]; }
      }
    }
    // The face's own people first (its characters are the ones its poster shows), leads first.
    const onFace = new Set(face.hits.map(h => h.staffId));
    const hits = [...people.values()].sort((a, b) =>
      Number(b.role === 'MAIN') - Number(a.role === 'MAIN') || Number(onFace.has(b.staffId)) - Number(onFace.has(a.staffId)));
    const main = hits.filter(h => h.role === 'MAIN').length;
    rows.push({
      id: face.c.id,
      hits,
      main,
      count: hits.length,
      others: entries.length - 1,
      sequel: face.c.sequel,
      mean: face.c.mean ?? null,
    });
  }

  return rows.sort((a, b) =>
    b.main - a.main || b.count - a.count || (b.mean ?? -1) - (a.mean ?? -1) || a.id.localeCompare(b.id));
}
