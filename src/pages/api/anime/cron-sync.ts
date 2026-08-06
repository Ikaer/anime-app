import { NextApiRequest, NextApiResponse } from 'next';
import { runCronSync } from '@/lib/providers/cronSync';
import { appendLog } from '@/lib/config/connectionLog';
import { getCronSecret } from '@/lib/config/settings';

/**
 * Cron entry point — the **authenticated** door onto `runCronSync`.
 *
 * This route deliberately does NOT live under `/api/anime/mal/`: it is invoked
 * by an external cron job on the NAS (see docker-compose.yml) with
 * `CRON_SECRET`, so its path is configuration outside this repo. It also spans
 * every provider.
 *
 * The orchestration itself lives in `lib/providers/cronSync.ts` because it has a
 * second, unauthenticated entry point — `/api/anime/sync-now`, behind the
 * `/connections` button. This file is now only the secret check plus the
 * response shape the NAS cron job sees.
 *
 * Simplified version of the big-sync trigger: no SSE, since nothing is
 * listening.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Both rejections below LOG before returning, and that is the point: they are
  // the only paths out of this handler that produce no run, and a silent one is
  // indistinguishable from a cron job that isn't scheduled at all. Live case:
  // a `cronSecret` saved in settings.json overrode the env var the compose cron
  // container still sent, so every 02:00 call 401'd for 11 days with nothing in
  // the log the Connections panel polls. Volume is a non-issue — the caller is
  // one nightly curl on the LAN.
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    appendLog('cron-sync', 'error', `Cron sync rejected: method ${req.method} not allowed (expected POST)`, {
      method: req.method,
    });
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Basic security check: can be improved with a secret key
  const authHeader = req.headers.authorization;
  const cronSecret = getCronSecret();
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Never log either secret — only which of the two failure shapes it is, which
    // is what distinguishes "cron sends no header" from "the values disagree".
    appendLog('cron-sync', 'error', authHeader
      ? 'Cron sync rejected: Authorization header does not match the configured cron secret'
      : 'Cron sync rejected: no Authorization header sent', { hadAuthHeader: !!authHeader });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const result = await runCronSync();

  // A run already in flight (the /connections button, or a previous tick that
  // overran) is a normal outcome, not a failure — the work is happening.
  if (result.alreadyRunning) {
    return res.status(200).json({ message: 'Cron sync already running.', alreadyRunning: true });
  }

  // 200 even with a failed step: the run itself happened, and the per-step
  // outcomes carry the truth. A non-2xx would tell the NAS cron job "nothing
  // ran", which is exactly the conflation F1 removes.
  res.status(200).json({ message: 'Cron sync process completed.', steps: result.steps });
}
