/**
 * The local record store — the authority.
 *
 * MAL, SIMKL and AniList are interchangeable, absent-tolerant refill pipes;
 * what they refill is the merged local record assembled here. Nothing in this
 * module talks to a remote API: it reads and writes the JSON files under
 * `DATA_PATH` and joins them into `AnimeForDisplay`.
 *
 * Naming: functions here are about the *local record*, so they carry no source
 * prefix. A `MAL`/`Simkl`/`Anilist` prefix means the function is genuinely
 * about that one source's slice of the data.
 *
 * Server-only (uses `fs` via `jsonStore`). Client components must
 * `import type` from here, never import values.
 */

import { MALAnime, AnimeForDisplay, SyncMetadata, SimklPersonalEntry, AniListTagsEntry, SourceIds } from '@/models/anime';
import { computeDiscrepancy } from '@/lib/simklCompare';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/jsonStore';
import { getSeasonInfos } from '@/lib/animeUtils';

const ANIME_MAL_FILE = dataFile('animes_MAL.json');
const ANIME_HIDDEN_FILE = dataFile('animes_hidden.json');
const ANIME_SIMKL_FILE = dataFile('animes_SIMKL.json');
const ANIME_ANILIST_TAGS_FILE = dataFile('animes_anilist_tags.json');

// ============================================================================
// Hidden anime ids
// ============================================================================

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

// ============================================================================
// The catalog itself (still shaped like a MAL response, still keyed by MAL id)
// ============================================================================

export function getAllAnime(): Record<string, MALAnime> {
  return readJsonFile(ANIME_MAL_FILE, {});
}

export function saveAnime(animeData: Record<string, MALAnime>): void {
  writeJsonFile(ANIME_MAL_FILE, animeData);
  cachedAnime = null;
}

export function upsertAnime(newAnime: MALAnime[]): void {
  const existingAnime = getAllAnime();

  newAnime.forEach(anime => {
    existingAnime[anime.id.toString()] = anime;
  });

  saveAnime(existingAnime);
}

// ============================================================================
// SIMKL personal-entry slice (keyed by MAL id, as string)
// ============================================================================

export function getAllSimklEntries(): Record<string, SimklPersonalEntry> {
  return readJsonFile<Record<string, SimklPersonalEntry>>(ANIME_SIMKL_FILE, {});
}

export function upsertSimklEntries(entries: SimklPersonalEntry[]): void {
  const existing = getAllSimklEntries();
  entries.forEach(entry => {
    existing[entry.mal_id.toString()] = entry;
  });
  writeJsonFile(ANIME_SIMKL_FILE, existing);
  cachedAnime = null;
}

export function removeSimklEntries(malIds: number[]): void {
  const existing = getAllSimklEntries();
  let changed = false;
  malIds.forEach(id => {
    if (existing[id.toString()]) {
      delete existing[id.toString()];
      changed = true;
    }
  });
  if (changed) {
    writeJsonFile(ANIME_SIMKL_FILE, existing);
    cachedAnime = null;
  }
}

// ============================================================================
// AniList catalog-metadata slice (keyed by MAL id, as string)
// ============================================================================

export function getAllAnilistTags(): Record<string, AniListTagsEntry> {
  return readJsonFile<Record<string, AniListTagsEntry>>(ANIME_ANILIST_TAGS_FILE, {});
}

export function getAnilistTagsCount(): number {
  return Object.keys(getAllAnilistTags()).length;
}

export function upsertAnilistTags(entries: AniListTagsEntry[]): void {
  const existing = getAllAnilistTags();
  entries.forEach(entry => {
    existing[entry.mal_id.toString()] = entry;
  });
  writeJsonFile(ANIME_ANILIST_TAGS_FILE, existing);
  cachedAnime = null;
}

// ============================================================================
// The merged record
// ============================================================================

let cachedAnime: AnimeForDisplay[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 10 * 60_000; // 10 min

/**
 * Assemble the unified cross-source crosswalk from every pipe. The MAL id is
 * the anchor (and current join key); SIMKL contributes its rich `ids` block;
 * AniList contributes its own `idMal`-resolved id (authoritative over SIMKL's
 * `anilist` field, which occasionally mirrors the MAL id). Returns undefined
 * when only the MAL self-id is known (nothing worth carrying yet).
 */
function assembleCrosswalk(
  malId: number,
  simkl?: SimklPersonalEntry,
  anilistTags?: AniListTagsEntry
): SourceIds | undefined {
  if (!simkl?.ids && !simkl?.simkl_id && !anilistTags) return undefined;
  const crosswalk: SourceIds = { ...(simkl?.ids || {}), mal: malId };
  if (simkl?.simkl_id) crosswalk.simkl = simkl.simkl_id;
  if (anilistTags?.anilist_id) crosswalk.anilist = anilistTags.anilist_id;
  return crosswalk;
}

export function getAnimeForDisplay(): AnimeForDisplay[] {
  const now = Date.now();
  if (cachedAnime && (now - lastCacheTime) < CACHE_TTL_MS) {
    return cachedAnime;
  }
  const malAnime = getAllAnime();
  const hiddenIds = getHiddenAnimeIds();
  const simklByMalId = getAllSimklEntries();
  const anilistTagsByMalId = getAllAnilistTags();
  cachedAnime = Object.values(malAnime).map(anime => {
    const simkl = simklByMalId[anime.id.toString()];
    const anilistTags = anilistTagsByMalId[anime.id.toString()];
    return {
      ...anime,
      hidden: hiddenIds.includes(anime.id),
      simkl,
      discrepancy: computeDiscrepancy(anime, simkl),
      anilistTags,
      crosswalk: assembleCrosswalk(anime.id, simkl, anilistTags),
    };
  });
  lastCacheTime = now;
  return cachedAnime;
}

/**
 * Assemble ONE anime record straight from the source files, bypassing the
 * `getAnimeForDisplay` cache entirely.
 *
 * The detail page renders in `getServerSideProps` (page bundle) while refresh
 * writes run in an API route (api bundle). In a production Next build those two
 * do NOT share module-level state, so an API-route write invalidating
 * `cachedAnime` never reaches the page's copy — it would stay stale until the
 * 10-min TTL expired. Reading fresh here makes the detail page immune to that.
 */
export function getAnimeByIdForDisplay(id: number): AnimeForDisplay | undefined {
  const mal = getAllAnime()[id.toString()];
  if (!mal) return undefined;
  const hidden = getHiddenAnimeIds();
  const simkl = getAllSimklEntries()[id.toString()];
  const anilistTags = getAllAnilistTags()[id.toString()];
  return {
    ...mal,
    hidden: hidden.includes(mal.id),
    simkl,
    discrepancy: computeDiscrepancy(mal, simkl),
    anilistTags,
    crosswalk: assembleCrosswalk(mal.id, simkl, anilistTags),
  };
}

// ============================================================================
// Sync metadata
// ============================================================================

export function getSyncMetadata(): SyncMetadata | null {
  const malAnime = getAllAnime();
  const animeList = Object.values(malAnime);

  if (animeList.length === 0) return null;

  // Find the most recent sync by looking at updated_at timestamps
  const mostRecent = animeList.reduce((latest, anime) => {
    if (!anime.updated_at) return latest;
    if (!latest.updated_at) return anime;
    return new Date(anime.updated_at) > new Date(latest.updated_at) ? anime : latest;
  });

  if (!mostRecent.updated_at) return null;

  const { current, previous } = getSeasonInfos();

  return {
    lastSyncDate: mostRecent.updated_at,
    currentSeason: current,
    previousSeason: previous,
    totalAnimeCount: animeList.length
  };
}

// ============================================================================
// Personal status writes (MAL's `my_list_status` slice of the local record)
// ============================================================================

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
function updatePersonalStatus(
  animeId: number,
  newListStatus: MALListStatus
): PersonalStatusUpdateResult {
  const existingAnime = getAllAnime();
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
    saveAnime(existingAnime);
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
