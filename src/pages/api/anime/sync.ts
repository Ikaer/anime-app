import { NextApiRequest, NextApiResponse } from 'next';
import { upsertAnime, getSyncMetadata, updatePersonalStatusBatch } from '@/lib/store';
import { getMALAuthData, isMALTokenValid, fetchSeasonalAnime, fetchUserAnimelist } from '@/lib/mal';
import { getSeasonInfos } from '@/lib/animeUtils';
import { MALAnime } from '@/models/anime';
import { appendLog } from '@/lib/connectionLog';

/**
 * The lightweight sync: the three seasons around today, plus the user's
 * personal list. Unlike big-sync it never inserts from the personal list — it
 * only updates `my_list_status` on anime the catalog already holds.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  try {
    const { token, user } = getMALAuthData();
    if (!token || !isMALTokenValid(token)) {
      return res.status(401).json({ error: 'Not authenticated with MAL' });
    }

    if (!user?.name) {
      return res.status(401).json({ error: 'User information not available' });
    }

    const { current, previous, next } = getSeasonInfos();

    appendLog('sync', 'info', 'Sync started', {
      currentSeason: current,
      previousSeason: previous,
      nextSeason: next,
    });

    const allAnime: MALAnime[] = [];
    for (const { year, season } of [current, previous, next]) {
      allAnime.push(...await fetchSeasonalAnime(token.access_token, year, season));
    }

    upsertAnime(allAnime);
    appendLog('sync', 'info', `Synced ${allAnime.length} seasonal anime`, { syncedCount: allAnime.length });

    // Personal status sync — updates existing records only, never inserts.
    const personalAnimeList = await fetchUserAnimelist(token.access_token, user.name);
    const personalSyncStats = updatePersonalStatusBatch(personalAnimeList);

    appendLog('sync', 'success', 'Sync completed', {
      seasonalSyncedCount: allAnime.length,
      personalFetched: personalAnimeList.length,
      personalUpdated: personalSyncStats.updated,
      personalSkipped: personalSyncStats.skipped,
      personalFailed: personalSyncStats.failed,
    });

    res.json({
      success: true,
      seasonalSync: {
        syncedCount: allAnime.length,
        currentSeason: current,
        previousSeason: previous,
      },
      personalStatusSync: {
        processed: personalSyncStats.totalProcessed,
        updated: personalSyncStats.updated,
        skipped: personalSyncStats.skipped,
        failed: personalSyncStats.failed,
        changes: personalSyncStats.updates,
      },
      metadata: getSyncMetadata(),
    });

  } catch (error) {
    console.error('Sync error:', error);
    appendLog('sync', 'error', 'Sync failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to sync anime data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
