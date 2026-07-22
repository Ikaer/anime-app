import { NextApiRequest, NextApiResponse } from 'next';
import { getValidMalToken } from '@/lib/providers/mal/client';
import { performRecommendationsRefresh, isRecommendationsRefreshRunning, RecoRefreshProgress } from '@/lib/reco/refresh';

// Store ongoing refresh processes (mirrors big-sync.ts).
const refreshProcesses = new Map<string, {
  isRunning: boolean;
  progress: RecoRefreshProgress[];
}>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    return handleStartRefresh(req, res);
  } else if (req.method === 'GET') {
    return handleEventStream(req, res);
  } else {
    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }
}

async function handleStartRefresh(req: NextApiRequest, res: NextApiResponse) {
  try {
    // MAL is OPTIONAL here, deliberately — do NOT add a `requireMalAuth` gate.
    // The engine needs MAL *ids* (which AniList supplies for free), not a MAL
    // *session*, so a 401 here would make the whole feed unreachable without a
    // MAL account. With no token the refresh runs on the anonymous AniList crowd
    // source alone and reports which pipes it skipped.
    const token = getValidMalToken();

    // Spec §7.2: reject concurrent refreshes with 409.
    if (isRecommendationsRefreshRunning()) {
      return res.status(409).json({ error: 'A recommendations refresh is already running' });
    }

    const nicheMode = String(req.query.nicheMode || '').toLowerCase() === 'true';
    const thrRaw = req.query.threshold;
    const threshold = typeof thrRaw === 'string' && thrRaw.trim() !== '' ? parseInt(thrRaw, 10) : null;

    const syncId = `reco_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const proc = { isRunning: true, progress: [] as RecoRefreshProgress[] };
    refreshProcesses.set(syncId, proc);

    // Run asynchronously; the module-level lock inside the lib returns
    // alreadyRunning if a refresh is already in flight.
    performRecommendationsRefresh(
      token?.access_token ?? null,
      { nicheMode, threshold: Number.isFinite(threshold as number) ? threshold : null },
      (p) => {
        proc.progress.push(p);
        if (proc.progress.length > 100) proc.progress = proc.progress.slice(-50);
      }
    )
      .then((result) => {
        if (result.alreadyRunning) {
          proc.progress.push({ type: 'error', error: 'A refresh is already running', details: 'alreadyRunning' });
        }
      })
      .catch((error) => {
        proc.progress.push({ type: 'error', error: 'Refresh failed', details: error instanceof Error ? error.message : 'Unknown error' });
      })
      .finally(() => { proc.isRunning = false; });

    return res.status(200).json({ message: 'Recommendations refresh started', syncId });
  } catch (error) {
    console.error('Error starting recommendations refresh:', error);
    res.status(500).json({ error: 'Failed to start refresh', details: error instanceof Error ? error.message : 'Unknown error' });
  }
}

async function handleEventStream(req: NextApiRequest, res: NextApiResponse) {
  const { syncId } = req.query;
  if (!syncId || typeof syncId !== 'string') {
    return res.status(400).json({ error: 'syncId is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
  });

  const proc = refreshProcesses.get(syncId);
  if (!proc) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: 'Refresh process not found' })}\n\n`);
    res.end();
    return;
  }

  let lastSentIndex = -1;
  // Declared before flush so an early terminal event (already-finished refresh)
  // can clear it safely — avoids a TDZ ReferenceError on the fast-finish path.
  let intervalId: ReturnType<typeof setInterval> | undefined;

  const flush = () => {
    for (let i = lastSentIndex + 1; i < proc.progress.length; i++) {
      res.write(`data: ${JSON.stringify(proc.progress[i])}\n\n`);
      lastSentIndex = i;
      const p = proc.progress[i];
      if (p.type === 'complete' || p.type === 'error') {
        if (intervalId) clearInterval(intervalId);
        setTimeout(() => refreshProcesses.delete(syncId), 30000);
        res.end();
        return true;
      }
    }
    return false;
  };

  if (flush()) return;

  intervalId = setInterval(() => {
    const current = refreshProcesses.get(syncId);
    if (!current) {
      clearInterval(intervalId);
      res.end();
      return;
    }
    if (flush()) return;
    if (!current.isRunning && lastSentIndex >= current.progress.length - 1) {
      clearInterval(intervalId);
      res.end();
    }
  }, 1000);

  req.on('close', () => clearInterval(intervalId));
}
