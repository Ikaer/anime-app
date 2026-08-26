import { NextApiRequest, NextApiResponse } from 'next';
import { isCronSyncRunning, runCronSync } from '@/lib/providers/cronSync';
import { getCronHealth } from '@/lib/providers/cronHealth';
import { computeCronFreshness } from '@/lib/domain/cronFreshness';

/**
 * Run the scheduled sync **now**, from the `/connections` button — the same nine
 * steps `/api/anime/cron-sync` runs at 02:00, via the same `runCronSync`.
 *
 * **Ungated, and for a narrower reason than the other buttons on that page.**
 * meta-sync / catalog-crawl / catalog-sweep are ungated because AniList's
 * catalog role's auth kind is `anonymous` (E4) — that justification does NOT
 * carry here, since `runCronSync` includes `anilistPush`, the one provider
 * *write* this app makes outside a user-initiated edit. It is ungated because
 * this route IS the user-initiated edit: a single-user app on a LAN NAS, where
 * pressing the button is the authorization. Do not generalize either reason to
 * the other set of routes.
 *
 * Fire-and-forget, the house idiom for anything past a request timeout (the run
 * is minutes: a MAL historical crawl, a SIMKL delta, an AniList push and a reco
 * refresh). Progress surfaces through `appendLog('cron-sync', …)`, which the
 * connection log panel beside the button already polls — the same transport
 * meta-sync, the cast sweep and the catalog crawl use. The run lock lives in
 * `runCronSync` itself, so a press during the 02:00 tick is a no-op rather than
 * a doubled run.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    // Freshness rides on the endpoint the page ALREADY polls for `running`, so
    // the indicator costs no extra fetch and the two facts — is a run in
    // flight, and did the scheduled one land — arrive together.
    return res.status(200).json({
      running: isCronSyncRunning(),
      freshness: computeCronFreshness(getCronHealth(), Date.now()),
    });
  }

  if (req.method === 'POST') {
    if (isCronSyncRunning()) {
      return res.status(200).json({ started: false, alreadyRunning: true });
    }
    // Not awaited. `runCronSync` never rejects (every step is wrapped), but the
    // catch keeps an unhandled rejection out of the process if that ever changes.
    // `manual`, and the freshness verdict ignores it on purpose: a button press
    // must not report the 02:00 job as alive.
    void runCronSync('manual').catch(error => console.error('Manual cron sync failed:', error));
    return res.status(200).json({ started: true, alreadyRunning: false });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
}
