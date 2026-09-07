import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeForDisplay } from '@/lib/store';
import { getTitleLanguage } from '@/lib/config/settings';
import { applyNarrowingFilters, getStatusFilterKey, getEffectiveScore, sortAnimeRecords } from '@/lib/domain/animeUtils';
import { buildAffinityIndex, buildAnticipationIndex, type AffinityIndex } from '@/lib/reco/affinity';
import { getFeedback, feedbackIds } from '@/lib/reco/feedback';
import { AnimeRecord, AnticipationMark, SortColumn, SortDirection, AnimeListResponse, AnimeListRow } from '@/models/anime';

/**
 * The « Recommandé » marks, memoized on the row array's IDENTITY — the WeakMap
 * trick `byCredits`, `api/anime/genres` and `getFranchiseIndex` all use. The row
 * array is replaced whenever a slice's mtime moves, so this self-invalidates
 * with the store and never needs a TTL.
 *
 * It has to be computed over the whole catalog rather than over the page: the
 * tier cuts are percentiles of the entire scoreable unseen population, which a
 * 200-row slice cannot see. Measured at ~230 ms for 25.6k records, once per
 * store change; every request after that is a Map lookup.
 */
const affinityCache = new WeakMap<AnimeRecord[], {
  affinity: AffinityIndex;
  anticipation: Map<string, AnticipationMark>;
}>();

function getMarks(all: AnimeRecord[]) {
  const hit = affinityCache.get(all);
  if (hit) return hit;
  const built = {
    affinity: buildAffinityIndex(all, { downIds: feedbackIds(getFeedback(), 'down') }),
    anticipation: buildAnticipationIndex(all),
  };
  affinityCache.set(all, built);
  return built;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // Get query parameters
    const { 
      search, 
      genres, 
      status, 
      minScore,
      maxScore,
      season,
      mediaType,
      hidden,
      discrepancies,
      unrated,
      sortBy = 'mean',
      sortDir = 'desc',
      limit,
      offset,
      full
    } = req.query;

    // Start from full dataset
    const allRecords = getAnimeForDisplay();
    let animeList: AnimeRecord[] = allRecords;
    const marks = getMarks(allRecords);

    // Pagination settings
    let pageLimit: number | 'all' = 200;
    if (typeof limit === 'string') {
      if (limit === 'all') pageLimit = 'all';
      else {
        const parsed = parseInt(limit, 10);
        if (!isNaN(parsed) && parsed > 0) pageLimit = Math.min(parsed, 1000); // safety cap
      }
    }
    let pageOffset = 0;
    if (typeof offset === 'string') {
      const parsedOffset = parseInt(offset, 10);
      if (!isNaN(parsedOffset) && parsedOffset >= 0) pageOffset = parsedOffset;
    }

    // Apply season filter (CSV tokens: YYYY-season)
    if (season && typeof season === 'string') {
      const tokens = season.split(',').map(s => s.trim()).filter(Boolean);
      if (tokens.length > 0) {
        const seasonMap: Record<string, 'winter'|'spring'|'summer'|'fall'> = {
          winter: 'winter', spring: 'spring', summer: 'summer', fall: 'fall', autumn: 'fall'
        };
        const parsed: Array<{ year: number; season: 'winter'|'spring'|'summer'|'fall' }> = [];
        for (const t of tokens) {
          const [y, s] = t.split('-');
          const year = Number(y);
          const norm = seasonMap[(s || '').toLowerCase()];
          if (!year || !Number.isInteger(year) || year < 1900 || year > 3000 || !norm) {
            return res.status(400).json({ error: `Invalid season token: '${t}'. Expected 'YYYY-season' (e.g., 2025-spring).` });
          }
          parsed.push({ year, season: norm });
        }
        // Deduplicate
        const seen = new Set(parsed.map(p => `${p.year}-${p.season}`));
        const seasonFilters = Array.from(seen).map(k => {
          const [yy, ss] = k.split('-');
          return { year: Number(yy), season: ss as 'winter'|'spring'|'summer'|'fall' };
        });
        animeList = animeList.filter(anime => {
          if (!anime.catalog.startSeason) return false;
          return seasonFilters.some(s =>
            anime.catalog.startSeason!.year === s.year &&
            anime.catalog.startSeason!.season === s.season
          );
        });
      }
    }

    // Media type + search + score range are shared with the recommendations feed.
    animeList = applyNarrowingFilters(animeList, {
      mediaTypes: typeof mediaType === 'string' && mediaType.trim() !== ''
        ? mediaType.split(',').map(t => t.trim()).filter(Boolean)
        : undefined,
      search: typeof search === 'string' ? search : undefined,
      minScore: typeof minScore === 'string' ? parseFloat(minScore) : null,
      maxScore: typeof maxScore === 'string' ? parseFloat(maxScore) : null,
    });

    // Apply hidden filter (NEW)
    if (hidden !== undefined && typeof hidden === 'string') {
      const showHidden = hidden.toLowerCase() === 'true';
      animeList = animeList.filter(anime => {
        const isHidden = anime.hidden === true;
        return showHidden ? isHidden : !isHidden;
      });
    }

    // Apply unrated filter (in list but score is 0 / never scored) — effective
    // (SIMKL-first) personal score, matching the effective-status filter below.
    if (unrated !== undefined && typeof unrated === 'string' && unrated.toLowerCase() === 'true') {
      animeList = animeList.filter(anime => getEffectiveScore(anime) == null);
    }

    // Apply discrepancies-only filter (MAL vs SIMKL mismatch present)
    if (discrepancies !== undefined && typeof discrepancies === 'string' && discrepancies.toLowerCase() === 'true') {
      animeList = animeList.filter(anime => anime.discrepancy != null);
    }

    // Apply genre filter
    if (genres && typeof genres === 'string') {
      const genreList = genres.split(',').map(g => g.trim().toLowerCase());
      animeList = animeList.filter(anime =>
        (anime.catalog.genres || []).some(genre => genreList.includes((genre.name || '').toLowerCase()))
      );
    }

    // Apply status filter. `getStatusFilterKey` — not `getEffectiveStatus` —
    // because a rating intent REPLACES the status here: a title marked
    // « À revoir » answers to that chip and no longer to « Terminé », which is
    // what keeps this a partition and what empties the `to_rate` preset of
    // titles the owner has already decided not to score.
    if (status && typeof status === 'string') {
      const statusList = status.split(',').map(s => s.trim());
      animeList = animeList.filter(anime => {
        const key = getStatusFilterKey(anime);
        if (!key) {
          return statusList.includes('not_defined');
        }
        return statusList.includes(key);
      });
    }

    // Apply sorting. The helper copies first — when no filter ran above,
    // `animeList` is still the shared long-lived cache array from
    // getAnimeForDisplay(), and sorting it in place would mutate every other
    // reader's view of the store.
    const sortColumn = sortBy as SortColumn;
    const sortDirection = sortDir as SortDirection;

    if (sortColumn === 'affinity') {
      // Not a `sortAnimeRecords` case: the affinity score is a per-request
      // sibling of the record, not a catalog field, and threading the index
      // into the shared sorter would give every other caller a parameter it has
      // no value for. Unscored rows sort last whatever the direction, matching
      // the `numOrNull` rule there.
      const dir = sortDirection === 'asc' ? 1 : -1;
      animeList = [...animeList].sort((a, b) => {
        const av = marks.affinity.scores.get(a.id);
        const bv = marks.affinity.scores.get(b.id);
        if (av === undefined || bv === undefined) {
          if (av === bv) return 0;
          return av === undefined ? 1 : -1;
        }
        return av < bv ? -dir : av > bv ? dir : 0;
      });
    } else {
      animeList = sortAnimeRecords(animeList, sortColumn, sortDirection, getTitleLanguage());
    }

    // Pagination already defaulted to 200; no view-specific overrides

    const totalBeforePaging = animeList.length;
    if (pageLimit !== 'all') {
      animeList = animeList.slice(pageOffset, pageOffset + pageLimit);
    } else if (pageOffset > 0) {
      animeList = animeList.slice(pageOffset);
    }

    // Compact mode: `full=true` vs the default were meant to trim heavy fields,
    // but the pre-Phase-C strip targeted raw top-level MAL fields
    // (synopsis/studios/etc); those moved under `.catalog` in Phase C and this
    // branch was never updated to match, so compact mode has been a no-op ever
    // since. De-bloating the payload properly is still open.
    const useFull = typeof full === 'string' && full.toLowerCase() === 'true';

    // Attach the marks to the PAGE only, on copies — `animeList` may still be
    // the shared row-cache array, and writing to a row would leak into every
    // other reader of the store (the `jsonStore` shared-reference contract).
    const rows: AnimeListRow[] = animeList.map(anime => {
      const affinity = marks.affinity.marks.get(anime.id);
      const anticipation = marks.anticipation.get(anime.id);
      if (!affinity && !anticipation) return anime;
      return { ...anime, ...(affinity ? { affinity } : {}), ...(anticipation ? { anticipation } : {}) };
    });

    // Return the filtered and sorted (and limited) list
    const response: AnimeListResponse = {
      animes: rows,
      total: totalBeforePaging,
      filters: {
        search: (typeof search === 'string' ? search : null),
        season: (typeof season === 'string' ? season : null),
        mediaType: (typeof mediaType === 'string' ? mediaType : null),
        hidden: (typeof hidden === 'string' ? hidden : null),
        discrepancies: (typeof discrepancies === 'string' ? discrepancies : null),
        unrated: (typeof unrated === 'string' ? unrated : null),
        genres: (typeof genres === 'string' ? genres : null),
        status: (typeof status === 'string' ? status : null),
        minScore: (typeof minScore === 'string' ? minScore : null),
        maxScore: (typeof maxScore === 'string' ? maxScore : null)
      },
      sort: { column: sortColumn, direction: sortDirection },
      page: { limit: pageLimit, offset: pageOffset, count: animeList.length },
      mode: useFull ? 'full' : 'compact',
      affinity: {
        scoreable: marks.affinity.coverage.scoreable,
        unseen: marks.affinity.coverage.unseen,
        seedCount: marks.affinity.seedCount,
      }
    };
    res.json(response);

  } catch (error) {
    console.error('Get anime list error:', error);
    res.status(500).json({ 
      error: 'Failed to get anime list',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
