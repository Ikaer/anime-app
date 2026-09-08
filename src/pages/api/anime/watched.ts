import type { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import { applyNarrowingFilters, getEffectiveStatus, getEffectiveScore } from '@/lib/domain/animeUtils';
import { getTitleLanguage } from '@/lib/config/settings';
import { toLeanRow, byAirDate, type LeanAnimeRow } from '@/lib/domain/leanRow';

/**
 * GET /api/anime/watched — the STATUSED list, flat, filterable, unpaginated.
 *
 * The quick-edit source query: everything you could put in a box, because you
 * can only box what you have seen.
 *
 * **It used to be `watched-groups`, and the grouping is what the swap removed**
 * (§2/§9). That route collapsed the list into ~467 provider franchise components
 * to feed `/boxes`' chip grid — an O(titles × boxes) question the coverage said
 * nobody answers 473 times (108 of 720 watched titles filed anywhere, 13 of 26
 * boxes empty). The v2 source pane groups by « Mes regroupements » instead — the
 * owner's OWN statements about what is one thing — so the provider's components
 * are the wrong axis here, and the pane needs the flat list to lay them over.
 * Renamed rather than left as `watched-groups` returning no groups, which would
 * have been a name that lies.
 *
 * ⚠️ **Unpaginated on purpose.** The pane filters the whole set in the browser,
 * so changing a media type or a year never refetches and the panes never blink.
 * ~700 lean rows is a small payload; the old 24-groups-per-page shape existed
 * for a grid that rendered a chip row per group.
 *
 * ⚠️ **`search` is the one filter that must stay server-side.**
 * `applyNarrowingFilters` matches romaji + English + Japanese + synonyms, while
 * a `LeanAnimeRow` carries only the title currently displayed — so a client-side
 * title match would quietly stop a `native` reader finding a show by the name on
 * their own screen. That is the invariant the title-language section of
 * CLAUDE.md spells out, and this is exactly the trap it describes.
 *
 * Distinct from `/api/anime/quick-rate`, which looks similar and is not: that
 * one scopes the whole ~25k catalog (rating an unseen sequel is the point there)
 * and expands filter-matched SEEDS to their franchises. Here the filters
 * describe the titles themselves.
 *
 * It does NOT subtract a box's members or its « écartés »: the pane knows both
 * sets already, and doing it here would make the response box-specific and
 * refetch on every single file.
 */

export interface WatchedResponse {
  rows: LeanAnimeRow[];
  total: number;
}

const csv = (v: unknown): string[] =>
  typeof v === 'string' && v.trim() !== '' ? v.split(',').map(s => s.trim()).filter(Boolean) : [];

const num = (v: unknown): number | null => {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { search, mediaType, minScore, maxScore, minYear, maxYear, genres, status } = req.query;
    const titleLang = getTitleLanguage();
    const all = getAnimeForDisplay();

    let rows = applyNarrowingFilters(all.filter(a => !a.hidden && !!getEffectiveStatus(a)), {
      search: typeof search === 'string' ? search : undefined,
      mediaTypes: csv(mediaType).length > 0 ? csv(mediaType).map(s => s.toLowerCase()) : undefined,
      minScore: num(minScore),
      maxScore: num(maxScore),
      minYear: num(minYear),
      maxYear: num(maxYear),
      genres: csv(genres).length > 0 ? csv(genres) : undefined,
    });

    const statuses = csv(status);
    if (statuses.length > 0) {
      rows = rows.filter(a => {
        const s = getEffectiveStatus(a);
        return !!s && statuses.includes(s);
      });
    }

    // Best-scored first, air order inside a tie: the titles you have opinions
    // about are the ones you can file without hesitating, so they belong at the
    // top of a ~700-row pane.
    const airOrder = byAirDate(titleLang);
    const lean = [...rows]
      .sort((a, b) => (getEffectiveScore(b) || 0) - (getEffectiveScore(a) || 0) || airOrder(a, b))
      .map(a => toLeanRow(a, titleLang));

    return res.status(200).json({ rows: lean, total: lean.length } satisfies WatchedResponse);
  } catch (error) {
    console.error('Error building the watched list:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
