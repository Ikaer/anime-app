/**
 * MAL sync orchestration: which seasons to fetch, in what order, with what
 * checkpoint. The HTTP calls live in `mal.ts`, the record store in `store.ts`.
 *
 * Two crawls:
 * - `performBigSync` — the recent window (8 years back, 2 forward) plus the
 *   upcoming ranking, streamed to the client over SSE.
 * - `performHistoricalCrawl` — a batch of older seasons per invocation, walking
 *   back to 1960, guarded by a checkpoint and a module-level lock.
 *
 * Server-only.
 */

import { MALAnime } from '@/models/anime';
import { upsertAnime, getSyncMetadata } from '@/lib/store';
import { fetchSeasonalAnime, fetchUpcomingAnime, MalFetchProgress } from '@/lib/providers/mal/client';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { appendLog } from '@/lib/connectionLog';

const SYNC_CHECKPOINT_FILE = dataFile('sync/mal_seasons.json');

/** Courtesy pause between seasons (each season is itself several requests). */
const SEASON_DELAY_MS = 2000;

// ============================================================================
// Historical crawl
// ============================================================================

const HISTORICAL_CRAWL_OLDEST_YEAR = 1960;
const HISTORICAL_CRAWL_BATCH_SIZE = 5;
const HISTORICAL_CRAWL_CONSECUTIVE_EMPTY_STOP = 8;

// Module-level lock to prevent concurrent historical crawl runs
let isHistoricalCrawlRunning = false;

interface SyncCheckpoint {
  syncedSeasons: string[];
}

function getSyncCheckpoint(): SyncCheckpoint {
  return readJsonFile<SyncCheckpoint>(SYNC_CHECKPOINT_FILE, { syncedSeasons: [] });
}

function markSeasonsSynced(seasons: string[]): void {
  const checkpoint = getSyncCheckpoint();
  const set = new Set(checkpoint.syncedSeasons);
  seasons.forEach(s => set.add(s));
  writeJsonFile(SYNC_CHECKPOINT_FILE, { syncedSeasons: Array.from(set) });
}

export interface HistoricalCrawlStats {
  synced: number;
  remaining: number;
  total: number;
  oldestSyncedYear: number | null;
}

export function getHistoricalCrawlStats(): HistoricalCrawlStats {
  const currentYear = new Date().getFullYear();
  const cutoffYear = currentYear - 9; // seasons older than big-sync's 8-year window
  const allSeasons: string[] = [];
  for (let year = cutoffYear; year >= HISTORICAL_CRAWL_OLDEST_YEAR; year--) {
    for (const s of ['fall', 'summer', 'spring', 'winter']) {
      allSeasons.push(`${year}-${s}`);
    }
  }
  const syncedSet = new Set(getSyncCheckpoint().syncedSeasons);
  const synced = allSeasons.filter(s => syncedSet.has(s)).length;
  const remaining = allSeasons.length - synced;
  const syncedYears = allSeasons
    .filter(s => syncedSet.has(s))
    .map(s => parseInt(s.split('-')[0], 10));
  const oldestSyncedYear = syncedYears.length > 0 ? Math.min(...syncedYears) : null;
  return { synced, remaining, total: allSeasons.length, oldestSyncedYear };
}

function getNextHistoricalBatch(batchSize: number): Array<{ year: number; season: string }> {
  const currentYear = new Date().getFullYear();
  const cutoffYear = currentYear - 9;
  const syncedSet = new Set(getSyncCheckpoint().syncedSeasons);
  const batch: Array<{ year: number; season: string }> = [];
  outer: for (let year = cutoffYear; year >= HISTORICAL_CRAWL_OLDEST_YEAR; year--) {
    for (const season of ['fall', 'summer', 'spring', 'winter']) {
      if (!syncedSet.has(`${year}-${season}`)) {
        batch.push({ year, season });
        if (batch.length >= batchSize) break outer;
      }
    }
  }
  return batch;
}

export interface HistoricalCrawlResult {
  success: boolean;
  alreadyRunning: boolean;
  syncedCount: number;
  processedSeasons: number;
  stats: HistoricalCrawlStats;
  error?: string;
}

export async function performHistoricalCrawl(
  accessToken: string,
  batchSize: number = HISTORICAL_CRAWL_BATCH_SIZE
): Promise<HistoricalCrawlResult> {
  if (isHistoricalCrawlRunning) {
    appendLog('mal-historical-crawl', 'info', 'Historical crawl skipped: already running');
    return { success: false, alreadyRunning: true, syncedCount: 0, processedSeasons: 0, stats: getHistoricalCrawlStats() };
  }

  isHistoricalCrawlRunning = true;
  try {
    const batch = getNextHistoricalBatch(batchSize);
    if (batch.length === 0) {
      appendLog('mal-historical-crawl', 'success', 'Historical crawl already complete: no remaining seasons');
      return { success: true, alreadyRunning: false, syncedCount: 0, processedSeasons: 0, stats: getHistoricalCrawlStats() };
    }

    const allAnime: MALAnime[] = [];
    const syncedKeys: string[] = [];
    let consecutiveEmpty = 0;

    for (const { year, season } of batch) {
      const anime = await fetchSeasonalAnime(accessToken, year, season);
      if (anime.length === 0) {
        consecutiveEmpty++;
      } else {
        consecutiveEmpty = 0;
        allAnime.push(...anime);
      }
      // Always mark as synced even if empty (empty = no anime that season on MAL)
      syncedKeys.push(`${year}-${season}`);

      if (consecutiveEmpty >= HISTORICAL_CRAWL_CONSECUTIVE_EMPTY_STOP) {
        // Mark remaining batch items synced too so we skip past the dead zone
        break;
      }

      await new Promise(resolve => setTimeout(resolve, SEASON_DELAY_MS));
    }

    if (allAnime.length > 0) {
      upsertAnime(allAnime);
    }
    markSeasonsSynced(syncedKeys);

    const stats = getHistoricalCrawlStats();
    appendLog('mal-historical-crawl', 'success', `Historical crawl batch complete: ${syncedKeys.length} seasons, ${allAnime.length} anime`, {
      processedSeasons: syncedKeys.length,
      syncedCount: allAnime.length,
      remaining: stats.remaining,
    });

    return {
      success: true,
      alreadyRunning: false,
      syncedCount: allAnime.length,
      processedSeasons: syncedKeys.length,
      stats,
    };
  } catch (error) {
    console.error('Historical crawl error:', error);
    appendLog('mal-historical-crawl', 'error', 'Historical crawl failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return {
      success: false,
      alreadyRunning: false,
      syncedCount: 0,
      processedSeasons: 0,
      stats: getHistoricalCrawlStats(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    isHistoricalCrawlRunning = false;
  }
}

// ============================================================================
// Big sync
// ============================================================================

export interface BigSyncProgress {
  type: 'start' | 'progress' | 'season_complete' | 'season_error' | 'fetch_progress' | 'complete' | 'error';
  message?: string;
  totalSeasons?: number;
  currentSeason?: number;
  seasonAnimeCount?: number;
  totalAnimeCount?: number;
  year?: number | string;
  season?: string;
  error?: string;
  details?: string;
  syncedCount?: number;
  processedSeasons?: number;
  metadata?: any;
  offset?: number;
  fetched?: number;
}

export interface BigSyncResult {
  success: boolean;
  syncedCount: number;
  processedSeasons: number;
  totalSeasons: number;
  error?: string;
  details?: string;
}

/** Adapt `mal.ts`'s neutral progress ping to the SSE `fetch_progress` event. */
function fetchProgressReporter(
  progressCallback?: (progress: BigSyncProgress) => void
): ((p: MalFetchProgress) => void) | undefined {
  if (!progressCallback) return undefined;
  return ({ year, season, offset, fetched }) =>
    progressCallback({
      type: 'fetch_progress',
      message: season === 'upcoming'
        ? `Fetched ${fetched} upcoming anime`
        : `Fetching ${year} ${season} - ${fetched} anime so far`,
      year,
      season,
      offset,
      fetched,
    });
}

/**
 * Perform a big sync of anime data from MAL
 * @param accessToken MAL API access token
 * @param progressCallback Optional callback to report progress (for SSE streaming)
 * @returns Result of the sync operation
 */
export async function performBigSync(
  accessToken: string,
  progressCallback?: (progress: BigSyncProgress) => void
): Promise<BigSyncResult> {
  const onFetchProgress = fetchProgressReporter(progressCallback);

  try {
    const currentYear = new Date().getFullYear();
    const seasons = ['winter', 'spring', 'summer', 'fall'];

    const seasonsToSync: Array<{ year: number; season: string }> = [];

    // Generate list of seasons from 8 years ago to 2 years in the future
    for (let year = currentYear + 2; year >= currentYear - 8; year--) {
      for (const season of seasons) {
        seasonsToSync.push({ year, season });
      }
    }

    progressCallback?.({
      type: 'start',
      message: `Starting big sync for ${seasonsToSync.length} seasons and upcoming ranking`,
      totalSeasons: seasonsToSync.length,
      currentSeason: 0,
    });

    const allAnime: MALAnime[] = [];
    let processedSeasons = 0;

    // 1. Fetch top 500 upcoming anime
    try {
      progressCallback?.({
        type: 'progress',
        message: 'Fetching top 500 upcoming anime...',
        totalSeasons: seasonsToSync.length,
        currentSeason: 0,
      });

      const upcomingAnime = await fetchUpcomingAnime(accessToken, onFetchProgress);
      allAnime.push(...upcomingAnime);

      progressCallback?.({
        type: 'season_complete',
        message: `Completed fetching upcoming anime - ${upcomingAnime.length} anime`,
        totalSeasons: seasonsToSync.length,
        currentSeason: 0,
        seasonAnimeCount: upcomingAnime.length,
        totalAnimeCount: allAnime.length,
        year: 'N/A',
        season: 'upcoming',
      });

      await new Promise(resolve => setTimeout(resolve, SEASON_DELAY_MS));
    } catch (error) {
      console.error('Error fetching upcoming anime:', error);
      progressCallback?.({
        type: 'season_error',
        message: `Failed to fetch upcoming anime: ${error instanceof Error ? error.message : 'Unknown error'}`,
        year: 'N/A',
        season: 'upcoming',
      });
    }

    // 2. Process each season with rate limiting
    for (const { year, season } of seasonsToSync) {
      try {
        progressCallback?.({
          type: 'progress',
          message: `Syncing ${year} ${season}...`,
          totalSeasons: seasonsToSync.length,
          currentSeason: processedSeasons + 1,
          year,
          season,
        });

        const seasonAnime = await fetchSeasonalAnime(accessToken, year, season, onFetchProgress);
        allAnime.push(...seasonAnime);
        processedSeasons++;

        progressCallback?.({
          type: 'season_complete',
          message: `Completed ${year} ${season} - ${seasonAnime.length} anime`,
          totalSeasons: seasonsToSync.length,
          currentSeason: processedSeasons,
          seasonAnimeCount: seasonAnime.length,
          totalAnimeCount: allAnime.length,
          year,
          season,
        });

        if (processedSeasons < seasonsToSync.length) {
          await new Promise(resolve => setTimeout(resolve, SEASON_DELAY_MS));
        }
      } catch (error) {
        console.error(`Error syncing ${year} ${season}:`, error);
        progressCallback?.({
          type: 'season_error',
          message: `Failed to sync ${year} ${season}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          year,
          season,
        });
      }
    }

    // Upsert all anime data
    if (allAnime.length > 0) {
      upsertAnime(allAnime);
    }

    progressCallback?.({
      type: 'complete',
      message: `Big sync completed successfully!`,
      syncedCount: allAnime.length,
      processedSeasons,
      totalSeasons: seasonsToSync.length,
      metadata: getSyncMetadata(),
    });

    return {
      success: true,
      syncedCount: allAnime.length,
      processedSeasons,
      totalSeasons: seasonsToSync.length,
    };
  } catch (error) {
    console.error('Big sync error:', error);

    progressCallback?.({
      type: 'error',
      error: 'Failed to perform big sync',
      details: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      success: false,
      syncedCount: 0,
      processedSeasons: 0,
      totalSeasons: 0,
      error: 'Failed to perform big sync',
      details: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
