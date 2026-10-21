import { NextApiRequest, NextApiResponse } from 'next';
import { getAllAnilistCast, getAllAnilistSeiyuu, getAnimeForDisplay } from '@/lib/store';
import { searchCatalog, MIN_QUERY_LENGTH, type GlobalSearchResults } from '@/lib/domain/globalSearch';
import { getTitleLanguage } from '@/lib/config/settings';

/**
 * Header global search. Catalog-only (title/studio/staff/seiyuu), so the shared
 * cached `getAnimeForDisplay()` is fine — no personal-state cache caveat (see
 * credits page). The seiyuu come from the cast and filmography slices, read here
 * because neither is on the record.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { q } = req.query;
    const query = typeof q === 'string' ? q : '';

    const empty: GlobalSearchResults = { animes: [], studios: [], staff: [], seiyuu: [] };
    if (query.trim().length < MIN_QUERY_LENGTH) {
      return res.json(empty);
    }

    const results = searchCatalog(query, getAnimeForDisplay(), getTitleLanguage(), {
      cast: getAllAnilistCast(),
      filmographies: getAllAnilistSeiyuu(),
    });
    res.json(results);
  } catch (error) {
    console.error('Global search error:', error);
    res.status(500).json({
      error: 'Failed to search',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
