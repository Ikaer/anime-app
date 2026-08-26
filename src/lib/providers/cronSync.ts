/**
 * The scheduled-work orchestration — nine steps spanning every provider.
 *
 * **This is a lib module, not a route, because it has TWO entry points**: the
 * NAS cron job (`POST /api/anime/cron-sync`, secret-authenticated) and the
 * "Tout synchroniser" button on `/connections` (`POST /api/anime/sync-now`,
 * ungated). The alternative — having the button fetch the cron route over
 * localhost with the secret attached, the way `startBigSync` below does for
 * big-sync — was rejected: it reintroduces the exact failure this module's
 * history is about (a secret that must match in two places, plus a hardcoded
 * `localhost:3000` that is wrong the moment the published port moves).
 * `startBigSync` keeps its hop because that route owns a run lock and an SSE
 * stream; this orchestration owns nothing that could not move here.
 *
 * **Not a generic loop**: MAL's seasonal crawl, SIMKL's two-phase delta and
 * AniList's GraphQL batch are genuinely different operations. What is uniform is
 * *enablement* and *reporting* — each block is guarded by the one enablement
 * predicate (`isPersonalProviderEnabled`) or by its role's auth requirement, and
 * each returns a `CronStepOutcome`. Every block is isolated and non-fatal: one
 * provider failing must not cost the others their tick.
 *
 * **All but one step READS.** `anilistPush` is the exception, and the only place
 * this app writes to a provider outside a user-initiated edit — see its comment
 * for why a scheduled write earns its place.
 *
 * **No provider gates the run.** Do not put an auth check in front of
 * `runCronSync`: a MAL-token gate costs a SIMKL-only, AniList-only or keyless
 * install its entire tick, including the recommendations refresh, which needs no
 * MAL account. MAL is one skippable step among several.
 *
 * Server-only.
 */
import { getValidMalToken } from '@/lib/providers/mal/client';
import { performHistoricalCrawl } from '@/lib/providers/mal/sync';
import { performSimklSync } from '@/lib/providers/simkl/sync';
import { importAnilistPersonalList } from '@/lib/providers/anilist/personalSync';
import { performAnilistPersonalPush } from '@/lib/providers/anilist/push';
import {
  isAnilistMetaSyncRunning,
  performAnilistMetaSync,
  isAnilistCatalogSweepRunning,
  performAnilistCatalogSweep,
  performAnilistCatalogCrawl,
  performAnilistHistoricalCrawl,
} from '@/lib/providers/anilist/sync';
import { isPersonalProviderEnabled } from '@/lib/providers/registry';
import { isRecommendationsRefreshRunning, performRecommendationsRefresh } from '@/lib/reco/refresh';
import { getRecommendationsData } from '@/lib/reco/data';
import { appendLog } from '@/lib/config/connectionLog';
import { recordCronRun } from '@/lib/providers/cronHealth';

/**
 * Per-step outcome, mirroring `RecoRefreshSources`: a step that did not run says
 * so with a reason, so a degraded tick is *declared* rather than merely thinner.
 * `skipped` = deliberately not applicable (no account); `ok: false` = it was
 * supposed to run and did not.
 */
export interface CronStepOutcome {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  detail?: Record<string, unknown>;
}

export type CronStepName =
  | 'malCatalog'
  | 'simklPersonal'
  | 'anilistPersonal'
  | 'anilistPush'
  | 'anilistDiscovery'
  | 'anilistHistorical'
  | 'anilistCatalog'
  | 'anilistCatalogFields'
  | 'recommendations';

export type CronSteps = Record<CronStepName, CronStepOutcome>;

/** Which entry point started a run — the cron door, or the /connections button. */
export type CronTrigger = 'cron' | 'manual';

export interface CronSyncResult {
  /** True when another run held the lock and this call did nothing. */
  alreadyRunning: boolean;
  /** Absent on an `alreadyRunning` return — no steps ran to report on. */
  steps?: CronSteps;
  /** Step names whose `ok` was false. Empty on a clean run. */
  failed?: string[];
}

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
 * AniList's personal role, WRITE half — push local state up to AniList.
 *
 * `writers.ts` already mirrors every edit made *in this app* to AniList, so this
 * step exists for the edits that never pass through it: a rating made directly
 * on the SIMKL website arrives here via the SIMKL delta above and would
 * otherwise sit in the local record forever, with AniList drifting until someone
 * pressed the Connections button. Scheduling the sweep is what makes SIMKL →
 * AniList an automatic path rather than a manual one.
 *
 * **Ordering is the point**: it runs after the SIMKL delta (which lands the new
 * ratings) and after the AniList import (a full-replace write that would
 * otherwise clobber the slice updates `reflectLocally` makes as it pushes).
 * One ordering it does NOT get is against MAL: `startBigSync` is
 * fire-and-forget over HTTP, so `upsertAnime` is still splitting `my_list_status`
 * into `personal/mal.json` while this reads `getEffective*`. That race is
 * benign and left alone — MAL sits *below* SIMKL in personal precedence, so a
 * late MAL write can only move the effective value on a title SIMKL doesn't
 * hold, and the next tick's fresh `buildQueue` diff pushes it then.
 *
 * Awaited and uncapped, unlike the two fire-and-forget sweeps at the end. It can
 * afford to be: `buildQueue` diffs against a fresh remote read and pushes only
 * what actually differs, so a converged install spends ONE GraphQL request per
 * tick and writes nothing. A day's worth of SIMKL ratings is a handful of
 * throttled writes. Only the first-ever run is long, and it is resumable by
 * construction — an interrupted sweep just finds fewer disagreements next time.
 */
async function pushAnilist(): Promise<CronStepOutcome> {
  if (!isPersonalProviderEnabled('anilist')) return notConnected('AniList');

  const result = await performAnilistPersonalPush();
  if (result.alreadyRunning) {
    // The Connections button holds the same lock — a normal outcome, not a miss.
    return { ok: true, skipped: true, reason: 'A push is already running' };
  }
  if (!result.ok) {
    appendLog('cron-sync', 'error', 'Cron sync AniList push failed', { error: result.error });
    return { ok: false, reason: result.error };
  }
  // Nothing queued is the converged steady state, and the common case — say so
  // rather than reporting a run that wrote nothing as if it had done work.
  if (result.queued === 0) {
    return { ok: true, detail: { queued: 0, pushed: 0, failed: 0, inSync: true } };
  }
  appendLog(
    'cron-sync',
    'success',
    `Cron sync pushed ${result.pushed} entries to AniList (${result.failed} failed of ${result.queued} queued)`,
    { queued: result.queued, pushed: result.pushed, failed: result.failed }
  );
  return {
    ok: true,
    detail: { queued: result.queued, pushed: result.pushed, failed: result.failed },
  };
}

/**
 * AniList's **catalog** role, discovery half — a bounded current-season crawl of
 * AniList's own catalog.
 *
 * This step exists because of E8. AniList is now queried only by AniList ids, so
 * a title enters the enrichment queue only once its AniList id is in the
 * crosswalk — and the ONLY thing that puts it there is an AniList-native call
 * returning `id` alongside `idMal`. Without a recurring crawl, every title MAL's
 * seasonal sync adds from here on would be permanently invisible to AniList
 * enrichment. The MAL-id bridge used to paper over that; removing it makes
 * discovery a scheduled job rather than an accident.
 *
 * Cheap and bounded: the current season only, ≤8 pages, and `crawlCatalogSeason`
 * stops early on `hasNextPage: false` — so a handful of requests per tick
 * against the same throttle everything else shares. Awaited (unlike the two
 * sweeps below) precisely so the metadata sync that follows sees the ids it
 * just landed.
 *
 * Depth beyond the current season is NOT this step's job — that is
 * `syncAnilistHistorical` below, which walks the back catalog by year.
 */
async function syncAnilistDiscovery(): Promise<CronStepOutcome> {
  const result = await performAnilistCatalogCrawl(undefined, undefined, 8);
  if (result.alreadyRunning) {
    return { ok: true, skipped: true, reason: 'A catalog crawl is already running' };
  }
  if (!result.ok) {
    appendLog('cron-sync', 'error', 'Cron sync AniList season crawl failed', { error: result.error });
    return { ok: false, reason: result.error };
  }
  appendLog(
    'cron-sync',
    'success',
    `Cron sync crawled AniList ${result.season} ${result.seasonYear}: ${result.withMal} with a MAL id, ${result.anilistOnlyMinted} minted`,
    { season: result.season, seasonYear: result.seasonYear, withMal: result.withMal }
  );
  return {
    ok: true,
    detail: {
      season: result.season,
      seasonYear: result.seasonYear,
      pagesFetched: result.pagesFetched,
      withMal: result.withMal,
      anilistOnlyMinted: result.anilistOnlyMinted,
    },
  };
}

/**
 * The back catalog, a few years per tick, walking 1960-ward from just outside
 * the bulk crawl's window. Checkpointed in `sync/anilist_years.json`, so this
 * converges and then costs one cheap no-op call per run forever after.
 *
 * Bounded to `HISTORICAL_YEARS_PER_TICK` for the same reason MAL's historical
 * crawl takes 5 seasons: a tick should stay short. The whole window is only
 * ~12 minutes, so anyone who wants it *now* presses the Connections button,
 * which runs it uncapped — this step is the version that needs nobody watching.
 *
 * Ungated (AniList's catalog role is anonymous) and **awaited before the
 * enrichment sweeps**, same reasoning as discovery: the ids it lands are what
 * they queue on. `alreadyRunning` is a normal outcome here, since the uncapped
 * button run holds the same lock.
 */
const HISTORICAL_YEARS_PER_TICK = 3;

async function syncAnilistHistorical(): Promise<CronStepOutcome> {
  const result = await performAnilistHistoricalCrawl(HISTORICAL_YEARS_PER_TICK);
  if (result.alreadyRunning) {
    return { ok: true, skipped: true, reason: 'A catalog crawl is already running' };
  }
  if (result.stats.remainingYears === 0 && result.yearsCrawled === 0) {
    return { ok: true, skipped: true, reason: 'Back catalog already crawled' };
  }
  if (!result.ok) {
    appendLog('cron-sync', 'error', 'Cron sync AniList historical crawl failed', { error: result.error });
    return { ok: false, reason: result.error };
  }
  appendLog(
    'cron-sync',
    'success',
    `Cron sync crawled ${result.yearsCrawled} AniList year(s): ${result.titles} titles, ${result.minted} minted — ${result.stats.remainingYears} years remaining`,
    { yearsCrawled: result.yearsCrawled, titles: result.titles, remainingYears: result.stats.remainingYears }
  );
  return {
    ok: true,
    detail: {
      yearsCrawled: result.yearsCrawled,
      titles: result.titles,
      withMal: result.withMal,
      minted: result.minted,
      remainingYears: result.stats.remainingYears,
      oldestSyncedYear: result.stats.oldestSyncedYear,
    },
  };
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
 * AniList's **catalog** role, second half — the `catalog` block sweep (title,
 * synopsis, mean, genres, studios, …) that backfills already-known titles by
 * their AniList id. Same shape as the metadata sync above: ungated (anonymous
 * auth kind), fire-and-forget, its own running flag. Kept a SEPARATE step from
 * the tags/staff sync because it is a different query against a different id
 * space, and its coverage is what unblocks catalog precedence
 * (docs/DECISIONS.md).
 */
function syncAnilistCatalogFields(): CronStepOutcome {
  if (isAnilistCatalogSweepRunning()) {
    return { ok: true, skipped: true, reason: 'A catalog sweep is already running' };
  }
  performAnilistCatalogSweep();
  appendLog('cron-sync', 'info', 'Cron sync started AniList catalog sweep');
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

/**
 * Run lock. It exists because there are now TWO callers — the 02:00 cron and the
 * `/connections` button — and without it a button press during the scheduled run
 * would double every step. It is checked **inside** `runCronSync`, not in the
 * two routes: a per-route check lets each caller pass its own.
 *
 * ⚠️ Holding the lock does NOT mean the whole run has finished. `syncMal` starts
 * big-sync over HTTP and returns as soon as that route accepts, and the last two
 * steps are fire-and-forget by design — so the lock covers the *orchestration*,
 * while those three operations are serialized by their own locks instead.
 */
let isRunning = false;

export function isCronSyncRunning(): boolean {
  return isRunning;
}

/**
 * The whole scheduled run. Isolated, non-fatal steps in a load-bearing order:
 * data pulls first, so the reco refresh consumes what they just landed (measured:
 * 4 seeds keyless vs 274 after the SIMKL + AniList imports on the same store).
 */
/**
 * `trigger` is REQUIRED, not defaulted: the freshness indicator on
 * `/connections` only trusts a scheduled run, so a caller must say which it
 * is. Defaulting to `cron` would let the "Tout synchroniser" button silently
 * report the 02:00 job as healthy — see `domain/cronFreshness.ts`.
 */
export async function runCronSync(trigger: CronTrigger): Promise<CronSyncResult> {
  if (isRunning) {
    appendLog('cron-sync', 'info', 'Cron sync skipped: a run is already in progress');
    return { alreadyRunning: true };
  }
  isRunning = true;

  try {
    appendLog('cron-sync', 'info', 'Cron sync run started');

    const steps = {} as CronSteps;
    steps.malCatalog = await step('mal', syncMal);
    steps.simklPersonal = await step('simkl', syncSimkl);
    steps.anilistPersonal = await step('anilist-personal', syncAnilistPersonal);
    // The only WRITE step in the run, and it goes last among the personal ones: it
    // needs the SIMKL delta's new ratings landed, and it must follow the AniList
    // import, whose full-replace write would clobber the slice updates the push
    // makes as it goes.
    steps.anilistPush = await step('anilist-push', pushAnilist);
    // Before the enrichment sweeps, and awaited: it is what supplies the AniList
    // ids they queue on. Ungated for the same reason they are — AniList's catalog
    // role is anonymous.
    steps.anilistDiscovery = await step('anilist-discovery', syncAnilistDiscovery);
    steps.anilistHistorical = await step('anilist-historical', syncAnilistHistorical);

    // MAL is optional here (B4): with no valid token the refresh skips its two MAL
    // sources and runs on the anonymous AniList crowd source alone.
    const malToken = getValidMalToken();
    steps.recommendations = await step('recommendations', () =>
      refreshRecommendations(malToken ? malToken.access_token : null)
    );

    // Started LAST, after the reco refresh has finished with AniList: both throttle
    // against the same per-IP rate limit, and the metadata sweep is the one that
    // can run for minutes. The two AniList catalog sweeps (tags/staff and the
    // catalog-block backfill) are fire-and-forget and share the client.ts throttle,
    // so starting both just interleaves their requests on the one clock.
    steps.anilistCatalog = await step('anilist-catalog', async () => syncAnilistCatalog());
    steps.anilistCatalogFields = await step('anilist-catalog-fields', async () => syncAnilistCatalogFields());

    const failed = Object.entries(steps).filter(([, s]) => !s.ok).map(([name]) => name);
    appendLog(
      'cron-sync',
      failed.length ? 'error' : 'success',
      failed.length ? `Cron sync run completed with failures: ${failed.join(', ')}` : 'Cron sync run completed',
      { steps }
    );

    // Stamped next to the log entry above, but durably: the log is a 500-entry
    // rolling buffer shared by every channel, so a busy day evicts a whole run
    // and "scrolled out" becomes indistinguishable from "never happened".
    recordCronRun(trigger, {
      completedAt: Date.now(),
      ok: failed.length === 0,
      ...(failed.length ? { failedSteps: failed } : {}),
    });

    return { alreadyRunning: false, steps, failed };
  } finally {
    isRunning = false;
  }
}
