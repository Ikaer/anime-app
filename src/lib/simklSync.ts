/**
 * SIMKL two-phase, read-only sync orchestration. Pulls the user's personal
 * anime library, normalizes it to MAL-keyed SimklPersonalEntry records, and
 * persists via anime.ts. See docs/simkl/apirules.md for the protocol.
 */
import { getSimklAuthData, isSimklTokenValid, getSimklCheckpoint, saveSimklCheckpoint, simklFetch, SimklCheckpoint } from '@/lib/simkl';
import { upsertSimklEntries, removeSimklEntries, getAllSimklEntries } from '@/lib/store';
import { mapSimklStatus } from '@/lib/discrepancy';
import { SimklPersonalEntry, SourceIds } from '@/models/anime';

export interface SimklSyncResult {
  ok: boolean;
  phase: 'initial' | 'delta' | 'noop';
  added: number;
  removed: number;
  orphansSkipped: number;
  error?: string;
}

// ---- Raw SIMKL response shapes (defensive; see VERIFY-STEP) ----
interface RawSimklAnimeItem {
  status?: string;
  user_rating?: number | null;
  watched_episodes_count?: number | null;
  total_episodes_count?: number | null;
  last_watched_at?: string;
  anime_type?: string;
  show?: {
    title?: string;
    ids?: SourceIds;
  };
}
interface RawAllItems { anime?: RawSimklAnimeItem[]; }
interface RawActivities { anime?: { all?: string; removed_from_list?: string; rated_at?: string }; }

/** Normalize one raw item -> entry, or null if it has no usable MAL id (orphan). */
function normalizeItem(item: RawSimklAnimeItem): SimklPersonalEntry | null {
  const malRaw = item.show?.ids?.mal;
  const simklId = item.show?.ids?.simkl;
  const malId = typeof malRaw === 'string' ? parseInt(malRaw, 10) : malRaw;
  if (!malId || Number.isNaN(malId) || !simklId) return null; // orphan

  const status = mapSimklStatus(item.status);
  if (!status) return null; // unknown status -> treat as orphan/skip

  return {
    simkl_id: simklId,
    mal_id: malId,
    status,
    score: item.user_rating != null ? item.user_rating : null,
    num_episodes_watched: item.watched_episodes_count != null ? item.watched_episodes_count : null,
    total_episodes: item.total_episodes_count != null ? item.total_episodes_count : null,
    watched_at: item.last_watched_at,
    ids: item.show?.ids, // rich cross-source crosswalk (mal, anilist, anidb, kitsu, tmdb…)
  };
}

function normalizeAll(raw: RawAllItems): { entries: SimklPersonalEntry[]; orphansSkipped: number } {
  const items = raw.anime ?? [];
  const entries: SimklPersonalEntry[] = [];
  let orphansSkipped = 0;
  for (const item of items) {
    const entry = normalizeItem(item);
    if (entry) entries.push(entry);
    else orphansSkipped++;
  }
  return { entries, orphansSkipped };
}

async function fetchAllItems(token: string, dateFrom?: string): Promise<RawAllItems> {
  // Plain call (no extended=ids_only): returns per-item status/rating/progress
  // AND the full ids object (incl. mal). extended=ids_only would strip the
  // personal fields — verified against a live account 2026-07-04.
  let path = '/sync/all-items/anime';
  if (dateFrom) path += `?date_from=${encodeURIComponent(dateFrom)}`;
  const res = await simklFetch(path, token);
  if (!res.ok) throw new Error(`all-items ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? (JSON.parse(text) as RawAllItems) : {};
}

async function fetchActivities(token: string): Promise<RawActivities> {
  const res = await simklFetch('/sync/activities', token);
  if (!res.ok) throw new Error(`activities ${res.status}: ${await res.text()}`);
  return (await res.json()) as RawActivities;
}

/** Reconcile deletions: diff local simkl ids against a simkl_ids_only pull. */
async function reconcileDeletions(token: string): Promise<number> {
  const res = await simklFetch('/sync/all-items/anime?extended=simkl_ids_only', token);
  if (!res.ok) throw new Error(`simkl_ids_only ${res.status}: ${await res.text()}`);
  const raw = (await res.json()) as RawAllItems;
  const liveSimklIds = new Set(
    (raw.anime ?? []).map(i => i.show?.ids?.simkl).filter((n): n is number => typeof n === 'number')
  );
  const local = getAllSimklEntries(); // canonical-keyed
  const toRemove: string[] = [];
  for (const key of Object.keys(local)) {
    if (!liveSimklIds.has(local[key].simkl_id)) toRemove.push(key);
  }
  if (toRemove.length) removeSimklEntries(toRemove);
  return toRemove.length;
}

export async function performSimklSync(): Promise<SimklSyncResult> {
  const authData = getSimklAuthData();
  const token = authData.token;
  if (!token || !isSimklTokenValid(token)) {
    return { ok: false, phase: 'noop', added: 0, removed: 0, orphansSkipped: 0, error: 'Not authenticated with SIMKL' };
  }

  try {
    const checkpoint = getSimklCheckpoint();
    const activities = await fetchActivities(token.access_token);
    const remoteAll = activities.anime?.all ?? null;
    const remoteRemoved = activities.anime?.removed_from_list ?? null;
    const remoteRated = activities.anime?.rated_at ?? null;

    // Phase 1: initial (no watermark yet)
    if (!checkpoint.lastActivityAll) {
      const raw = await fetchAllItems(token.access_token);
      const { entries, orphansSkipped } = normalizeAll(raw);
      upsertSimklEntries(entries);
      saveSimklCheckpoint({ lastActivityAll: remoteAll, lastRemovedFromList: remoteRemoved, lastRatedAt: remoteRated });
      return { ok: true, phase: 'initial', added: entries.length, removed: 0, orphansSkipped };
    }

    const allMoved = !!remoteAll && remoteAll !== checkpoint.lastActivityAll;
    // A rating change bumps activities.rated_at (and `all`), but the item is NOT
    // returned by the all-items date_from delta — so a moved rated_at forces a
    // FULL pull. Note: existing checkpoints predate lastRatedAt (undefined), so
    // the first sync after this ships does one backfilling full pull.
    const ratedMoved = !!remoteRated && remoteRated !== checkpoint.lastRatedAt;

    // Phase 2: nothing changed -> short-circuit
    if (!allMoved && !ratedMoved) {
      return { ok: true, phase: 'noop', added: 0, removed: 0, orphansSkipped: 0 };
    }

    // Rating-only edits are invisible to the delta, so pull the FULL library when
    // rated_at advanced; otherwise a normal delta since the saved watermark.
    const raw = ratedMoved
      ? await fetchAllItems(token.access_token)
      : await fetchAllItems(token.access_token, checkpoint.lastActivityAll);
    const { entries, orphansSkipped } = normalizeAll(raw);
    upsertSimklEntries(entries);

    // Deletion reconciliation only when the removed_from_list timestamp moved
    let removed = 0;
    if (remoteRemoved && remoteRemoved !== checkpoint.lastRemovedFromList) {
      removed = await reconcileDeletions(token.access_token);
    }

    const next: SimklCheckpoint = { lastActivityAll: remoteAll, lastRemovedFromList: remoteRemoved, lastRatedAt: remoteRated };
    saveSimklCheckpoint(next);
    return { ok: true, phase: 'delta', added: entries.length, removed, orphansSkipped };
  } catch (error) {
    console.error('SIMKL sync error:', error);
    return {
      ok: false, phase: 'noop', added: 0, removed: 0, orphansSkipped: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
