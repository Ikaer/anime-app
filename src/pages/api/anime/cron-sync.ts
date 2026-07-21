import { NextApiRequest, NextApiResponse } from 'next';
import { getValidMalToken } from '@/lib/providers/mal/client';
import { performHistoricalCrawl } from '@/lib/providers/mal/sync';
import { performSimklSync } from '@/lib/providers/simkl/sync';
import { importAnilistPersonalList } from '@/lib/providers/anilist/personalSync';
import { isAnilistMetaSyncRunning, performAnilistMetaSync } from '@/lib/providers/anilist/sync';
import { isPersonalProviderEnabled } from '@/lib/providers/registry';
import { isRecommendationsRefreshRunning, performRecommendationsRefresh } from '@/lib/reco/refresh';
import { getRecommendationsData } from '@/lib/reco/data';
import { appendLog } from '@/lib/config/connectionLog';
import { getCronSecret } from '@/lib/config/settings';

/**
 * Cron entry point. This route deliberately does NOT live under
 * `/api/anime/mal/`: it is invoked by an external cron job on the NAS (see
 * docker-compose.yml) with `CRON_SECRET`, so its path is configuration outside
 * this repo. It also spans every provider — it is the one place scheduled work
 * is orchestrated.
 *
 * Simplified version of the big-sync trigger: no SSE, since nothing is
 * listening.
 *
 * **Not a generic loop** (docs/PROVIDER-PARITY.md F1, and
 * PROVIDER-ABSTRACTION.md's verdict): MAL's seasonal crawl, SIMKL's two-phase
 * delta and AniList's GraphQL batch are genuinely different operations. What is
 * uniform is *enablement* and *reporting* — each block is guarded by the one
 * enablement predicate (`isPersonalProviderEnabled`) or by its role's auth
 * requirement, and each returns a `CronStepOutcome`. Every block is isolated and
 * non-fatal: one provider failing must not cost the others their tick.
 *
 * **No provider gates the run.** Until F1 the handler returned 400 when the MAL
 * token was missing or expired, so a SIMKL-only, AniList-only or keyless install
 * got nothing at all from cron — including the recommendations refresh, which
 * B4 had already made MAL-optional. That gate is gone; MAL is one skippable step
 * among several.
 */

/**
 * Per-step outcome, mirroring `RecoRefreshSources`: a step that did not run says
 * so with a reason, so a degraded tick is *declared* rather than merely thinner.
 * `skipped` = deliberately not applicable (no account); `ok: false` = it was
 * supposed to run and did not.
 */
interface CronStepOutcome {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
}

type CronSteps = Record<
  'malCatalog' | 'simklPersonal' | 'anilistPersonal' | 'anilistCatalog' | 'recommendations',
  CronStepOutcome
>;

const notConnected = (label: string): CronStepOutcome => ({
  ok: true,
  skipped: true,
  reason: `No ${label} account connected`,
});

/** Run a step, converting a throw into a reported failure. Never rethrows. */
async function step(name: string, run: () => Promise<CronStepOutcome>): Promise<CronStepOutcome> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`Cron sync step "${name}" failed:`, error);
    appendLog('cron-sync', 'error', `Cron sync step "${name}" failed`, { error: message });
    return { ok: false, reason: message };
  }
}

async function startBigSync() {
  const response = await fetch('http://localhost:3000/api/anime/mal/big-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to start big sync');
  }

  const data = await response.json();
  console.log('Cron sync started:', data.syncId);
  return data;
}

/**
 * MAL's **catalog** role: big-sync (fire-and-forget over HTTP, since the route
 * owns the run lock and the SSE plumbing) plus a 5-season historical crawl.
 * MAL's personal list rides along — the seasonal payload carries
 * `my_list_status`, which `upsertAnime` splits into the personal slice.
 */
async function syncMal(): Promise<CronStepOutcome> {
  if (!isPersonalProviderEnabled('mal')) return notConnected('MAL');

  const token = getValidMalToken();
  if (!token) {
    // Connected but lapsed — an actionable state, not the same as absent. There
    // is no refresh path here, so report it rather than silently skipping.
    appendLog('cron-sync', 'error', 'Cron sync skipped MAL: token expired');
    return { ok: false, reason: 'MAL token expired — re-authenticate' };
  }

  const bigSyncData = await startBigSync();
  appendLog('cron-sync', 'info', 'Cron sync triggered big sync', { syncId: bigSyncData.syncId });

  const crawl = await performHistoricalCrawl(token.access_token);
  console.log(
    `Historical crawl: ${crawl.processedSeasons} seasons, ${crawl.syncedCount} anime, ${crawl.stats.remaining} remaining`
  );
  return {
    ok: true,
    detail: {
      syncId: bigSyncData.syncId,
      processedSeasons: crawl.processedSeasons,
      syncedCount: crawl.syncedCount,
      remaining: crawl.stats.remaining,
    },
  };
}

/** SIMKL's personal delta — the two-phase `activities` + `date_from` sync. */
async function syncSimkl(): Promise<CronStepOutcome> {
  if (!isPersonalProviderEnabled('simkl')) return notConnected('SIMKL');

  const result = await performSimklSync();
  if (!result.ok) {
    appendLog('cron-sync', 'error', 'Cron sync SIMKL delta failed', { error: result.error });
    return { ok: false, reason: result.error };
  }
  appendLog('cron-sync', 'success', `Cron sync completed SIMKL delta (${result.phase})`, {
    phase: result.phase,
    added: result.added,
    removed: result.removed,
  });
  return {
    ok: true,
    detail: { phase: result.phase, added: result.added, removed: result.removed },
  };
}

/** AniList's personal role: a full-replace import of the OAuth'd viewer's list. */
async function syncAnilistPersonal(): Promise<CronStepOutcome> {
  if (!isPersonalProviderEnabled('anilist')) return notConnected('AniList');

  const result = await importAnilistPersonalList();
  if (!result.ok) {
    appendLog('cron-sync', 'error', 'Cron sync AniList list import failed', { error: result.error });
    return { ok: false, reason: result.error };
  }
  appendLog('cron-sync', 'success', `Cron sync imported ${result.imported} AniList entries`, {
    imported: result.imported,
    skippedNoMal: result.skippedNoMal,
  });
  return { ok: true, detail: { imported: result.imported, skippedNoMal: result.skippedNoMal } };
}

/**
 * AniList's **catalog** role — tags / staff / banner / relations. Deliberately
 * ungated: this role's auth kind is `anonymous`, so it runs on an install with
 * no account of any kind, which is the whole keyless promise. Gating it on the
 * AniList *account* is E4's mistake in orchestration form.
 *
 * Fire-and-forget, like the route that backs the Connections button: it is
 * incremental but unbounded (a fresh catalog is thousands of throttled batches),
 * and awaiting it here would put every later tick's SIMKL delta behind it.
 * Progress goes to its own `anilist-meta-sync` log channel.
 */
function syncAnilistCatalog(): CronStepOutcome {
  if (isAnilistMetaSyncRunning()) {
    return { ok: true, skipped: true, reason: 'A metadata sync is already running' };
  }
  performAnilistMetaSync();
  appendLog('cron-sync', 'info', 'Cron sync started AniList metadata sync');
  return { ok: true, detail: { started: true } };
}

/**
 * Recompute the recommendations feed. No SSE — fire-and-forget like the rest of
 * cron-sync; just log start/result. Reuses the last-known nicheMode/threshold
 * (no user present to supply request params) and yields to a manual refresh
 * already in flight via the shared lock.
 *
 * The MAL token is **optional** (B4): with `null` the two MAL sources are
 * skipped and the anonymous AniList crowd source carries the feed alone.
 */
async function refreshRecommendations(accessToken: string | null): Promise<CronStepOutcome> {
  if (isRecommendationsRefreshRunning()) {
    appendLog('cron-sync', 'info', 'Cron sync skipped reco refresh: a refresh is already running');
    return { ok: true, skipped: true, reason: 'A refresh is already running' };
  }

  const { nicheMode, seedThreshold } = getRecommendationsData();
  appendLog('cron-sync', 'info', 'Cron sync started recommendations refresh', { nicheMode, seedThreshold });

  const result = await performRecommendationsRefresh(accessToken, { nicheMode, threshold: seedThreshold });
  if (result.alreadyRunning) {
    appendLog('cron-sync', 'info', 'Cron sync reco refresh skipped: already running');
    return { ok: true, skipped: true, reason: 'A refresh is already running' };
  }
  console.log(
    `Reco refresh: ${result.seedCount} seeds, ${result.edgeCount} edges, ${result.hydratedCount} hydrated`
  );
  appendLog('cron-sync', 'success', 'Cron sync completed recommendations refresh', {
    seedCount: result.seedCount,
    edgeCount: result.edgeCount,
    hydratedCount: result.hydratedCount,
  });
  return {
    ok: true,
    detail: {
      seedCount: result.seedCount,
      edgeCount: result.edgeCount,
      hydratedCount: result.hydratedCount,
      sources: result.sources,
    },
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Basic security check: can be improved with a secret key
  const authHeader = req.headers.authorization;
  const cronSecret = getCronSecret();
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  appendLog('cron-sync', 'info', 'Cron sync run started');

  // Data pulls first, in provider order, each isolated. Then the recommendations
  // refresh, which consumes what they landed.
  const steps = {} as CronSteps;
  steps.malCatalog = await step('mal', syncMal);
  steps.simklPersonal = await step('simkl', syncSimkl);
  steps.anilistPersonal = await step('anilist-personal', syncAnilistPersonal);

  // MAL is optional here (B4): with no valid token the refresh skips its two MAL
  // sources and runs on the anonymous AniList crowd source alone.
  const malToken = getValidMalToken();
  steps.recommendations = await step('recommendations', () =>
    refreshRecommendations(malToken ? malToken.access_token : null)
  );

  // Started LAST, after the reco refresh has finished with AniList: both throttle
  // against the same per-IP rate limit, and the metadata sweep is the one that
  // can run for minutes.
  steps.anilistCatalog = await step('anilist-catalog', async () => syncAnilistCatalog());

  const failed = Object.entries(steps).filter(([, s]) => !s.ok).map(([name]) => name);
  appendLog(
    'cron-sync',
    failed.length ? 'error' : 'success',
    failed.length ? `Cron sync run completed with failures: ${failed.join(', ')}` : 'Cron sync run completed',
    { steps }
  );

  // 200 even with a failed step: the run itself happened, and the per-step
  // outcomes carry the truth. A non-2xx would tell the NAS cron job "nothing
  // ran", which is exactly the conflation F1 removes.
  res.status(200).json({ message: 'Cron sync process completed.', steps });
}
