/**
 * GET /api/anime/catch-up — the entries you never touched, in franchises you
 * actually finished something of.
 *
 * The question is "what am I missing", so a franchise qualifies only when it
 * holds BOTH an entry you completed (the anchor — the evidence you like this
 * thing) and an entry with no personal status at all (the hole). Every other
 * personal status is deliberately neither: `watching`/`on_hold`/`dropped` are
 * decisions in progress, and `plan_to_watch` is a hole you have already logged
 * — listing them would turn this into a second view of the personal list rather
 * than a view of what is absent from it.
 *
 * Same server-side posture as `/api/anime/quick-rate`, and for the same reason:
 * the scope is the whole ~25k catalog (the holes are unstatused titles, which no
 * personal-list fetch would return), so grouping AND a lean projection happen
 * here and filtering refetches.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import {
  applyNarrowingFilters,
  getEffectiveScore,
  getEffectiveStatus,
  getPrimaryTitle,
} from '@/lib/domain/animeUtils';
import { getFranchiseIndex } from '@/lib/domain/franchise';
import type { AnimeRecord } from '@/models/anime';

/** Everything a catch-up row needs, and nothing else. */
export interface CatchUpEntry {
  id: string;
  title: string;
  picture?: string;
  numEpisodes?: number;
  mean?: number;
  year?: number;
  mediaType?: string;
  /** Airing status: 'finished_airing' | 'currently_airing' | 'not_yet_aired'. */
  airing?: string;
  /** Effective personal status. Always undefined on a `missing` entry. */
  status?: string;
  score?: number;
}

export interface CatchUpGroup {
  /** The group's key + display name: its earliest member. */
  id: string;
  title: string;
  /** Your best score across the completed entries; undefined if you rated none. */
  score?: number;
  /** Statused members, airing order — the context that explains why you're here. */
  seen: CatchUpEntry[];
  /** Untouched members, airing order — the point of the page. */
  missing: CatchUpEntry[];
  /** Holes dropped by the unaired toggle. Reported so "rien" never lies. */
  unairedHidden: number;
}

export interface CatchUpResponse {
  groups: CatchUpGroup[];
  /** Franchises matched across every page. */
  total: number;
  /** Missing entries across every matched franchise (not just this page). */
  totalMissing: number;
  /** 0-based. */
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Franchises per page. A page renders every entry of every group it receives. */
const PAGE_SIZE = 20;

/**
 * Never a hole, whatever the filters say: a promotional video or a TV commercial
 * is not something you catch up on. Measured on the live store it is 9 rows of
 * 668, so this is about not making the page look like noise rather than about
 * volume — and it can't be expressed as a filter, since `RecoFiltersSection`'s
 * media-type list doesn't offer `pv`/`cm` at all.
 */
const NEVER_A_HOLE = new Set(['pv', 'cm']);

const csv = (v: unknown): string[] =>
  typeof v === 'string' && v.trim() !== '' ? v.split(',').map(s => s.trim()).filter(Boolean) : [];

const num = (v: unknown): number | null => {
  if (typeof v !== 'string' || v.trim() === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const toEntry = (a: AnimeRecord): CatchUpEntry => ({
  id: a.id,
  title: getPrimaryTitle(a),
  picture: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large,
  numEpisodes: a.catalog.numEpisodes,
  mean: a.catalog.mean,
  year: a.catalog.startSeason?.year,
  mediaType: a.catalog.mediaType,
  airing: a.catalog.airingStatus,
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

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { search, mediaType, minScore, maxScore, minYear, maxYear, genres, unaired, page } =
      req.query;
    const includeUnaired = unaired === '1';

    const catalog = getAnimeForDisplay();
    const index = getFranchiseIndex(catalog);

    // ---- Anchors: a completed entry is what puts a franchise in scope. ------
    // Walking the statused titles rather than the whole catalog keeps this to
    // ~600 iterations; the index then expands each to its component exactly
    // once (components are shared objects, so identity dedupes them).
    const components = new Set<AnimeRecord[]>();
    for (const a of catalog) {
      if (a.hidden || getEffectiveStatus(a) !== 'completed') continue;
      const group = index.get(a.id);
      if (group) components.add(group);
    }

    // The narrowing filters describe the HOLE, not the franchise: "only movies
    // I'm missing", "only ones MAL rates 7+". Search is the one exception — you
    // type a franchise name, so it matches any member (`seen` included) and
    // keeps the whole group.
    const term = typeof search === 'string' ? search.trim().toLowerCase() : '';
    const holeFilters = {
      mediaTypes: csv(mediaType).length > 0 ? csv(mediaType).map(s => s.toLowerCase()) : undefined,
      minScore: num(minScore),
      maxScore: num(maxScore),
      minYear: num(minYear),
      maxYear: num(maxYear),
      genres: csv(genres).length > 0 ? csv(genres) : undefined,
    };

    interface Built { group: CatchUpGroup; sortScore: number; sortMean: number }
    const built: Built[] = [];

    for (const members of components) {
      const visible = members.filter(m => !m.hidden);

      if (term) {
        const hit = visible.some(
          m =>
            (m.catalog.title || '').toLowerCase().includes(term) ||
            (m.catalog.alternativeTitles?.en || '').toLowerCase().includes(term)
        );
        if (!hit) continue;
      }

      const seen: AnimeRecord[] = [];
      let holes: AnimeRecord[] = [];
      for (const m of visible) {
        if (getEffectiveStatus(m)) seen.push(m);
        else if (!NEVER_A_HOLE.has((m.catalog.mediaType || '').toLowerCase())) holes.push(m);
      }

      holes = applyNarrowingFilters(holes, holeFilters);

      // Announced-but-unaired entries are a different answer to a different
      // question ("what's coming" vs "what can I watch tonight"), so they are
      // counted out rather than filtered silently.
      let unairedHidden = 0;
      if (!includeUnaired) {
        const airable = holes.filter(m => m.catalog.airingStatus !== 'not_yet_aired');
        unairedHidden = holes.length - airable.length;
        holes = airable;
      }
      if (holes.length === 0) continue;

      const completed = [...seen]
        .filter(m => getEffectiveStatus(m) === 'completed')
        .sort(byAirDate);
      const scores = completed.map(m => getEffectiveScore(m)).filter((s): s is number => !!s);
      const sortScore = scores.length > 0 ? Math.max(...scores) : 0;

      // Named after the FIRST entry you completed, not the component's earliest
      // member (which is what /quick-rate uses). Measured on the live store,
      // that is the difference between calling a franchise "Steins;Gate" and
      // calling it "ChäoS;HEAd" — the component is one graph, but you know it by
      // the thing you actually watched, and that is what makes it findable here.
      const namer = completed[0];

      built.push({
        group: {
          id: namer.id,
          title: getPrimaryTitle(namer),
          score: scores.length > 0 ? Math.max(...scores) : undefined,
          seen: [...seen].sort(byAirDate).map(toEntry),
          missing: [...holes].sort(byAirDate).map(toEntry),
          unairedHidden,
        },
        sortScore,
        // Tiebreaker for the (common) franchise whose anchor you never scored.
        sortMean: Math.max(...holes.map(m => m.catalog.mean ?? 0)),
      });
    }

    // Loved-but-unfinished first. The id tiebreaker keeps the order total:
    // pagination slices this array, so ties resolved differently between two
    // requests would shuffle franchises across page boundaries.
    built.sort(
      (a, b) =>
        b.sortScore - a.sortScore ||
        b.sortMean - a.sortMean ||
        a.group.id.localeCompare(b.group.id)
    );

    const totalMissing = built.reduce((n, b) => n + b.group.missing.length, 0);
    const totalPages = Math.max(1, Math.ceil(built.length / PAGE_SIZE));
    // Clamp rather than 404: a filter change that shrinks the result set can
    // leave a stale page number in the URL.
    const pageNum = Math.min(Math.max(Math.floor(num(page) ?? 0), 0), totalPages - 1);

    const response: CatchUpResponse = {
      groups: built.slice(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE).map(b => b.group),
      total: built.length,
      totalMissing,
      page: pageNum,
      pageSize: PAGE_SIZE,
      totalPages,
    };
    res.json(response);
  } catch (error) {
    console.error('Catch-up list error:', error);
    res.status(500).json({
      error: 'Failed to build catch-up list',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
