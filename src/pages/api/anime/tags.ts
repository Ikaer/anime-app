import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import { getTagVocabulary } from '@/lib/domain/tagVocabulary';

/**
 * GET /api/anime/tags — the AniList tag vocabulary behind the sidebar's tag
 * filter, `api/anime/genres`' twin. Server-side because it walks ~25k records
 * for a few kilobytes of answer; the build and its identity-keyed memo live in
 * `domain/tagVocabulary.ts`, which also owns the rank floor the filter uses.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    return res.json(getTagVocabulary(getAnimeForDisplay()));
  } catch (error) {
    console.error('Tag vocabulary error:', error);
    return res.status(500).json({
      error: 'Failed to build tag vocabulary',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
