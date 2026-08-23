/**
 * `AnimeRecord` → the lean shapes the MCP tools emit.
 *
 * The binding constraint here is **tokens, not bytes**: a tool result is text in
 * a model's context window, so this is the same server-side-projection posture as
 * `/api/anime/quick-rate` and `/api/anime/catch-up`, only stricter. Never emit
 * `sources`, `provenance` or `pictures` — that is the bulk of a record and none
 * of it means anything to a model.
 *
 * Pure and client-safe (no `fs`): the record is passed in, same convention as
 * `globalSearch.ts` / `stats.ts`.
 *
 * ⚠️ **The shared-reference contract applies** (see `jsonStore.ts`):
 * `getAnimeForDisplay()` may hand this module the same parsed objects other
 * callers hold, so every function below BUILDS a new object and never mutates or
 * trims a record in place.
 */
import type { AnimeRecord } from '@/models/anime';
import {
  getPrimaryTitle,
  getSecondaryTitle,
  getEffectiveStatus,
  getEffectiveScore,
  getEffectiveProgress,
} from '@/lib/domain/animeUtils';
import { groupByAxis } from '@/lib/domain/genreAxis';
import { groupStaffByTier } from '@/lib/domain/staffRole';
import type { ResolvedRelation } from '@/lib/domain/relations';

/** The card shape every LIST tool returns — ~10 fields, no prose. */
export interface McpAnimeCard {
  id: string;
  title: string;
  /** Original (romaji) title, only when it differs from the primary. */
  secondaryTitle?: string;
  year?: number;
  mediaType?: string;
  numEpisodes?: number;
  /** MAL-scale community mean (the precedence winner), 1-10. */
  mean?: number;
  genres: string[];
  studios: string[];
  /** Effective personal state — SIMKL > MAL > AniList > local, never a raw slice. */
  status?: string;
  score?: number;
  progress?: number;
}

/** What `get_anime` returns: the card plus everything a model needs to reason. */
export interface McpAnimeDetail extends McpAnimeCard {
  synopsis?: string;
  /** 'finished_airing' | 'currently_airing' | 'not_yet_aired'. */
  airingStatus?: string;
  season?: string;
  startDate?: string;
  endDate?: string;
  rank?: number;
  popularity?: number;
  numListUsers?: number;
  source?: string;
  rating?: string;
  nsfw?: string;
  averageEpisodeDurationMin?: number;
  /** `genres` split on the three axes it conflates (a derived lookup, not a field). */
  genreAxes?: { genre: string[]; demographic: string[]; theme: string[] };
  /** AniList tags, most relevant first. */
  tags?: Array<{ name: string; rank: number; category?: string }>;
  /** T1 (auteur tier) and T2 credits only — T3/T4 are noise at this altitude. */
  staff?: { tier1: Array<{ name: string; role: string }>; tier2: Array<{ name: string; role: string }> };
  relations?: Array<{ id: string; title: string; relationType: string }>;
  /** Provider ids, for linking out only — never a key. */
  externalUrls?: Record<string, string>;
}

/** Release year, preferring the season year, falling back to the start date. */
function year(a: AnimeRecord): number | undefined {
  if (a.catalog.startSeason?.year) return a.catalog.startSeason.year;
  const d = a.catalog.startDate;
  if (d && d.length >= 4) {
    const y = parseInt(d.slice(0, 4), 10);
    return Number.isFinite(y) ? y : undefined;
  }
  return undefined;
}

/** Drop `undefined` entries so the JSON a model reads carries no empty keys. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) {
    if (o[k] === undefined) delete o[k];
  }
  return o;
}

export function projectCard(a: AnimeRecord): McpAnimeCard {
  return compact({
    id: a.id,
    title: getPrimaryTitle(a),
    secondaryTitle: getSecondaryTitle(a),
    year: year(a),
    mediaType: a.catalog.mediaType,
    numEpisodes: a.catalog.numEpisodes || undefined,
    mean: a.catalog.mean,
    genres: (a.catalog.genres || []).map(g => g.name),
    studios: (a.catalog.studios || []).map(s => s.name),
    status: getEffectiveStatus(a),
    score: getEffectiveScore(a),
    progress: getEffectiveProgress(a),
  });
}

/** How many AniList tags are worth spending context on. */
const TAG_LIMIT = 15;

export function projectDetail(
  a: AnimeRecord,
  relations: ResolvedRelation[] = []
): McpAnimeDetail {
  const genres = (a.catalog.genres || []).map(g => g.name);
  const meta = a.sources.anilist;

  const staff = meta?.staff ? groupStaffByTier(meta.staff) : undefined;
  const credit = (c: { name: string; role: string }) => ({ name: c.name, role: c.role });

  const urls: Record<string, string> = {};
  const malId = a.crosswalk.mal;
  const anilistId = a.crosswalk.anilist;
  const simklId = a.crosswalk.simkl;
  if (malId != null) urls.mal = `https://myanimelist.net/anime/${malId}`;
  if (anilistId != null) urls.anilist = `https://anilist.co/anime/${anilistId}`;
  if (simklId != null) urls.simkl = `https://simkl.com/anime/${simklId}`;

  const season = a.catalog.startSeason
    ? `${a.catalog.startSeason.year} ${a.catalog.startSeason.season}`
    : undefined;

  const duration = a.catalog.averageEpisodeDuration
    ? Math.round(a.catalog.averageEpisodeDuration / 60)
    : undefined;

  return compact({
    ...projectCard(a),
    synopsis: a.catalog.synopsis,
    airingStatus: a.catalog.airingStatus,
    season,
    startDate: a.catalog.startDate,
    endDate: a.catalog.endDate,
    rank: a.catalog.rank,
    popularity: a.catalog.popularity,
    numListUsers: a.catalog.numListUsers,
    source: a.catalog.source,
    rating: a.catalog.rating,
    nsfw: a.catalog.nsfw,
    averageEpisodeDurationMin: duration,
    genreAxes: genres.length ? groupByAxis(genres) : undefined,
    tags: meta?.tags?.length
      ? [...meta.tags]
          .sort((x, y) => y.rank - x.rank)
          .slice(0, TAG_LIMIT)
          .map(t => compact({ name: t.name, rank: t.rank, category: t.category }))
      : undefined,
    staff: staff && (staff[1].length || staff[2].length)
      ? { tier1: staff[1].map(credit), tier2: staff[2].map(credit) }
      : undefined,
    relations: relations.length
      ? relations.map(r => ({
          id: r.record.id,
          title: getPrimaryTitle(r.record),
          relationType: r.relationType,
        }))
      : undefined,
    externalUrls: Object.keys(urls).length ? urls : undefined,
  });
}
