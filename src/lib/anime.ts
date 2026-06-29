import fs from 'fs';
import path from 'path';
import { MALAnime, AnimeForDisplay, MALAuthData, MALUser, SyncMetadata, UserAnimeStatus } from '@/models/anime';
// Legacy view-specific filter utilities removed (fire-and-forget presets now handled client-side)
// User preferences removed - all state now controlled via URL

const DATA_PATH = process.env.DATA_PATH || '/app/data';

// File paths
const ANIME_MAL_FILE = path.join(DATA_PATH, 'animes_MAL.json');
const ANIME_HIDDEN_FILE = path.join(DATA_PATH, 'animes_hidden.json');
const MAL_AUTH_FILE = path.join(DATA_PATH, 'mal_auth.json');

// Utility function to ensure data directory exists
function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true, mode: 0o755 });
  }
}

// Utility function to safely read JSON files
function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return defaultValue;
  }
}

// Utility function to safely write JSON files
function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    ensureDataDirectory();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
    throw error;
  }
}

// Hidden anime IDs operations
export function getHiddenAnimeIds(): number[] {
  return readJsonFile<number[]>(ANIME_HIDDEN_FILE, []);
}

export function addHiddenAnimeId(animeId: number): void {
  const hiddenIds = getHiddenAnimeIds();
  if (!hiddenIds.includes(animeId)) {
    hiddenIds.push(animeId);
    writeJsonFile(ANIME_HIDDEN_FILE, hiddenIds);
    cachedAnime = null;
  }
}

export function removeHiddenAnimeId(animeId: number): void {
  let hiddenIds = getHiddenAnimeIds();
  hiddenIds = hiddenIds.filter(id => id !== animeId);
  writeJsonFile(ANIME_HIDDEN_FILE, hiddenIds);
  cachedAnime = null;
}

// MAL Anime data operations
export function getAllMALAnime(): Record<string, MALAnime> {
  return readJsonFile(ANIME_MAL_FILE, {});
}

export function saveMALAnime(animeData: Record<string, MALAnime>): void {
  writeJsonFile(ANIME_MAL_FILE, animeData);
  cachedAnime = null;
}

export function upsertMALAnime(newAnime: MALAnime[]): void {
  const existingAnime = getAllMALAnime();

  newAnime.forEach(anime => {
    existingAnime[anime.id.toString()] = anime;
  });

  saveMALAnime(existingAnime);
}

// Combined data operations
let cachedAnime: AnimeForDisplay[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 10 * 60_000; // 10 min

export function getAnimeForDisplay(): AnimeForDisplay[] {
  const now = Date.now();
  if (cachedAnime && (now - lastCacheTime) < CACHE_TTL_MS) {
    return cachedAnime;
  }
  const malAnime = getAllMALAnime();
  const hiddenIds = getHiddenAnimeIds();
  cachedAnime = Object.values(malAnime).map(anime => ({
    ...anime,
    hidden: hiddenIds.includes(anime.id)
  }));
  lastCacheTime = now;
  return cachedAnime;
}

// Deprecated: server-side view filtering removed. `view` parameter now only maps to explicit filters in API handler.

// Authentication operations
export function getMALAuthData(): { user: MALUser | null; token: MALAuthData | null } {
  const authData = readJsonFile(MAL_AUTH_FILE, { user: null, token: null });
  return authData;
}

export function saveMALAuthData(user: MALUser | null, token: MALAuthData | null): void {
  writeJsonFile(MAL_AUTH_FILE, { user, token });
}

export function clearMALAuthData(): void {
  saveMALAuthData(null, null);
}

export function isMALTokenValid(token: MALAuthData | null): boolean {
  if (!token) return false;

  const now = Date.now();
  const tokenExpiry = token.created_at + (token.expires_in * 1000);

  return now < tokenExpiry;
}

// Sync metadata operations
export function getSyncMetadata(): SyncMetadata | null {
  const malAnime = getAllMALAnime();
  const animeList = Object.values(malAnime);

  if (animeList.length === 0) return null;

  // Find the most recent sync by looking at updated_at timestamps
  const mostRecent = animeList.reduce((latest, anime) => {
    if (!anime.updated_at) return latest;
    if (!latest.updated_at) return anime;
    return new Date(anime.updated_at) > new Date(latest.updated_at) ? anime : latest;
  });

  if (!mostRecent.updated_at) return null;

  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const month = currentDate.getMonth() + 1;

  let currentSeason: string;
  if (month >= 1 && month <= 3) currentSeason = 'winter';
  else if (month >= 4 && month <= 6) currentSeason = 'spring';
  else if (month >= 7 && month <= 9) currentSeason = 'summer';
  else currentSeason = 'fall';

  let prevYear = currentYear;
  let prevSeason: string;
  if (currentSeason === 'winter') { prevSeason = 'fall'; prevYear--; }
  else if (currentSeason === 'spring') prevSeason = 'winter';
  else if (currentSeason === 'summer') prevSeason = 'spring';
  else prevSeason = 'summer';

  return {
    lastSyncDate: mostRecent.updated_at,
    currentSeason: { year: currentYear, season: currentSeason },
    previousSeason: { year: prevYear, season: prevSeason },
    totalAnimeCount: animeList.length
  };
}

// Personal status sync operations
interface MALListStatus {
  status: string;
  score: number;
  num_episodes_watched: number;
  is_rewatching: boolean;
  updated_at: string;
}

interface PersonalStatusUpdateResult {
  updated: boolean;
  changes: string[];
}

/**
 * Update personal status for a single anime if it exists and differs from current state.
 * Does NOT insert new anime - only updates existing ones.
 */
export function updatePersonalStatus(
  animeId: number,
  newListStatus: MALListStatus
): PersonalStatusUpdateResult {
  const existingAnime = getAllMALAnime();
  const animeKey = animeId.toString();

  // Anime doesn't exist locally - don't insert it
  if (!existingAnime[animeKey]) {
    return { updated: false, changes: [] };
  }

  const anime = existingAnime[animeKey];
  const changes: string[] = [];

  // If anime doesn't have personal status yet, initialize it
  if (!anime.my_list_status) {
    anime.my_list_status = {
      status: newListStatus.status,
      score: newListStatus.score,
      num_episodes_watched: newListStatus.num_episodes_watched,
      is_rewatching: newListStatus.is_rewatching,
      updated_at: newListStatus.updated_at,
    };
    changes.push('initialized');
  } else {
    // Compare each field and track changes
    if (anime.my_list_status.status !== newListStatus.status) {
      changes.push(`status: ${anime.my_list_status.status} -> ${newListStatus.status}`);
      anime.my_list_status.status = newListStatus.status;
    }

    if (anime.my_list_status.score !== newListStatus.score) {
      changes.push(`score: ${anime.my_list_status.score} -> ${newListStatus.score}`);
      anime.my_list_status.score = newListStatus.score;
    }

    if (anime.my_list_status.num_episodes_watched !== newListStatus.num_episodes_watched) {
      changes.push(
        `episodes: ${anime.my_list_status.num_episodes_watched} -> ${newListStatus.num_episodes_watched}`
      );
      anime.my_list_status.num_episodes_watched = newListStatus.num_episodes_watched;
    }

    if (anime.my_list_status.is_rewatching !== newListStatus.is_rewatching) {
      changes.push(`rewatching: ${anime.my_list_status.is_rewatching} -> ${newListStatus.is_rewatching}`);
      anime.my_list_status.is_rewatching = newListStatus.is_rewatching;
    }

    // Always update updated_at timestamp
    anime.my_list_status.updated_at = newListStatus.updated_at;
  }

  // If changes were made, save
  if (changes.length > 0) {
    existingAnime[animeKey] = anime;
    saveMALAnime(existingAnime);
    return { updated: true, changes };
  }

  return { updated: false, changes: [] };
}

interface BatchUpdateStats {
  totalProcessed: number;
  updated: number;
  skipped: number;
  failed: number;
  updates: Array<{ animeId: number; changes: string[] }>;
}

/**
 * Apply personal status updates to multiple anime.
 * Only updates existing anime, never inserts new ones.
 */
export function updatePersonalStatusBatch(
  updates: Array<{ animeId: number; listStatus: MALListStatus }>
): BatchUpdateStats {
  const stats: BatchUpdateStats = {
    totalProcessed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    updates: [],
  };

  for (const update of updates) {
    try {
      const result = updatePersonalStatus(update.animeId, update.listStatus);
      stats.totalProcessed++;

      if (result.updated) {
        stats.updated++;
        stats.updates.push({ animeId: update.animeId, changes: result.changes });
      } else {
        stats.skipped++;
      }
    } catch (error) {
      stats.failed++;
      console.error(`Failed to update personal status for anime ${update.animeId}:`, error);
    }
  }

  return stats;
}

// Historical crawl checkpoint

const SYNC_CHECKPOINT_FILE = path.join(DATA_PATH, 'sync_checkpoint.json');
const HISTORICAL_CRAWL_OLDEST_YEAR = 1960;
const HISTORICAL_CRAWL_BATCH_SIZE = 5;
const HISTORICAL_CRAWL_CONSECUTIVE_EMPTY_STOP = 8;

// Module-level lock to prevent concurrent historical crawl runs
let isHistoricalCrawlRunning = false;

interface SyncCheckpoint {
  syncedSeasons: string[];
}

export function getSyncCheckpoint(): SyncCheckpoint {
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
    return { success: false, alreadyRunning: true, syncedCount: 0, processedSeasons: 0, stats: getHistoricalCrawlStats() };
  }

  isHistoricalCrawlRunning = true;
  try {
    const batch = getNextHistoricalBatch(batchSize);
    if (batch.length === 0) {
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

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (allAnime.length > 0) {
      upsertMALAnime(allAnime);
    }
    markSeasonsSynced(syncedKeys);

    return {
      success: true,
      alreadyRunning: false,
      syncedCount: allAnime.length,
      processedSeasons: syncedKeys.length,
      stats: getHistoricalCrawlStats(),
    };
  } catch (error) {
    console.error('Historical crawl error:', error);
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

// Big Sync functionality

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

async function fetchUpcomingAnime(
  accessToken: string,
  addProgress?: (progress: BigSyncProgress) => void
): Promise<MALAnime[]> {
  const allAnime: MALAnime[] = [];
  const limit = 500;

  const fields = [
    'id', 'title', 'main_picture', 'alternative_titles',
    'start_date', 'end_date', 'synopsis', 'mean', 'rank', 'popularity',
    'num_list_users', 'num_scoring_users', 'nsfw', 'genres',
    'created_at', 'updated_at', 'media_type', 'status',
    'my_list_status', 'num_episodes', 'start_season', 'broadcast',
    'source', 'average_episode_duration', 'rating', 'pictures',
    'background', 'related_anime', 'studios'
  ].join(',');

  const url = `https://api.myanimelist.net/v2/anime/ranking`;
  const params = new URLSearchParams({
    ranking_type: 'upcoming',
    limit: limit.toString(),
    fields,
    nsfw: 'true'
  });

  const response = await fetch(`${url}?${params}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`MAL API request failed for upcoming ranking: ${response.status} ${response.statusText}`);
  }

  const data: any = await response.json();

  if (data.data && data.data.length > 0) {
    const upcomingAnime = data.data.map((item: any) => item.node);
    allAnime.push(...upcomingAnime);

    if (addProgress) {
      addProgress({
        type: 'fetch_progress',
        message: `Fetched ${allAnime.length} upcoming anime`,
        year: 'N/A',
        season: 'upcoming',
        fetched: allAnime.length
      });
    }
  }

  return allAnime;
}

async function fetchSeasonalAnime(
  accessToken: string,
  year: number,
  season: string,
  addProgress?: (progress: BigSyncProgress) => void
): Promise<MALAnime[]> {
  const allAnime: MALAnime[] = [];
  let offset = 0;
  const limit = 100;

  const fields = [
    'id', 'title', 'main_picture', 'alternative_titles',
    'start_date', 'end_date', 'synopsis', 'mean', 'rank', 'popularity',
    'num_list_users', 'num_scoring_users', 'nsfw', 'genres',
    'created_at', 'updated_at', 'media_type', 'status',
    'my_list_status', 'num_episodes', 'start_season', 'broadcast',
    'source', 'average_episode_duration', 'rating', 'pictures',
    'background', 'related_anime', 'studios'
  ].join(',');

  while (true) {
    const url = `https://api.myanimelist.net/v2/anime/season/${year}/${season}`;
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      fields,
      nsfw: 'true'
    });

    const response = await fetch(`${url}?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`MAL API request failed: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();

    if (!data.data || data.data.length === 0) {
      break;
    }

    const seasonAnime = data.data.map((item: any) => item.node);
    allAnime.push(...seasonAnime);

    if (addProgress) {
      addProgress({
        type: 'fetch_progress',
        message: `Fetching ${year} ${season} - ${allAnime.length} anime so far`,
        year,
        season,
        offset,
        fetched: allAnime.length
      });
    }

    if (!data.paging?.next || data.data.length < limit) {
      break;
    }

    offset += limit;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return allAnime;
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
  try {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    const seasons = ['winter', 'spring', 'summer', 'fall'];

    const seasonsToSync: Array<{ year: number; season: string }> = [];

    // Generate list of seasons from 8 years ago to 2 years in the future
    for (let year = currentYear + 2; year >= currentYear - 8; year--) {
      for (const season of seasons) {
        seasonsToSync.push({ year, season });
      }
    }

    if (progressCallback) {
      progressCallback({
        type: 'start',
        message: `Starting big sync for ${seasonsToSync.length} seasons and upcoming ranking`,
        totalSeasons: seasonsToSync.length,
        currentSeason: 0
      });
    }

    const allAnime: MALAnime[] = [];
    let processedSeasons = 0;

    // 1. Fetch top 500 upcoming anime
    try {
      if (progressCallback) {
        progressCallback({
          type: 'progress',
          message: 'Fetching top 500 upcoming anime...',
          totalSeasons: seasonsToSync.length,
          currentSeason: 0,
        });
      }
      const upcomingAnime = await fetchUpcomingAnime(accessToken, progressCallback);
      allAnime.push(...upcomingAnime);
      if (progressCallback) {
        progressCallback({
          type: 'season_complete',
          message: `Completed fetching upcoming anime - ${upcomingAnime.length} anime`,
          totalSeasons: seasonsToSync.length,
          currentSeason: 0,
          seasonAnimeCount: upcomingAnime.length,
          totalAnimeCount: allAnime.length,
          year: 'N/A',
          season: 'upcoming'
        });
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error('Error fetching upcoming anime:', error);
      if (progressCallback) {
        progressCallback({
          type: 'season_error',
          message: `Failed to fetch upcoming anime: ${error instanceof Error ? error.message : 'Unknown error'}`,
          year: 'N/A',
          season: 'upcoming'
        });
      }
    }

    // 2. Process each season with rate limiting
    for (const { year, season } of seasonsToSync) {
      try {
        if (progressCallback) {
          progressCallback({
            type: 'progress',
            message: `Syncing ${year} ${season}...`,
            totalSeasons: seasonsToSync.length,
            currentSeason: processedSeasons + 1,
            year,
            season
          });
        }

        const seasonAnime = await fetchSeasonalAnime(accessToken, year, season, progressCallback);
        allAnime.push(...seasonAnime);
        processedSeasons++;

        if (progressCallback) {
          progressCallback({
            type: 'season_complete',
            message: `Completed ${year} ${season} - ${seasonAnime.length} anime`,
            totalSeasons: seasonsToSync.length,
            currentSeason: processedSeasons,
            seasonAnimeCount: seasonAnime.length,
            totalAnimeCount: allAnime.length,
            year,
            season
          });
        }

        if (processedSeasons < seasonsToSync.length) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }

      } catch (error) {
        console.error(`Error syncing ${year} ${season}:`, error);
        if (progressCallback) {
          progressCallback({
            type: 'season_error',
            message: `Failed to sync ${year} ${season}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            year,
            season
          });
        }
      }
    }

    // Upsert all anime data
    if (allAnime.length > 0) {
      upsertMALAnime(allAnime);
    }

    const syncMetadata = getSyncMetadata();
    
    if (progressCallback) {
      progressCallback({
        type: 'complete',
        message: `Big sync completed successfully!`,
        syncedCount: allAnime.length,
        processedSeasons,
        totalSeasons: seasonsToSync.length,
        metadata: syncMetadata
      });
    }

    return {
      success: true,
      syncedCount: allAnime.length,
      processedSeasons,
      totalSeasons: seasonsToSync.length
    };

  } catch (error) {
    console.error('Big sync error:', error);
    
    if (progressCallback) {
      progressCallback({
        type: 'error',
        error: 'Failed to perform big sync',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return {
      success: false,
      syncedCount: 0,
      processedSeasons: 0,
      totalSeasons: 0,
      error: 'Failed to perform big sync',
      details: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
