/**
 * The lean row shape the group-oriented surfaces ship instead of `AnimeRecord`.
 *
 * `/quick-rate` scopes the whole ~25k catalog and `/boxes` ships every member of
 * every franchise group on a page; a full record carries `sources`,
 * `provenance` and `pictures`, which is tens of megabytes for a few kilobytes of
 * useful content. So those endpoints project server-side — the same posture as
 * `lib/mcp/project.ts`, for the same reason.
 *
 * It lives here rather than in whichever route needed it first because two now
 * do, and the alternative was one API route importing values out of another —
 * which nothing in this repo does (`stats.tsx` imports a *type* from its route,
 * and that is the whole precedent).
 *
 * ⚠️ The `jsonStore` shared-reference contract applies: this BUILDS a new object
 * and must never trim a record in place.
 *
 * Client-safe — `domain/**` is in the enforced no-`fs` set, hence `titleLang` as
 * a parameter rather than a `getTitleLanguage()` call (see the title-language
 * section of CLAUDE.md).
 */

import type { AnimeRecord } from '@/models/anime';
import type { TitleLanguage } from '@/lib/url/viewDefaults';
import { getPrimaryTitle, getEffectiveStatus, getEffectiveScore, getLastWatchedAt } from '@/lib/domain/animeUtils';

/** Everything a franchise-group card needs, and nothing else. */
export interface LeanAnimeRow {
  id: string;
  title: string;
  picture?: string;
  numEpisodes?: number;
  mean?: number;
  year?: number;
  mediaType?: string;
  status?: string;
  score?: number;
  /** `getLastWatchedAt` — SIMKL's clock, absent on an install without SIMKL. */
  watchedAt?: string;
}

export const toLeanRow = (a: AnimeRecord, titleLang: TitleLanguage): LeanAnimeRow => ({
  id: a.id,
  title: getPrimaryTitle(a, titleLang),
  picture: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
  numEpisodes: a.catalog.numEpisodes,
  mean: a.catalog.mean,
  year: a.catalog.startSeason?.year,
  mediaType: a.catalog.mediaType,
  status: getEffectiveStatus(a),
  score: getEffectiveScore(a),
  watchedAt: getLastWatchedAt(a),
});

/** The quick-edit panes' orders. `label` is the displayed title, A→Z. */
export type LeanRowSort = 'scoreDesc' | 'scoreAsc' | 'label' | 'feed';

/**
 * Order lean rows by the owner's score, title or watch clock.
 *
 * ⚠️ **Unrated sorts LAST in both score directions, and undated last in
 * `feed`.** Reading a missing score as 0 is right for descending and silently
 * wrong for ascending — « ma note ↑ » would open on every unrated title instead
 * of on the owner's lowest scores. Same rule as `sortAnimeRecords`' `numOrNull`.
 * Pinned in tests/domain/leanRowSort.test.ts.
 *
 * Returns a NEW array, and ties keep the input order (`Array.prototype.sort` is
 * stable) — which is the tie-break: the watched list arrives score-then-air-order
 * from the server, a box's members in air order.
 */
export function sortLeanRows(rows: readonly LeanAnimeRow[], sort: LeanRowSort): LeanAnimeRow[] {
  const scored = (r: LeanAnimeRow) => (r.score ? r.score : null);
  const cmp = (a: LeanAnimeRow, b: LeanAnimeRow): number => {
    switch (sort) {
      case 'scoreDesc':
      case 'scoreAsc': {
        const sa = scored(a);
        const sb = scored(b);
        if (sa === null || sb === null) return (sa === null ? 1 : 0) - (sb === null ? 1 : 0);
        return sort === 'scoreDesc' ? sb - sa : sa - sb;
      }
      case 'label':
        return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
      case 'feed': {
        if (!a.watchedAt || !b.watchedAt) return (a.watchedAt ? 0 : 1) - (b.watchedAt ? 0 : 1);
        return b.watchedAt.localeCompare(a.watchedAt);
      }
    }
  };
  return [...rows].sort(cmp);
}

/** Airing order within a franchise: earliest first, undated last. */
export const byAirDate = (titleLang: TitleLanguage) => (a: AnimeRecord, b: AnimeRecord): number => {
  const ta = a.catalog.startDate ? new Date(a.catalog.startDate).getTime() : Number.MAX_SAFE_INTEGER;
  const tb = b.catalog.startDate ? new Date(b.catalog.startDate).getTime() : Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return getPrimaryTitle(a, titleLang).localeCompare(getPrimaryTitle(b, titleLang));
};
