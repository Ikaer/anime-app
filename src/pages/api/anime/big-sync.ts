import { NextApiRequest, NextApiResponse } from 'next';
import { getMALAuthData, isMALTokenValid, getSyncMetadata, performBigSync, BigSyncProgress } from '@/lib/anime';

// Store ongoing big sync processes
const syncProcesses = new Map<string, {
  isRunning: boolean;
  progress: any[];
  latestProgressIndex: number;
}>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return handleStartBigSync(req, res);
  } else if (req.method === 'GET') {
    return handleEventStream(req, res);
  } else {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
}

async function handleStartBigSync(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Check authentication
    const { token } = getMALAuthData();
    if (!token || !isMALTokenValid(token)) {
      return res.status(401).json({ error: 'Not authenticated with MAL' });
    }

    // Generate a unique sync ID
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Initialize sync process
    syncProcesses.set(syncId, { isRunning: true, progress: [], latestProgressIndex: -1 });

    // Start the sync process asynchronously
    performBigSyncAsync(token.access_token, syncId);

    return res.status(200).json({
      message: 'Big sync started',
      syncId
    });

  } catch (error) {
    console.error('Error starting big sync:', error);
    res.status(500).json({
      error: 'Failed to start big sync',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

async function handleEventStream(req: NextApiRequest, res: NextApiResponse) {
  const { syncId } = req.query;

  if (!syncId || typeof syncId !== 'string') {
    return res.status(400).json({ error: 'syncId is required' });
  }

  // Set up Server-Sent Events
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  const syncProcess = syncProcesses.get(syncId);
  if (!syncProcess) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Sync process not found' })}\n\n`);
    res.end();
    return;
  }

  let lastSentIndex = -1;

  // Send existing progress
  for (let i = 0; i < syncProcess.progress.length; i++) {
    res.write(`data: ${JSON.stringify(syncProcess.progress[i])}\n\n`);
    lastSentIndex = i;
  }

  // Set up interval to check for new progress
  const intervalId = setInterval(() => {
    const currentProcess = syncProcesses.get(syncId);
    if (!currentProcess) {
      clearInterval(intervalId);
      res.end();
      return;
    }

    // Send any new progress updates
    for (let i = lastSentIndex + 1; i < currentProcess.progress.length; i++) {
      res.write(`data: ${JSON.stringify(currentProcess.progress[i])}\n\n`);
      lastSentIndex = i;

      // Check if this is the final update
      const progress = currentProcess.progress[i];
      if (progress.type === 'complete' || progress.type === 'error') {
        clearInterval(intervalId);
        // Clean up after a delay
        setTimeout(() => syncProcesses.delete(syncId), 30000);
        res.end();
        return;
      }
    }

    if (!currentProcess.isRunning && lastSentIndex >= currentProcess.progress.length - 1) {
      clearInterval(intervalId);
      res.end();
    }
  }, 1000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(intervalId);
  });
}

async function performBigSyncAsync(accessToken: string, syncId: string) {
  const addProgress = (progress: BigSyncProgress) => {
    const syncProcess = syncProcesses.get(syncId);
    if (syncProcess) {
      syncProcess.progress.push(progress);
      // Keep only the last 100 progress updates to prevent memory leaks
      if (syncProcess.progress.length > 100) {
        syncProcess.progress = syncProcess.progress.slice(-50);
      }
    }
  };

  try {
    await performBigSync(accessToken, addProgress);
  } catch (error) {
    console.error(`Big sync ${syncId} error:`, error);
    addProgress({
      type: 'error',
      error: 'Failed to perform big sync',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    const syncProcess = syncProcesses.get(syncId);
    if (syncProcess) {
      syncProcess.isRunning = false;
    }
  }
}
