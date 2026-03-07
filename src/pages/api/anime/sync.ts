import { NextApiRequest, NextApiResponse } from 'next';
import { 
  getMALAuthData, 
  isMALTokenValid, 
  upsertMALAnime, 
  getSyncMetadata,
  updatePersonalStatusBatch 
} from '@/lib/anime';
import { AnimeSeasonResponse, MALAnime } from '@/models/anime';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    // Check authentication
    const authData = getMALAuthData();
    const { token, user } = authData;
    if (!token || !isMALTokenValid(token)) {
      return res.status(401).json({ error: 'Not authenticated with MAL' });
    }

    if (!user?.name) {
      return res.status(401).json({ error: 'User information not available' });
    }

    // Determine current and previous seasons
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

    // Determine next season
    let nextYear = currentYear;
    let nextSeason: string;
    if (currentSeason === 'winter') nextSeason = 'spring';
    else if (currentSeason === 'spring') nextSeason = 'summer';
    else if (currentSeason === 'summer') nextSeason = 'fall';
    else { nextSeason = 'winter'; nextYear++; }

    console.log(`Syncing anime for current season: ${currentYear} ${currentSeason}`);
    console.log(`Syncing anime for previous season: ${prevYear} ${prevSeason}`);
    console.log(`Syncing anime for next season: ${nextYear} ${nextSeason}`);

    const allAnime: MALAnime[] = [];

    // Fetch current season
    const currentSeasonAnime = await fetchSeasonalAnime(token.access_token, currentYear, currentSeason);
    allAnime.push(...currentSeasonAnime);

    // Fetch previous season
    const prevSeasonAnime = await fetchSeasonalAnime(token.access_token, prevYear, prevSeason);
    allAnime.push(...prevSeasonAnime);

    // Fetch next season
    const nextSeasonAnime = await fetchSeasonalAnime(token.access_token, nextYear, nextSeason);
    allAnime.push(...nextSeasonAnime);

    // Upsert all anime data
    upsertMALAnime(allAnime);

    console.log(`Successfully synced ${allAnime.length} seasonal anime`);

    // Personal status sync
    console.log(`Syncing personal anime list for user: ${user.name}`);
    const personalAnimeList = await fetchUserAnimelist(token.access_token, user.name);
    console.log(`Fetched ${personalAnimeList.length} anime from personal list`);

    const personalStatusUpdates = personalAnimeList.map(item => ({
      animeId: item.animeId,
      listStatus: item.listStatus
    }));

    const personalSyncStats = updatePersonalStatusBatch(personalStatusUpdates);
    console.log(
      `Personal status sync: ${personalSyncStats.updated} updated, ${personalSyncStats.skipped} skipped, ${personalSyncStats.failed} failed`
    );

    // Return sync results
    const syncMetadata = getSyncMetadata();
    res.json({
      success: true,
      seasonalSync: {
        syncedCount: allAnime.length,
        currentSeason: { year: currentYear, season: currentSeason },
        previousSeason: { year: prevYear, season: prevSeason }
      },
      personalStatusSync: {
        processed: personalSyncStats.totalProcessed,
        updated: personalSyncStats.updated,
        skipped: personalSyncStats.skipped,
        failed: personalSyncStats.failed,
        changes: personalSyncStats.updates
      },
      metadata: syncMetadata
    });

  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ 
      error: 'Failed to sync anime data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function fetchSeasonalAnime(accessToken: string, year: number, season: string): Promise<MALAnime[]> {
  const allAnime: MALAnime[] = [];
  let offset = 0;
  const limit = 100; // MAL API limit

  // Fields to include in the response (based on Python app)
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
      nsfw: 'true' // Include NSFW content
    });

    console.log(`Fetching ${year} ${season} anime, offset: ${offset}`);

    const response = await fetch(`${url}?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`MAL API request failed: ${response.status} ${response.statusText}`);
    }

    const data: AnimeSeasonResponse = await response.json();
    
    if (!data.data || data.data.length === 0) {
      break; // No more data
    }

    // Extract anime from response
    const seasonAnime = data.data.map(item => item.node);
    allAnime.push(...seasonAnime);

    console.log(`Fetched ${seasonAnime.length} anime (total: ${allAnime.length})`);

    // Check if there's more data
    if (!data.paging?.next || data.data.length < limit) {
      break;
    }

    offset += limit;

    // Add a small delay to be respectful to the API
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`Finished fetching ${year} ${season}: ${allAnime.length} anime`);
  return allAnime;
}

interface UserAnimeListItem {
  animeId: number;
  listStatus: {
    status: string;
    score: number;
    num_episodes_watched: number;
    is_rewatching: boolean;
    updated_at: string;
  };
}

/**
 * Fetch user's personal anime list from MAL.
 * Paginates through all entries and returns anime IDs with their personal status.
 */
async function fetchUserAnimelist(
  accessToken: string,
  username: string
): Promise<UserAnimeListItem[]> {
  const allAnime: UserAnimeListItem[] = [];
  let offset = 0;
  const limit = 100; // MAL API limit

  // Minimal fields needed for personal status sync
  const fields = 'id,title,my_list_status';

  while (true) {
    const url = `https://api.myanimelist.net/v2/users/${username}/animelist`;
    const params = new URLSearchParams({
      offset: offset.toString(),
      limit: limit.toString(),
      fields,
    });

    console.log(`Fetching user animelist, offset: ${offset}`);

    const response = await fetch(`${url}?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `MAL API request failed: ${response.status} ${response.statusText}`
      );
    }

    interface UserAnimeListResponse {
      data: Array<{
        node: {
          id: number;
          title: string;
          my_list_status: {
            status: string;
            score: number;
            num_episodes_watched: number;
            is_rewatching: boolean;
            updated_at: string;
          };
        };
      }>;
      paging?: {
        next?: string;
      };
    }

    const data: UserAnimeListResponse = await response.json();

    if (!data.data || data.data.length === 0) {
      break; // No more data
    }

    // Extract anime from response
    const userAnime = data.data.map(item => ({
      animeId: item.node.id,
      listStatus: item.node.my_list_status,
    }));
    allAnime.push(...userAnime);

    console.log(
      `Fetched ${userAnime.length} anime from user list (total: ${allAnime.length})`
    );

    // Check if there's more data
    if (!data.paging?.next || data.data.length < limit) {
      break;
    }

    offset += limit;

    // Add a small delay to be respectful to the API
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`Finished fetching user animelist: ${allAnime.length} anime`);
  return allAnime;
}
