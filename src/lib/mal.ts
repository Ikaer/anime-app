/**
 * The MyAnimeList pipe: OAuth token storage and the read side of the MAL API.
 *
 * Everything here is genuinely about MAL, which is why it keeps the `MAL`
 * prefix. Orchestration (which seasons to crawl, when, with what checkpoint)
 * lives in `malSync.ts`; the local record lives in `store.ts`. Writes back to
 * MAL live in `malWrite.ts`.
 *
 * Server-only (uses `fs` via `jsonStore`).
 */

import { MALAnime, MALAuthData, MALUser } from '@/models/anime';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/jsonStore';

const MAL_AUTH_FILE = dataFile('mal_auth.json');
const MAL_API = 'https://api.myanimelist.net/v2';

/** Pause between paginated MAL requests, to stay polite to the API. */
const PAGE_DELAY_MS = 500;

/**
 * The catalog field set requested from MAL. Declared once: every MAL read that
 * wants a complete `MALAnime` asks for exactly these, so adding a field is a
 * one-line change rather than a five-file hunt.
 */
export const MAL_ANIME_FIELDS = [
  'id', 'title', 'main_picture', 'alternative_titles',
  'start_date', 'end_date', 'synopsis', 'mean', 'rank', 'popularity',
  'num_list_users', 'num_scoring_users', 'nsfw', 'genres',
  'created_at', 'updated_at', 'media_type', 'status',
  'my_list_status', 'num_episodes', 'start_season', 'broadcast',
  'source', 'average_episode_duration', 'rating', 'pictures',
  'background', 'related_anime', 'studios',
].join(',');

// ============================================================================
// Authentication
// ============================================================================

export function getMALAuthData(): { user: MALUser | null; token: MALAuthData | null } {
  return readJsonFile(MAL_AUTH_FILE, { user: null, token: null });
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

// ============================================================================
// Catalog reads
// ============================================================================

/** Progress ping emitted while paginating. Deliberately not tied to the SSE shape. */
export interface MalFetchProgress {
  year: number | string;
  season: string;
  offset?: number;
  fetched: number;
}

async function malGet(accessToken: string, url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`MAL API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/** All anime of one season, paginated to exhaustion. */
export async function fetchSeasonalAnime(
  accessToken: string,
  year: number,
  season: string,
  onProgress?: (progress: MalFetchProgress) => void
): Promise<MALAnime[]> {
  const allAnime: MALAnime[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      fields: MAL_ANIME_FIELDS,
      nsfw: 'true',
    });

    const data = await malGet(accessToken, `${MAL_API}/anime/season/${year}/${season}?${params}`);

    if (!data.data || data.data.length === 0) break;

    allAnime.push(...data.data.map((item: any) => item.node as MALAnime));
    onProgress?.({ year, season, offset, fetched: allAnime.length });

    if (!data.paging?.next || data.data.length < limit) break;

    offset += limit;
    await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS));
  }

  return allAnime;
}

/** The top 500 of MAL's `upcoming` ranking. */
export async function fetchUpcomingAnime(
  accessToken: string,
  onProgress?: (progress: MalFetchProgress) => void
): Promise<MALAnime[]> {
  const params = new URLSearchParams({
    ranking_type: 'upcoming',
    limit: '500',
    fields: MAL_ANIME_FIELDS,
    nsfw: 'true',
  });

  const data = await malGet(accessToken, `${MAL_API}/anime/ranking?${params}`);
  if (!data.data || data.data.length === 0) return [];

  const allAnime: MALAnime[] = data.data.map((item: any) => item.node as MALAnime);
  onProgress?.({ year: 'N/A', season: 'upcoming', fetched: allAnime.length });
  return allAnime;
}

/** One title, full field set. Returns undefined when MAL has nothing for that id. */
export async function fetchAnimeById(
  accessToken: string,
  animeId: number
): Promise<MALAnime | undefined> {
  const data = await malGet(
    accessToken,
    `${MAL_API}/anime/${animeId}?fields=${MAL_ANIME_FIELDS}&nsfw=true`
  );
  return data?.id ? (data as MALAnime) : undefined;
}

// ============================================================================
// Personal list read
// ============================================================================

export interface UserAnimeListItem {
  animeId: number;
  listStatus: {
    status: string;
    score: number;
    num_episodes_watched: number;
    is_rewatching: boolean;
    updated_at: string;
  };
}

/** The user's whole MAL list — ids plus personal status, paginated to exhaustion. */
export async function fetchUserAnimelist(
  accessToken: string,
  username: string
): Promise<UserAnimeListItem[]> {
  const allAnime: UserAnimeListItem[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const params = new URLSearchParams({
      offset: offset.toString(),
      limit: limit.toString(),
      fields: 'id,title,my_list_status',
    });

    const data = await malGet(accessToken, `${MAL_API}/users/${username}/animelist?${params}`);

    if (!data.data || data.data.length === 0) break;

    allAnime.push(...data.data.map((item: any) => ({
      animeId: item.node.id,
      listStatus: item.node.my_list_status,
    })));

    if (!data.paging?.next || data.data.length < limit) break;

    offset += limit;
    await new Promise(resolve => setTimeout(resolve, PAGE_DELAY_MS));
  }

  return allAnime;
}
