/**
 * AniList personal-list **push** — the one-shot backfill that brings a
 * pre-existing SIMKL/MAL list up to AniList (docs/ANILIST-OAUTH.md).
 *
 * Why this exists at all: the per-title writer in `personalWriters.ts` already
 * pushes every NEW edit to AniList once OAuth'd, from all three write surfaces.
 * What it cannot do is close the gap that predates the connection — the titles
 * rated in SIMKL months before an AniList token existed. Nothing iterates the
 * list, so those stay wherever AniList last saw them (usually nowhere). This
 * sweep is that missing one-shot; after it runs it is a no-op, because the
 * registry writer keeps the two in step from then on.
 *
 * **The local record wins, unconditionally.** This is not a two-way merge and
 * deliberately has no conflict rule: `CLAUDE.md`'s local-cache-authority model
 * makes the merged record the truth and AniList an absent-tolerant refill pipe,
 * and AniList sits LAST in personal precedence — so there is no AniList-side
 * state worth preserving against it. An entry is skipped only when it already
 * agrees, which saves a request rather than protecting anything.
 *
 * Values are read through `getEffective*`, so what gets pushed is exactly the
 * SIMKL > MAL > AniList precedence the rest of the app filters and ranks on.
 *
 * Server-only.
 */
import { appendLog } from '@/lib/connectionLog';
import { getAnilistAccessToken } from '@/lib/anilistAuth';
import { fetchAuthenticatedAnilistList, AniListRemoteEntry } from '@/lib/anilistPersonalSync';
import { pushAnilistEntry } from '@/lib/anilistWrite';
import { upsertAnilistPersonalEntries } from '@/lib/store';
import { AniListPersonalEntry, AnimeRecord, UserAnimeStatus } from '@/models/anime';

/** Same conservative throttle the other AniList sweeps use (~28 req/min). */
const PUSH_DELAY_MS = 2100;

/** `SourceIds` values may arrive as strings (SIMKL mirrors some as such). */
function toNum(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** The id pair to address one record by, preferring AniList's own resolved id. */
function pushIdsFor(anime: AnimeRecord): { malId?: number; anilistId?: number } {
  return {
    malId: toNum(anime.crosswalk.mal),
    anilistId: anime.sources.anilist?.anilist_id ?? toNum(anime.crosswalk.anilist),
  };
}

/** What we intend AniList to hold for one title. */
interface DesiredState {
  status: UserAnimeStatus;
  /** 0 = unrated (AniList models that as scoreRaw 0, so it is pushable). */
  score: number;
  progress?: number;
}

/**
 * True when AniList already agrees and the write can be skipped. A remote entry
 * we've never seen (`undefined`) always needs the push.
 *
 * Progress is deliberately NOT compared: AniList auto-fills it to the episode
 * count on COMPLETED (live-verified 2026-07-18), so its value is provider-derived
 * there rather than ours, and treating a difference as a disagreement would
 * re-push most of a completed list on every run for no change.
 */
function agrees(remote: AniListRemoteEntry | undefined, desired: DesiredState): boolean {
  if (!remote) return false;
  return remote.status === desired.status && (remote.score ?? 0) === desired.score;
}

/**
 * Reflect a landed push into the local AniList slice, so the record shows the
 * new state without waiting for a re-import. Mirrors what the `anilist` writer
 * in `personalWriters.ts` does per edit.
 */
function reflectLocally(canonicalId: string, anilistId: number, desired: DesiredState): void {
  const entry: AniListPersonalEntry = {
    anilist_id: anilistId,
    status: desired.status,
    score: desired.score > 0 ? desired.score : undefined,
    progress: desired.progress,
  };
  upsertAnilistPersonalEntries({ [canonicalId]: entry });
}

let isPushRunning = false;

/**
 * Live counters for the running sweep. Exposed so the stats GET can answer a
 * poll from memory instead of re-reading the remote list: `buildQueue` costs a
 * GraphQL request, and polling it every few seconds would compete with the
 * sweep's own writes for the same rate limit.
 */
let pushProgress: { index: number; total: number; pushed: number; failed: number } | null = null;

export interface AniListPushResult {
  ok: boolean;
  alreadyRunning: boolean;
  /** Titles that disagreed with AniList when the sweep started. */
  queued: number;
  pushed: number;
  failed: number;
  error?: string;
}

/**
 * Push every statused local title whose state AniList doesn't already match.
 *
 * Scope is the **statused list including `plan_to_watch`** — everything with an
 * effective status, which is what the user's list means everywhere else in the
 * app (`/stats`' scope, not the tier board's narrower rateable one). A backlog
 * entry is a real list entry on AniList too.
 *
 * Fire-and-forget (the API route doesn't await it) — progress surfaces through
 * `appendLog('anilist-personal-push', …)`, polled client-side, the same pattern
 * as the cast sweep and catalog crawl. Individual failures are non-fatal and
 * counted; only an unexpected throw aborts the run.
 *
 * **Resumable by construction**, like the cast sweep: each push lands on AniList
 * immediately and is reflected into the local slice as it goes, and the queue is
 * rebuilt from a fresh remote read on every run — so an interrupted sweep simply
 * finds fewer disagreements next time. Nothing is batched or deferred to the end.
 */
export async function performAnilistPersonalPush(): Promise<AniListPushResult> {
  if (isPushRunning) {
    appendLog('anilist-personal-push', 'info', 'AniList push skipped: already running');
    return { ok: false, alreadyRunning: true, queued: 0, pushed: 0, failed: 0 };
  }

  if (!getAnilistAccessToken()) {
    const error = 'Not connected to AniList (or token expired)';
    appendLog('anilist-personal-push', 'error', `AniList push failed: ${error}`);
    return { ok: false, alreadyRunning: false, queued: 0, pushed: 0, failed: 0, error };
  }

  isPushRunning = true;
  try {
    const { queue, remoteCount, statusedCount } = await buildQueue();

    appendLog('anilist-personal-push', 'info',
      `AniList push started: ${queue.length} of ${statusedCount} statused titles differ (AniList holds ${remoteCount})`,
      { queued: queue.length, statused: statusedCount, remote: remoteCount });

    if (queue.length === 0) {
      appendLog('anilist-personal-push', 'success', 'AniList push complete: already in sync', {
        queued: 0, pushed: 0, failed: 0,
      });
      return { ok: true, alreadyRunning: false, queued: 0, pushed: 0, failed: 0 };
    }

    let pushed = 0;
    let failed = 0;
    pushProgress = { index: 0, total: queue.length, pushed: 0, failed: 0 };

    for (let i = 0; i < queue.length; i++) {
      const { anime, desired } = queue[i];
      const ids = pushIdsFor(anime);

      const result = await pushAnilistEntry(
        // `progress` is omitted for a completed title: AniList fills it with the
        // episode count itself, and ours can be stale or absent for a title
        // completed long ago.
        {
          status: desired.status,
          score: desired.score,
          ...(desired.status === 'completed' ? {} : { progress: desired.progress }),
        },
        ids
      );

      if (result.ok) {
        pushed++;
        // Only reflected when we already knew the AniList media id. `result.entry.id`
        // is the LIST ENTRY id, not the media id, so a title whose id was resolved
        // live inside `pushAnilistEntry` gives us nothing to key the slice on — it
        // lands on AniList and shows up on the next import instead. Rare (669/671
        // of the statused list carry a crosswalk AniList id).
        if (ids.anilistId !== undefined) reflectLocally(anime.id, ids.anilistId, desired);
      } else {
        failed++;
        appendLog('anilist-personal-push', 'info',
          `AniList push skipped ${anime.id} (${anime.catalog.title ?? 'untitled'}): ${result.error ?? 'unknown error'}`,
          { canonicalId: anime.id, ...ids, error: result.error });
      }

      pushProgress = { index: i + 1, total: queue.length, pushed, failed };

      // Every 25th title, so a ~250-title run leaves ~10 progress entries rather
      // than 250. `{index,total}` matches what the client progress bar reads.
      if ((i + 1) % 25 === 0 || i === queue.length - 1) {
        appendLog('anilist-personal-push', 'info',
          `AniList push: ${i + 1}/${queue.length} titles processed`,
          { index: i + 1, total: queue.length, pushed, failed });
      }

      if (i < queue.length - 1) {
        await new Promise(resolve => setTimeout(resolve, PUSH_DELAY_MS));
      }
    }

    appendLog('anilist-personal-push', 'success',
      `AniList push complete: ${pushed} pushed, ${failed} failed`,
      { queued: queue.length, pushed, failed });

    return { ok: true, alreadyRunning: false, queued: queue.length, pushed, failed };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('AniList push error:', error);
    appendLog('anilist-personal-push', 'error', 'AniList push failed', { error: message });
    return { ok: false, alreadyRunning: false, queued: 0, pushed: 0, failed: 0, error: message };
  } finally {
    isPushRunning = false;
    pushProgress = null;
  }
}

interface QueueItem {
  anime: AnimeRecord;
  desired: DesiredState;
}

/**
 * The titles to push: every statused record whose effective state AniList
 * doesn't already hold. Reads the remote list ONCE (a single GraphQL call —
 * `MediaListCollection` is not paginated) and diffs locally, so sizing the run
 * costs one request rather than one per title.
 */
async function buildQueue(): Promise<{ queue: QueueItem[]; remoteCount: number; statusedCount: number }> {
  // Imported lazily for the same reason the cast sweep does it: store.ts is the
  // heavy `fs`-bound join and this module is otherwise a leaf.
  const { getAnimeForDisplay } = await import('@/lib/store');
  const { getEffectiveStatus, getEffectiveScore, getEffectiveProgress } = await import('@/lib/animeUtils');

  const remoteEntries = (await fetchAuthenticatedAnilistList()) ?? [];
  // Keyed by MAL id — the join key both sides share. An AniList-only remote
  // entry (no idMal) can't be matched to a local record, and a local record
  // without a MAL id simply reads as absent and gets pushed by AniList id.
  const remoteByMal = new Map<number, AniListRemoteEntry>();
  const remoteByAnilist = new Map<number, AniListRemoteEntry>();
  for (const e of remoteEntries) {
    if (e.malId) remoteByMal.set(e.malId, e);
    if (e.anilistId) remoteByAnilist.set(e.anilistId, e);
  }

  const statused = getAnimeForDisplay().filter(a => !!getEffectiveStatus(a));

  const queue: QueueItem[] = [];
  for (const anime of statused) {
    const ids = pushIdsFor(anime);
    // Nothing to address AniList by — `pushAnilistEntry` would fail on every
    // one of these, so they're dropped here rather than counted as failures.
    if (ids.malId === undefined && ids.anilistId === undefined) continue;

    const desired: DesiredState = {
      status: getEffectiveStatus(anime) as UserAnimeStatus,
      score: getEffectiveScore(anime) ?? 0,
      progress: getEffectiveProgress(anime),
    };

    const remote =
      (ids.malId !== undefined ? remoteByMal.get(ids.malId) : undefined) ??
      (ids.anilistId !== undefined ? remoteByAnilist.get(ids.anilistId) : undefined);

    if (!agrees(remote, desired)) queue.push({ anime, desired });
  }

  return { queue, remoteCount: remoteEntries.length, statusedCount: statused.length };
}

export interface AniListPushStats {
  connected: boolean;
  /** Titles with an effective status — the sweep's scope. */
  statused: number;
  /** Entries AniList currently holds. */
  remote: number;
  /** Titles whose state AniList doesn't match — what a run would write. */
  differing: number;
  pushRunning: boolean;
  /** Live counters, present only while a sweep is running. */
  progress?: { index: number; total: number; pushed: number; failed: number };
  error?: string;
}

/**
 * Drift + run state for the connections-page push button.
 *
 * While a sweep is running this answers from the in-memory counters and does
 * NOT call `buildQueue` — that would spend a GraphQL request per poll on the
 * same rate limit the sweep's writes are consuming.
 */
export async function getAnilistPushStats(): Promise<AniListPushStats> {
  if (!getAnilistAccessToken()) {
    return { connected: false, statused: 0, remote: 0, differing: 0, pushRunning: false };
  }
  if (isPushRunning) {
    return {
      connected: true,
      statused: 0,
      remote: 0,
      differing: pushProgress ? pushProgress.total - pushProgress.index : 0,
      pushRunning: true,
      progress: pushProgress ?? undefined,
    };
  }
  try {
    const { queue, remoteCount, statusedCount } = await buildQueue();
    return {
      connected: true,
      statused: statusedCount,
      remote: remoteCount,
      differing: queue.length,
      pushRunning: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { connected: true, statused: 0, remote: 0, differing: 0, pushRunning: false, error: message };
  }
}
