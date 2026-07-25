import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import { genreAxis, type GenreAxis } from '@/lib/domain/genreAxis';
import type { AnimeRecord } from '@/models/anime';

/**
 * The genre vocabulary actually present in the store, split by axis and counted.
 *
 * Server-side for the same reason `/quick-rate` and `/stats` are: answering it
 * means walking ~25k records, and the answer is a few kilobytes. The sidebar
 * needs the real vocabulary rather than a hardcoded list — `genreAxis` knows
 * which names are genres and demographics, but only the store knows which of
 * them any title actually carries, and `theme` is open-ended by construction.
 *
 * Counts ride along so the UI can order by frequency: alphabetical would bury
 * Action under Anthropomorphic, and the long tail of a 78-value vocabulary is
 * exactly what a filter list should push down.
 */

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
 * this walks the catalog once per data change rather than once per page load.
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

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const rows = getAnimeForDisplay();
    let vocabulary = cache.get(rows);
    if (!vocabulary) {
      vocabulary = buildVocabulary(rows);
      cache.set(rows, vocabulary);
    }
    return res.json(vocabulary);
  } catch (error) {
    console.error('Genre vocabulary error:', error);
    return res.status(500).json({
      error: 'Failed to build genre vocabulary',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
