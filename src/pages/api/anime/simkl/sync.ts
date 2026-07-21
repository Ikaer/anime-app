import { NextApiRequest, NextApiResponse } from 'next';
import { performSimklSync } from '@/lib/providers/simkl/sync';
import { appendLog } from '@/lib/connectionLog';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    return;
  }
  const result = await performSimklSync();

  if (result.ok) {
    appendLog('simkl-sync', 'success', `SIMKL sync (${result.phase}) completed`, {
      phase: result.phase,
      added: result.added,
      removed: result.removed,
      orphansSkipped: result.orphansSkipped,
    });
  } else {
    appendLog('simkl-sync', 'error', 'SIMKL sync failed', { error: result.error });
  }

  res.status(result.ok ? 200 : 500).json(result);
}
