import type { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import { applyNarrowingFilters, getEffectiveStatus, getEffectiveScore } from '@/lib/domain/animeUtils';
import { getFranchiseIndex } from '@/lib/domain/franchise';
import { getTitleLanguage } from '@/lib/config/settings';
import { toLeanRow, byAirDate, type LeanAnimeRow } from '@/lib/domain/leanRow';
import type { AnimeRecord } from '@/models/anime';

/**
 * GET /api/anime/watched-groups — the STATUSED list, grouped by direct franchise.
 *
 * The bulk-labeling surface behind `/boxes`: 712 statused titles collapse to 467
 * groups, which is the real size of the labeling job.
 *
 * ⚠️ **Scope is `direct` (sequel/prequel), not `franchise`** — measured on the
 * live store, the wider scope chains Gundam SEED, 00, Iron-Blooded Orphans and
 * Witch from Mercury into ONE 129-entry component, so a single chip click would
 * file four unrelated shows into a box. It saves 20 groups out of 467 and costs
 * that. `/catch-up`'s « suites directes » toggle exists for the same reason, and
 * `getFranchiseIndex` already caches one index per scope.
 *
 * Distinct from `/api/anime/quick-rate`, which looks similar and is not: that one
 * scopes the whole ~25k catalog (rating an unseen sequel is the point there) and
 * expands filter-matched SEEDS to their franchises. Here the filters describe the
 * titles themselves, because you can only box what you have watched.
 */

const PAGE_SIZE = 24;

export interface WatchedGroup {
  /** Stable component key — the group's earliest member. */
  id: string;
  title: string;
  members: LeanAnimeRow[];
  /** Best personal score across the group; drives the default ordering. */
  score?: number;
}

export interface WatchedGroupsResponse {
  groups: WatchedGroup[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
    const { search, mediaType, minScore, maxScore, minYear, maxYear, genres, status, page } = req.query;
    const titleLang = getTitleLanguage();
    const all = getAnimeForDisplay();
    const index = getFranchiseIndex(all, 'direct');

    // The watched list, narrowed. Unlike /quick-rate the filters describe the
    // rows themselves rather than selecting seeds to expand — a box holds titles
    // you have seen, so there is nothing to reach outward for.
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

    // Collapse to components. Only the MATCHED rows are shown inside a group —
    // an unwatched sequel is not a box candidate, so pulling the whole component
    // in (as /quick-rate does) would list titles that can't be labeled.
    const grouped = new Map<string, AnimeRecord[]>();
    for (const a of rows) {
      const component = index.get(a.id);
      const key = component ? component[0].id : a.id;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(a);
      else grouped.set(key, [a]);
    }

    const groups: WatchedGroup[] = [...grouped.values()].map(members => {
      const ordered = [...members].sort(byAirDate(titleLang));
      const scores = members.map(getEffectiveScore).filter((s): s is number => typeof s === 'number' && s > 0);
      const lean = ordered.map(a => toLeanRow(a, titleLang));
      return {
        id: ordered[0].id,
        title: lean[0].title,
        members: lean,
        ...(scores.length > 0 ? { score: Math.max(...scores) } : {}),
      };
    });

    // Best-scored first: the titles you have opinions about are the ones worth
    // filing, and they are what you can label without hesitating.
    groups.sort((a, b) => (b.score || 0) - (a.score || 0) || a.title.localeCompare(b.title));

    const total = groups.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const current = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);

    return res.status(200).json({
      groups: groups.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE),
      total,
      page: current,
      pageSize: PAGE_SIZE,
      totalPages,
    } satisfies WatchedGroupsResponse);
  } catch (error) {
    console.error('Error building watched groups:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
