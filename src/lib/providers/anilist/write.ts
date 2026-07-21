/**
 * AniList write-back — the `SaveMediaListEntry` mutation behind the personal
 * writer registry (docs/ANILIST-OAUTH.md). The AniList sibling of `malWrite.ts`
 * / `simklWrite.ts`.
 *
 * Two things that are NOT obvious:
 *
 *  1. **`mediaId` is the ANILIST id, not the MAL id.** Everything else in the
 *     write path keys off `crosswalk.mal`; this one doesn't. `crosswalk.anilist`
 *     is populated by the AniList meta sync / catalog crawl, but coverage is not
 *     guaranteed for a MAL-only-crawled title — so `resolveAnilistMediaId` falls
 *     back to a live `Media(idMal:)` lookup rather than failing the write.
 *  2. **We write `scoreRaw`, never `score`.** `score` is interpreted in the
 *     user's own `scoreFormat` (POINT_100 / POINT_10 / POINT_5 / stars…), so
 *     sending the app's 1-10 value as `score` would read as 8/100 for a
 *     POINT_100 user. `scoreRaw` is always the 0-100 base, so app-8 -> 80 is
 *     correct for every profile and we never have to read their format.
 *
 * Server-only.
 */
import type { UserAnimeStatus } from '@/models/anime';
import { anilistGraphQL, getAnilistAccessToken } from '@/lib/providers/anilist/auth';
import { appendLog } from '@/lib/connectionLog';

/** MAL vocabulary -> AniList's. The inverse of anilistPersonalSync's STATUS_MAP.
 *  AniList's REPEATING has no MAL equivalent, so nothing maps onto it. */
const STATUS_TO_ANILIST: Record<UserAnimeStatus, string> = {
  watching: 'CURRENT',
  plan_to_watch: 'PLANNING',
  completed: 'COMPLETED',
  dropped: 'DROPPED',
  on_hold: 'PAUSED',
};

const SAVE_MUTATION = `
mutation ($mediaId: Int, $status: MediaListStatus, $scoreRaw: Int, $progress: Int) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw, progress: $progress) {
    id
    status
    score(format: POINT_10)
    progress
  }
}`;

const MEDIA_BY_MAL_QUERY = `
query ($idMal: Int) {
  Media(idMal: $idMal, type: ANIME) { id }
}`;

export interface AnilistWriteResult {
  ok: boolean;
  /** Whether AniList matched the title (an unresolvable id is a miss, not a failure to retry). */
  matched?: boolean;
  error?: string;
  /** What AniList says the entry looks like now — used to verify the write landed. */
  entry?: { id: number; status?: string; score?: number; progress?: number };
}

/**
 * The AniList media id for a title: the crosswalk value when we have one, else a
 * live `Media(idMal:)` lookup. Returns null when neither resolves.
 */
export async function resolveAnilistMediaId(
  crosswalkAnilistId: number | string | undefined,
  malId: number | undefined,
  accessToken: string
): Promise<number | null> {
  const fromCrosswalk = Number(crosswalkAnilistId);
  if (Number.isFinite(fromCrosswalk) && fromCrosswalk > 0) return fromCrosswalk;
  if (malId === undefined) return null;

  const result = await anilistGraphQL<{ Media: { id: number } | null }>(
    MEDIA_BY_MAL_QUERY,
    { idMal: malId },
    accessToken
  );
  // A MAL id AniList doesn't carry comes back as a `Not Found` error, not a throw.
  if (result.errors?.length || !result.data?.Media) return null;
  return result.data.Media.id;
}

/**
 * Push status/score/progress to the user's AniList list. Creates the list entry
 * if it doesn't exist — `SaveMediaListEntry` is an upsert.
 *
 * `score` is on the app's 1-10 scale; 0 clears the rating (AniList models an
 * unrated entry as scoreRaw 0, so this needs no separate "remove" call, unlike
 * SIMKL's `/sync/ratings/remove`).
 */
export async function pushAnilistEntry(
  patch: { status?: UserAnimeStatus | null; score?: number; progress?: number },
  ids: { anilistId?: number | string; malId?: number }
): Promise<AnilistWriteResult> {
  const accessToken = getAnilistAccessToken();
  if (!accessToken) return { ok: false, error: 'Not connected to AniList (or token expired)' };

  // Clearing a status has no AniList expression either (it's a list DELETE via
  // DeleteMediaListEntry, which would drop the score too) — same carve-out as
  // MAL's writer, so the registry stays consistent about what "clear" means.
  if (patch.status === null) {
    return { ok: false, error: 'AniList cannot clear a status (list removal only)' };
  }

  let mediaId: number | null;
  try {
    mediaId = await resolveAnilistMediaId(ids.anilistId, ids.malId, accessToken);
  } catch (e) {
    const error = e instanceof Error ? e.message : 'AniList id resolution failed';
    console.error('[anilist-write] media id resolution failed:', e);
    return { ok: false, error };
  }
  if (mediaId === null) return { ok: false, matched: false, error: 'No AniList id for this title' };

  const variables: Record<string, unknown> = { mediaId };
  if (patch.status !== undefined && patch.status !== null) variables.status = STATUS_TO_ANILIST[patch.status];
  if (patch.score !== undefined) variables.scoreRaw = Math.round(patch.score * 10);
  if (patch.progress !== undefined) variables.progress = patch.progress;

  // Nothing to change — don't burn a mutation (and don't report a false success
  // for a patch this provider can't express).
  if (Object.keys(variables).length === 1) return { ok: true, matched: false };

  try {
    const result = await anilistGraphQL<{
      SaveMediaListEntry: { id: number; status?: string; score?: number; progress?: number } | null;
    }>(SAVE_MUTATION, variables, accessToken);

    if (result.errors?.length) {
      const error = result.errors.map(e => e.message).join('; ');
      appendLog('anilist-rating', 'error', `AniList write failed for media ${mediaId}`, { error });
      return { ok: false, error };
    }

    const entry = result.data?.SaveMediaListEntry ?? undefined;
    appendLog('anilist-rating', 'success', `AniList entry saved for media ${mediaId}`, {
      mediaId,
      status: entry?.status,
      score: entry?.score,
      progress: entry?.progress,
    });
    return { ok: true, matched: true, entry };
  } catch (e) {
    const error = e instanceof Error ? e.message : 'AniList write failed';
    console.error(`[anilist-write] write failed for media ${mediaId}:`, e);
    appendLog('anilist-rating', 'error', `AniList write failed for media ${mediaId}`, { error });
    return { ok: false, error };
  }
}
