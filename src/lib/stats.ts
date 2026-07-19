/**
 * Repartition stats over the STATUSED personal list — "what does my watch
 * history actually consist of", across six dimensions.
 *
 * Pure and client-safe (no `fs`): the catalog and the cast slice are passed in,
 * same convention as creditsCatalog.ts / similarByCredits.ts. The API route owns
 * the reads.
 *
 * Scope is the statused list (the tier board's scope, via `getEffectiveStatus`),
 * NOT the ~25k crawled catalog — a repartition over titles the user never
 * watched would describe MAL's catalog, not the user's taste.
 *
 * Four dimensions come free off the joined record; two do not:
 * - `producers` exists ONLY on the lazily-filled cast slice (MAL's API has no
 *   producers field at all — see `AniListCastEntry.studios`),
 * - `seiyuu` likewise lives in that off-the-join slice.
 * Both are therefore only as complete as the cast sweep has made them, which is
 * why every dimension reports its own `coverage`.
 */

import type { AniListCastEntry, AnimeRecord } from '@/models/anime';
import { getEffectiveStatus } from '@/lib/animeUtils';

/** The six repartition dimensions. */
export type StatsDimension =
  | 'studios'
  | 'seiyuu'
  | 'staff'
  | 'producers'
  | 'tags'
  | 'genres';

export const STATS_DIMENSIONS: StatsDimension[] = [
  'studios', 'seiyuu', 'staff', 'producers', 'tags', 'genres',
];

/** Entries returned per dimension. */
export const TOP_N = 50;

export interface StatEntry {
  /** Stable identity within its dimension — the numeric id where one exists, else the name. */
  key: string;
  name: string;
  /** Number of DISTINCT anime this entity appears on (never a role/credit count). */
  count: number;
  /** `count` as a share of the filtered title total, 0-100, one decimal. */
  pct: number;
  /** AniList staff id — present for seiyuu and staff, which link to /credits/staff/[id]. */
  id?: number;
  /** Portrait URL — seiyuu only (that's the dimension the user asked to show with photos). */
  image?: string;
  /** Dimension-specific context: most frequent role (staff), sample characters (seiyuu). */
  detail?: string;
}

export interface DimensionStats {
  dimension: StatsDimension;
  entries: StatEntry[];
  /** Distinct entities seen before the top-N cut, so the UI can say "top 50 of 412". */
  distinct: number;
  /** Titles in scope carrying ANY data for this dimension — the honesty number. */
  covered: number;
}

export interface StatsResult {
  /** Titles in scope after the status filter — the percentage denominator. */
  total: number;
  /** Titles carrying a status at all, before the status filter. */
  totalStatused: number;
  dimensions: Record<StatsDimension, DimensionStats>;
}

/**
 * One entity occurrence on one anime. Accumulated per dimension, then folded
 * into counts of DISTINCT anime — a seiyuu voicing three characters in the same
 * show, or a staffer credited twice on it, must count once.
 */
interface Bucket {
  name: string;
  id?: number;
  image?: string;
  animeIds: Set<string>;
  /** Free-text occurrences (roles, character names) tallied for `detail`. */
  notes: Map<string, number>;
}

function bump(
  buckets: Map<string, Bucket>,
  key: string,
  animeId: string,
  fields: { name: string; id?: number; image?: string; note?: string }
): void {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { name: fields.name, id: fields.id, image: fields.image, animeIds: new Set(), notes: new Map() };
    buckets.set(key, bucket);
  }
  // First non-empty portrait wins — AniList omits it for some credits on a
  // title while having one on another.
  if (!bucket.image && fields.image) bucket.image = fields.image;
  bucket.animeIds.add(animeId);
  if (fields.note) bucket.notes.set(fields.note, (bucket.notes.get(fields.note) ?? 0) + 1);
}

/** Most frequent note, ties broken alphabetically so output is deterministic. */
function topNote(notes: Map<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = 0;
  for (const [note, count] of notes) {
    if (count > bestCount || (count === bestCount && best !== undefined && note < best)) {
      best = note;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Buckets → the top-N slice. Ordered by count desc, then name asc so equal
 * counts don't reshuffle between requests.
 */
function finalize(
  dimension: StatsDimension,
  buckets: Map<string, Bucket>,
  total: number,
  covered: number,
  withDetail: boolean
): DimensionStats {
  const entries = Array.from(buckets.entries())
    .map(([key, b]): StatEntry => ({
      key,
      name: b.name,
      count: b.animeIds.size,
      pct: total > 0 ? Math.round((b.animeIds.size / total) * 1000) / 10 : 0,
      id: b.id,
      image: b.image,
      detail: withDetail ? topNote(b.notes) : undefined,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { dimension, entries: entries.slice(0, TOP_N), distinct: entries.length, covered };
}

export interface ComputeStatsOptions {
  /** Effective statuses to keep. Empty = every statused title. */
  statuses?: string[];
}

/**
 * Compute all six repartitions in a single pass over the scoped titles.
 *
 * `castById` is the cast slice (canonical id → entry); a missing entry simply
 * means the sweep hasn't reached that title, which shows up as reduced
 * `coverage` on the seiyuu/producers dimensions rather than as an error.
 */
export function computeStats(
  catalog: AnimeRecord[],
  castById: Record<string, AniListCastEntry>,
  options: ComputeStatsOptions = {}
): StatsResult {
  const wanted = new Set(options.statuses ?? []);

  const statused = catalog.filter(a => !!getEffectiveStatus(a));
  const scoped = wanted.size > 0
    ? statused.filter(a => wanted.has(getEffectiveStatus(a) as string))
    : statused;

  const buckets: Record<StatsDimension, Map<string, Bucket>> = {
    studios: new Map(), seiyuu: new Map(), staff: new Map(),
    producers: new Map(), tags: new Map(), genres: new Map(),
  };
  const covered: Record<StatsDimension, number> = {
    studios: 0, seiyuu: 0, staff: 0, producers: 0, tags: 0, genres: 0,
  };

  for (const anime of scoped) {
    const animeId = anime.id;

    // ── Free off the joined record ──
    const studios = anime.catalog.studios || [];
    if (studios.length > 0) covered.studios++;
    for (const s of studios) {
      bump(buckets.studios, `s:${s.id || s.name}`, animeId, { name: s.name, id: s.id || undefined });
    }

    const genres = anime.catalog.genres || [];
    if (genres.length > 0) covered.genres++;
    for (const g of genres) {
      bump(buckets.genres, `g:${g.name.toLowerCase()}`, animeId, { name: g.name });
    }

    const tags = anime.sources.anilist?.tags || [];
    if (tags.length > 0) covered.tags++;
    for (const t of tags) {
      bump(buckets.tags, `t:${t.name.toLowerCase()}`, animeId, { name: t.name });
    }

    const staff = anime.sources.anilist?.staff || [];
    if (staff.length > 0) covered.staff++;
    for (const person of staff) {
      bump(buckets.staff, `p:${person.id}`, animeId, {
        name: person.name, id: person.id, note: person.role || undefined,
      });
    }

    // ── Only present where the cast sweep has been ──
    const cast = castById[animeId];
    if (!cast) continue;

    const characters = cast.characters || [];
    let hasSeiyuu = false;
    for (const character of characters) {
      for (const va of character.voiceActors || []) {
        hasSeiyuu = true;
        bump(buckets.seiyuu, `v:${va.id}`, animeId, {
          name: va.name, id: va.id, image: va.image, note: character.name || undefined,
        });
      }
    }
    if (hasSeiyuu) covered.seiyuu++;

    const producers = (cast.studios || []).filter(s => !s.isMain);
    if (producers.length > 0) covered.producers++;
    for (const p of producers) {
      bump(buckets.producers, `r:${p.id}`, animeId, { name: p.name, id: p.id });
    }
  }

  const total = scoped.length;
  return {
    total,
    totalStatused: statused.length,
    dimensions: {
      studios: finalize('studios', buckets.studios, total, covered.studios, false),
      // Seiyuu `detail` is the most-voiced character; staff's is the usual role.
      seiyuu: finalize('seiyuu', buckets.seiyuu, total, covered.seiyuu, true),
      staff: finalize('staff', buckets.staff, total, covered.staff, true),
      producers: finalize('producers', buckets.producers, total, covered.producers, false),
      tags: finalize('tags', buckets.tags, total, covered.tags, false),
      genres: finalize('genres', buckets.genres, total, covered.genres, false),
    },
  };
}
