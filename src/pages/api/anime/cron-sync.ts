import { NextApiRequest, NextApiResponse } from 'next';
import { getMALAuthData, isMALTokenValid } from '@/lib/mal';
import { performHistoricalCrawl } from '@/lib/malSync';
import {
  getRecommendationsData,
  isRecommendationsRefreshRunning,
  performRecommendationsRefresh,
} from '@/lib/recommendations';
import { appendLog } from '@/lib/connectionLog';

/**
 * Cron entry point. This route deliberately does NOT live under
 * `/api/anime/mal/`: it is invoked by an external cron job on the NAS (see
 * docker-compose.yml) with `CRON_SECRET`, so its path is configuration outside
 * this repo. It also spans more than MAL — it triggers the recommendations
 * refresh too.
 *
 * Simplified version of the big-sync trigger: no SSE, since nothing is
 * listening.
 */

async function startBigSync() {
  try {
    const response = await fetch('http://localhost:3000/api/anime/mal/big-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to start big sync');
    }

    const data = await response.json();
    console.log('Cron sync started:', data.syncId);
    return data;
  } catch (error) {
    console.error('Error in cron-sync when starting big sync:', error);
    throw error;
  }
}

// Recompute the recommendations feed on the cron tick. No SSE — fire-and-forget
// like the rest of cron-sync; just log start/result. Reuses the last-known
// nicheMode/threshold (no user present to supply request params) and yields to a
// manual refresh already in flight via the shared lock.
async function refreshRecommendations(accessToken: string) {
  if (isRecommendationsRefreshRunning()) {
    appendLog('cron-sync', 'info', 'Cron sync skipped reco refresh: a refresh is already running');
    return;
  }

  const { nicheMode, seedThreshold } = getRecommendationsData();
  appendLog('cron-sync', 'info', 'Cron sync started recommendations refresh', { nicheMode, seedThreshold });

  try {
    const result = await performRecommendationsRefresh(accessToken, { nicheMode, threshold: seedThreshold });
    if (result.alreadyRunning) {
      appendLog('cron-sync', 'info', 'Cron sync reco refresh skipped: already running');
      return;
    }
    console.log(
      `Reco refresh: ${result.seedCount} seeds, ${result.edgeCount} edges, ${result.hydratedCount} hydrated`
    );
    appendLog('cron-sync', 'success', 'Cron sync completed recommendations refresh', {
      seedCount: result.seedCount,
      edgeCount: result.edgeCount,
      hydratedCount: result.hydratedCount,
    });
  } catch (error) {
    // Non-fatal: the reco refresh is best-effort and must not fail the cron run.
    console.error('Cron sync reco refresh failed:', error);
    appendLog('cron-sync', 'error', 'Cron sync recommendations refresh failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Basic security check: can be improved with a secret key
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  appendLog('cron-sync', 'info', 'Cron sync run started');

  try {
    // Check MAL authentication status before starting
    const { token } = getMALAuthData();
    if (!token || !isMALTokenValid(token)) {
      // Here you might want to implement logic to refresh the token automatically
      // For now, we just log and fail if not valid
      console.error('Cron sync cannot run: MAL token is invalid or missing.');
      appendLog('cron-sync', 'error', 'Cron sync aborted: MAL token invalid or missing');
      return res.status(400).json({ error: 'MAL token is invalid or missing. Cannot start sync.' });
    }

    const bigSyncData = await startBigSync();
    appendLog('cron-sync', 'info', 'Cron sync triggered big sync', { syncId: bigSyncData.syncId });

    // Crawl a small batch of historical seasons after big-sync fires
    const crawlResult = await performHistoricalCrawl(token.access_token);
    console.log(
      `Historical crawl: ${crawlResult.processedSeasons} seasons, ${crawlResult.syncedCount} anime, ${crawlResult.stats.remaining} remaining`
    );
    // Recompute the recommendations feed with the freshly-synced data.
    await refreshRecommendations(token.access_token);

    appendLog('cron-sync', 'success', 'Cron sync run completed', {
      processedSeasons: crawlResult.processedSeasons,
      syncedCount: crawlResult.syncedCount,
      remaining: crawlResult.stats.remaining,
    });

    res.status(200).json({
      message: 'Cron sync process initiated successfully.',
      historicalCrawl: {
        processedSeasons: crawlResult.processedSeasons,
        syncedCount: crawlResult.syncedCount,
        remaining: crawlResult.stats.remaining,
      },
    });
  } catch (error) {
    console.error('Cron sync handler failed:', error);
    appendLog('cron-sync', 'error', 'Cron sync run failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    res.status(500).json({
      error: 'Failed to initiate cron sync',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
