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
import { getPrimaryTitle, getEffectiveStatus, getEffectiveScore } from '@/lib/domain/animeUtils';

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
});

/** Airing order within a franchise: earliest first, undated last. */
export const byAirDate = (titleLang: TitleLanguage) => (a: AnimeRecord, b: AnimeRecord): number => {
  const ta = a.catalog.startDate ? new Date(a.catalog.startDate).getTime() : Number.MAX_SAFE_INTEGER;
  const tb = b.catalog.startDate ? new Date(b.catalog.startDate).getTime() : Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return getPrimaryTitle(a, titleLang).localeCompare(getPrimaryTitle(b, titleLang));
};
