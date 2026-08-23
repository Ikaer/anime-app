/**
 * The genre vocabulary actually present in the store, split by axis and counted.
 *
 * Lifted out of `api/anime/genres.ts` when the MCP surface needed the same
 * answer: a model filtering by genre has to be told which names exist, for the
 * same reason the sidebar does — `genreAxis` knows which names are genres and
 * demographics, but only the store knows which of them any title carries, and
 * `theme` is open-ended by construction.
 *
 * Pure and client-safe (no `fs`): the rows are passed in, same convention as
 * `globalSearch.ts` / `stats.ts`.
 */
import { genreAxis, type GenreAxis } from '@/lib/domain/genreAxis';
import type { AnimeRecord } from '@/models/anime';

export interface GenreFacet {
  name: string;
  count: number;
}

export interface GenreVocabulary {
  axes: Record<GenreAxis, GenreFacet[]>;
  total: number;
}

/**
 * Memoized on the row array's IDENTITY, the same trick `byCredits` uses: the
 * store hands out the same reference until a slice actually changes on disk, so
 * this walks the catalog once per data change rather than once per caller.
 * WeakMap, so a rebuilt catalog drops the old entry.
 */
const cache = new WeakMap<AnimeRecord[], GenreVocabulary>();

function buildVocabulary(rows: AnimeRecord[]): GenreVocabulary {
  const counts = new Map<string, number>();
  for (const anime of rows) {
    // Distinct per title: a genre listed twice on one record must not count
    // twice, same rule `/stats` follows for every dimension.
    for (const name of new Set((anime.catalog.genres || []).map(g => g.name).filter(Boolean))) {
      counts.set(name, (counts.get(name) || 0) + 1);
    }
  }

  const axes: Record<GenreAxis, GenreFacet[]> = { genre: [], demographic: [], theme: [] };
  for (const [name, count] of counts) axes[genreAxis(name)].push({ name, count });
  for (const axis of Object.keys(axes) as GenreAxis[]) {
    axes[axis].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  return { axes, total: counts.size };
}

/** Counts are catalog-wide: they read "how common is this genre", not "how many results". */
export function getGenreVocabulary(rows: AnimeRecord[]): GenreVocabulary {
  let vocabulary = cache.get(rows);
  if (!vocabulary) {
    vocabulary = buildVocabulary(rows);
    cache.set(rows, vocabulary);
  }
  return vocabulary;
}
