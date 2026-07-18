/**
 * GET /api/anime/quick-rate — franchise-grouped, lean rating rows (docs/quickRate/).
 *
 * Why its own endpoint rather than `/api/anime/animes?limit=all`: this page's
 * scope is the **whole catalog**, unstatused titles included (that's the one hard
 * difference from the tier board, which fetches ~500 statused rows and filters
 * in the browser). Shipping ~25k full `AnimeRecord`s would be tens of megabytes,
 * so both the grouping AND a lean projection happen here, server-side. The
 * consequence the page has to live with: filtering refetches instead of being
 * client-side.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import {
  applyNarrowingFilters,
  getEffectiveScore,
  getEffectiveStatus,
  getPrimaryTitle,
} from '@/lib/animeUtils';
import { groupIntoFranchises } from '@/lib/franchise';
import type { AnimeRecord } from '@/models/anime';

// Grouping is O(catalog) and the catalog is ~25k rows, so cache the component
// index on the identity of the row-cache array — `getAnimeForDisplay()` returns
// the same array until a slice file's mtime actually changes, so this rebuilds
// exactly when the data does (same trick the row cache itself uses).
let indexedCatalog: AnimeRecord[] | null = null;
let franchiseOf: Map<string, AnimeRecord[]> = new Map();

function getFranchiseIndex(catalog: AnimeRecord[]): Map<string, AnimeRecord[]> {
  if (indexedCatalog === catalog) return franchiseOf;
  const next = new Map<string, AnimeRecord[]>();
  for (const group of groupIntoFranchises(catalog)) {
    for (const member of group) next.set(member.id, group);
  }
  indexedCatalog = catalog;
  franchiseOf = next;
  return next;
}

/** Everything a quick-rate card needs, and nothing else. */
export interface QuickRateMember {
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

export interface QuickRateGroup {
  /** The group's key + display name: its earliest (or best-known) member. */
  id: string;
  title: string;
  members: QuickRateMember[];
}

export interface QuickRateResponse {
  groups: QuickRateGroup[];
  /** Groups matched before the cap — the page shows "narrow to see more". */
  total: number;
  capped: boolean;
}

/** Hard cap: the page renders every member of every group returned. */
const GROUP_LIMIT = 60;

const toMember = (a: AnimeRecord): QuickRateMember => ({
  id: a.id,
  title: getPrimaryTitle(a),
  picture: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
  numEpisodes: a.catalog.numEpisodes,
  mean: a.catalog.mean,
  year: a.catalog.startSeason?.year,
  mediaType: a.catalog.mediaType,
  status: getEffectiveStatus(a),
  score: getEffectiveScore(a),
});

/** Airing order within a franchise: earliest first, undated last. */
const byAirDate = (a: AnimeRecord, b: AnimeRecord): number => {
  const ta = a.catalog.startDate ? new Date(a.catalog.startDate).getTime() : Number.MAX_SAFE_INTEGER;
  const tb = b.catalog.startDate ? new Date(b.catalog.startDate).getTime() : Number.MAX_SAFE_INTEGER;
  if (ta !== tb) return ta - tb;
  return getPrimaryTitle(a).localeCompare(getPrimaryTitle(b));
};

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
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { search, mediaType, minScore, maxScore, minYear, maxYear, genres, status } = req.query;
    // Indexed on the row-cache array itself (see getFranchiseIndex), so hidden
    // titles are dropped at seed/member level rather than by copying the array.
    const catalog = getAnimeForDisplay();
    const index = getFranchiseIndex(catalog);

    // ---- Seeds: the narrowing filters select which titles you're rating. ----
    let seeds = applyNarrowingFilters(catalog.filter(a => !a.hidden), {
      search: typeof search === 'string' ? search : undefined,
      mediaTypes: csv(mediaType).length > 0 ? csv(mediaType) : undefined,
      minScore: num(minScore),
      maxScore: num(maxScore),
      minYear: num(minYear),
      maxYear: num(maxYear),
      genres: csv(genres).length > 0 ? csv(genres) : undefined,
    });

    // Personal-status filter, OR semantics, `not_defined` = unstatused. Unlike
    // the tier board this deliberately reaches unstatused titles, so no default.
    const statuses = csv(status);
    if (statuses.length > 0) {
      seeds = seeds.filter(a => {
        const s = getEffectiveStatus(a);
        return s ? statuses.includes(s) : statuses.includes('not_defined');
      });
    }

    // ---- Expand each seed to its whole franchise. -------------------------
    // Grouping runs over the UNFILTERED catalog on purpose: the unseen seasons
    // are exactly what a filter would have dropped, and they're the point.
    const groups: AnimeRecord[][] = [];
    const emitted = new Set<AnimeRecord[]>();
    for (const seed of seeds) {
      const group = index.get(seed.id);
      if (!group || emitted.has(group)) continue;
      emitted.add(group);
      const visible = group.filter(m => !m.hidden);
      if (visible.length > 0) groups.push(visible);
    }

    // Best-known franchises first, so an unfiltered visit is still usable.
    const groupMean = (g: AnimeRecord[]) => Math.max(...g.map(m => m.catalog.mean ?? 0));
    groups.sort((a, b) => groupMean(b) - groupMean(a));

    const capped = groups.length > GROUP_LIMIT;
    const page = groups.slice(0, GROUP_LIMIT).map<QuickRateGroup>(members => {
      const ordered = [...members].sort(byAirDate);
      return {
        id: ordered[0].id,
        title: getPrimaryTitle(ordered[0]),
        members: ordered.map(toMember),
      };
    });

    const response: QuickRateResponse = { groups: page, total: groups.length, capped };
    res.json(response);
  } catch (error) {
    console.error('Quick-rate list error:', error);
    res.status(500).json({
      error: 'Failed to build quick-rate list',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
