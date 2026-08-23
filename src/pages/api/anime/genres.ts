import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import { getGenreVocabulary } from '@/lib/domain/genreVocabulary';

/**
 * GET /api/anime/genres — the genre vocabulary behind the sidebar's filter.
 *
 * Server-side for the same reason `/quick-rate` and `/stats` are: answering it
 * means walking ~25k records, and the answer is a few kilobytes. The build and
 * its identity-keyed memo live in `domain/genreVocabulary.ts`, shared with the
 * MCP `list_genres` tool.
 */
export type { GenreFacet, GenreVocabulary } from '@/lib/domain/genreVocabulary';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    return res.json(getGenreVocabulary(getAnimeForDisplay()));
  } catch (error) {
    console.error('Genre vocabulary error:', error);
    return res.status(500).json({
      error: 'Failed to build genre vocabulary',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
