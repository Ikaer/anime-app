import { NextApiRequest, NextApiResponse } from 'next';
import { getAnimeWithExtensions } from '@/lib/anime';
import { AnimeWithExtensions, SortColumn, SortDirection, AnimeListResponse } from '@/models/anime';

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
      sortBy = 'mean', 
      sortDir = 'desc',
      limit,
      offset,
      full
    } = req.query;

    // Start from full dataset
    let animeList = getAnimeWithExtensions();

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
          if (!anime.start_season) return false;
          return seasonFilters.some(s =>
            anime.start_season!.year === s.year &&
            anime.start_season!.season === s.season
          );
        });
      }
    }

    // Apply media type filter (NEW)
    if (mediaType && typeof mediaType === 'string') {
      const typeList = mediaType.split(',').map(t => t.trim().toLowerCase());
      animeList = animeList.filter(anime =>
        typeList.includes((anime.media_type || '').toLowerCase())
      );
    }


    // Apply hidden filter (NEW)
    if (hidden !== undefined && typeof hidden === 'string') {
      const showHidden = hidden.toLowerCase() === 'true';
      animeList = animeList.filter(anime => {
        const isHidden = anime.hidden === true;
        return showHidden ? isHidden : !isHidden;
      });
    }

    // Apply search filter
    if (search && typeof search === 'string') {
      const searchTerm = search.toLowerCase();
      animeList = animeList.filter(anime => 
        (anime.title || '').toLowerCase().includes(searchTerm) ||
        (anime.alternative_titles?.en || '').toLowerCase().includes(searchTerm)
        // Synopsis search commented out - too noisy without relevance ranking
        // || (anime.synopsis || '').toLowerCase().includes(searchTerm)
      );
    }

    // Apply genre filter
    if (genres && typeof genres === 'string') {
      const genreList = genres.split(',').map(g => g.trim().toLowerCase());
      animeList = animeList.filter(anime =>
        (anime.genres || []).some(genre => genreList.includes((genre.name || '').toLowerCase()))
      );
    }

    // Apply status filter
    if (status && typeof status === 'string') {
      const statusList = status.split(',').map(s => s.trim());
      animeList = animeList.filter(anime => {
        const userStatus = anime.my_list_status?.status;
        if (!userStatus) {
          return statusList.includes('not_defined');
        }
        return statusList.includes(userStatus);
      });
    }

    // Apply minimum score filter
    if (minScore && typeof minScore === 'string') {
      const minScoreNum = parseFloat(minScore);
      if (!isNaN(minScoreNum)) {
        animeList = animeList.filter(anime =>
          anime.mean && anime.mean >= minScoreNum
        );
      }
    }

    // Apply maximum score filter (NEW)
    if (maxScore && typeof maxScore === 'string') {
      const maxScoreNum = parseFloat(maxScore);
      if (!isNaN(maxScoreNum)) {
        animeList = animeList.filter(anime =>
          anime.mean && anime.mean <= maxScoreNum
        );
      }
    }

    // Apply sorting
    const sortColumn = sortBy as SortColumn;
    const sortDirection = sortDir as SortDirection;
    
    animeList.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortColumn) {
        case 'title':
          aValue = a.title.toLowerCase();
          bValue = b.title.toLowerCase();
          break;
        case 'mean':
          aValue = a.mean || 0;
          bValue = b.mean || 0;
          break;
        case 'start_date':
          aValue = a.start_date ? new Date(a.start_date).getTime() : 0;
          bValue = b.start_date ? new Date(b.start_date).getTime() : 0;
          break;
        case 'status':
          aValue = a.status || '';
          bValue = b.status || '';
          break;
        case 'num_episodes':
          aValue = a.num_episodes || 0;
          bValue = b.num_episodes || 0;
          break;
        default:
          aValue = a.mean || 0;
          bValue = b.mean || 0;
      }

      if (aValue < bValue) {
        return sortDirection === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortDirection === 'asc' ? 1 : -1;
      }
      return 0;
    });

    // Pagination already defaulted to 200; no view-specific overrides

    const totalBeforePaging = animeList.length;
    if (pageLimit !== 'all') {
      animeList = animeList.slice(pageOffset, pageOffset + pageLimit);
    } else if (pageOffset > 0) {
      animeList = animeList.slice(pageOffset);
    }

    // Compact mode: remove heavy fields unless full=true
    const useFull = typeof full === 'string' && full.toLowerCase() === 'true';
    if (!useFull) {
      animeList = animeList.map(anime => {
        // Keep genres and alternative_titles (english alt title needed for listing)
        const { synopsis, studios, source, rating, background, related_anime, related_manga, recommendations, ...rest } = anime as any;
        return rest as AnimeWithExtensions;
      });
    }

    // Return the filtered and sorted (and limited) list
    const response: AnimeListResponse = {
      animes: animeList,
      total: totalBeforePaging,
      filters: {
        search: (typeof search === 'string' ? search : null),
        season: (typeof season === 'string' ? season : null),
        mediaType: (typeof mediaType === 'string' ? mediaType : null),
        hidden: (typeof hidden === 'string' ? hidden : null),
        genres: (typeof genres === 'string' ? genres : null),
        status: (typeof status === 'string' ? status : null),
        minScore: (typeof minScore === 'string' ? minScore : null),
        maxScore: (typeof maxScore === 'string' ? maxScore : null)
      },
      sort: { column: sortColumn, direction: sortDirection },
      page: { limit: pageLimit, offset: pageOffset, count: animeList.length },
      mode: useFull ? 'full' : 'compact'
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
