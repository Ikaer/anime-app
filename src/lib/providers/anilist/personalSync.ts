/**
 * AniList personal-list import: pulls the **authenticated viewer's OWN** list by
 * `userId`, private entries included, normalizes it to MAL-keyed
 * `AniListPersonalEntry` records, and persists.
 *
 * **Requires a token — there is no anonymous read.** That is an invariant other
 * code depends on, not just a limitation: because every entry in
 * `personal/anilist.json` belongs to a connected account, AniList can
 * participate in discrepancy detection without an actionability gate.
 *
 * `MediaListCollection` returns the WHOLE list in one response — it is not a
 * paginated connection — so this is a SINGLE GraphQL call, not a batch loop like
 * the tags/catalog syncs. Endpoint, throttle and 429 retry come from `client.ts`
 * like every other AniList call.
 *
 * Server-only (persists via store.ts / jsonStore).
 */
import { replaceAnilistPersonalEntries } from '@/lib/store';
import { appendLog } from '@/lib/config/connectionLog';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { AniListPersonalEntry, UserAnimeStatus } from '@/models/anime';
import { getAnilistAuthData, getAnilistAccessToken, fetchAnilistViewer } from '@/lib/providers/anilist/auth';
import { anilistFetch, httpErrorMessage } from '@/lib/providers/anilist/client';

const CONFIG_FILE = dataFile('sync/anilist_import.json');

// AniList list-status vocabulary -> MAL vocabulary.
const STATUS_MAP: Record<string, UserAnimeStatus> = {
  CURRENT: 'watching',
  PLANNING: 'plan_to_watch',
  COMPLETED: 'completed',
  DROPPED: 'dropped',
  PAUSED: 'on_hold',
  REPEATING: 'watching',
};

// score(format: POINT_10) is load-bearing: it normalizes a user on a
// POINT_100 / POINT_5 / stars profile down onto the shared 1-10 scale, so a
// "85" can never poison getEffectiveScore's scale.
const LIST_SELECTION = `
  lists {
    entries {
      status
      score(format: POINT_10)
      progress
      media { id idMal }
    }
  }`;

// Keyed on `userId` rather than `userName` because that is what the token
// identifies — and a viewer reading their OWN list by id is the case AniList
// lets through the private-profile gate.
const LIST_QUERY_BY_ID = `
query ($id: Int) {
  MediaListCollection(userId: $id, type: ANIME) {${LIST_SELECTION}
  }
}`;

// ---- Persisted last-import stats. Not part of the merged record, so it writes
// through jsonStore directly (no cache to invalidate). The viewer's name is not
// persisted here — it is available live from the auth data. ----
export interface AniListPersonalConfig {
  lastImportedCount: number | null;
  lastImportedAt: string | null;
}

export function getAnilistPersonalConfig(): AniListPersonalConfig {
  return readJsonFile<AniListPersonalConfig>(CONFIG_FILE, {
    lastImportedCount: null,
    lastImportedAt: null,
  });
}

function saveAnilistPersonalConfig(cfg: AniListPersonalConfig): void {
  writeJsonFile(CONFIG_FILE, cfg);
}

// ---- Import result + error kinds ----
// `no_auth` = not connected; `not_found` = connected but the viewer could not be
// identified. There is no "private profile" kind: reading your own list is never
// blocked for privacy.
export type AniListPersonalErrorKind = 'no_auth' | 'not_found' | 'network';

export interface AniListPersonalImportResult {
  ok: boolean;
  imported: number;      // entries stored (MAL-id-keyed; visibility depends on catalog coverage)
  skippedNoMal: number;  // AniList-only entries (media.idMal === null) — skipped, can't join yet
  username?: string;     // the viewer's AniList name, for display
  error?: string;
  errorKind?: AniListPersonalErrorKind;
}

// Typed error so the fetch layer can surface the error kind to the API route.
class AniListPersonalError extends Error {
  constructor(message: string, public kind: AniListPersonalErrorKind) {
    super(message);
    this.name = 'AniListPersonalError';
  }
}

interface RawEntry {
  status?: string;
  score?: number | null;
  progress?: number | null;
  media?: { id?: number | null; idMal?: number | null };
}
interface RawList { entries?: RawEntry[] | null }
interface RawListCollection { MediaListCollection?: { lists?: RawList[] | null } | null }

/**
 * The one list read. Uses `anilistFetch` rather than the strict `anilistQuery`
 * because this caller doesn't just need "did it fail" — it has to classify the
 * failure into an `AniListPersonalErrorKind` the API route can act on, and
 * AniList reports "User not found" as a GraphQL error under a 404.
 */
async function fetchList(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string | null
): Promise<RawListCollection | undefined> {
  const res = await anilistFetch<RawListCollection>(query, variables, { accessToken })
    .catch(error => {
      const message = error instanceof Error ? error.message : 'AniList request failed';
      throw new AniListPersonalError(message, 'network');
    });

  // GraphQL surfaces the meaningful cases as `errors` even on a 404 HTTP code.
  const errors = res.body.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0]?.message ?? '';
    const joined = errors.map(e => e.message ?? 'unknown error').join('; ');
    if (first.includes('User not found')) throw new AniListPersonalError(joined, 'not_found');
    throw new AniListPersonalError(`AniList GraphQL error: ${joined}`, 'network');
  }

  if (!res.ok) {
    throw new AniListPersonalError(httpErrorMessage(res), 'network');
  }

  return res.body.data;
}

/** One remote list entry, normalized onto the app's vocabulary and 1-10 scale. */
export interface AniListRemoteEntry {
  anilistId: number;
  /** Absent for an AniList-only title (no MAL counterpart to join by). */
  malId?: number;
  status?: UserAnimeStatus;
  score?: number;
  progress?: number;
}

/** Flatten AniList's per-custom-list grouping into one normalized entry array. */
function normalizeLists(lists: RawList[]): AniListRemoteEntry[] {
  const out: AniListRemoteEntry[] = [];
  for (const list of lists) {
    for (const e of list?.entries ?? []) {
      out.push({
        anilistId: e.media?.id ?? 0,
        malId: e.media?.idMal ?? undefined,
        status: STATUS_MAP[(e.status ?? '').toUpperCase()],
        score: typeof e.score === 'number' && e.score > 0 ? e.score : undefined,
        progress: typeof e.progress === 'number' ? e.progress : undefined,
      });
    }
  }
  return out;
}

/**
 * The OAuth'd viewer's OWN list — **private lists included** — as normalized
 * entries, WITHOUT persisting. This is the read the push sweep dedupes against:
 * "skip titles already on AniList" is only computable once we can see them.
 *
 * Returns `null` when there is no live token (not an error — the caller decides
 * whether that is fatal).
 */
export async function fetchAuthenticatedAnilistList(): Promise<AniListRemoteEntry[] | null> {
  const accessToken = getAnilistAccessToken();
  if (!accessToken) return null;

  // The viewer is stored at callback time; re-fetch only if it's missing, so the
  // common path is one request, not two.
  let viewerId = getAnilistAuthData().user?.id;
  if (!viewerId) viewerId = (await fetchAnilistViewer(accessToken))?.id;
  if (!viewerId) throw new AniListPersonalError('Could not identify the AniList viewer', 'not_found');

  const data = await fetchList(LIST_QUERY_BY_ID, { id: viewerId }, accessToken);
  return normalizeLists(data?.MediaListCollection?.lists ?? []);
}

/**
 * Import the connected viewer's AniList list. Single GraphQL call, full-replace
 * store write (removals drop out for free). Returns real counts in the response
 * so the API route can stay synchronous.
 */
export async function importAnilistPersonalList(): Promise<AniListPersonalImportResult> {
  const accessToken = getAnilistAccessToken();
  if (!accessToken) {
    return { ok: false, imported: 0, skippedNoMal: 0, error: 'Not connected to AniList', errorKind: 'no_auth' };
  }

  const viewerName = getAnilistAuthData().user?.name;
  const label = viewerName || 'viewer';

  try {
    const entries = (await fetchAuthenticatedAnilistList()) ?? [];

    const byMalId: Record<string, AniListPersonalEntry> = {};
    let skippedNoMal = 0;

    for (const e of entries) {
      // AniList-only titles have no MAL id to join by yet (deferred outward-id
      // work). Count them for the report, but don't store.
      if (!e.malId) {
        skippedNoMal++;
        continue;
      }
      // Custom lists can repeat a title across lists — the MAL-id key dedupes.
      byMalId[e.malId.toString()] = {
        anilist_id: e.anilistId,
        status: e.status,
        score: e.score,
        progress: e.progress,
      };
    }

    replaceAnilistPersonalEntries(byMalId);
    const imported = Object.keys(byMalId).length;
    saveAnilistPersonalConfig({
      lastImportedCount: imported,
      lastImportedAt: new Date().toISOString(),
    });

    appendLog(
      'anilist-personal-import',
      'success',
      `AniList personal import for @${label}: ${imported} stored, ${skippedNoMal} skipped (no MAL id)`,
      { username: label, imported, skippedNoMal }
    );

    return { ok: true, imported, skippedNoMal, username: label };
  } catch (error) {
    const kind: AniListPersonalErrorKind =
      error instanceof AniListPersonalError ? error.kind : 'network';
    const message = error instanceof Error ? error.message : 'Unknown error';
    appendLog('anilist-personal-import', 'error', `AniList personal import for @${label} failed (${kind}): ${message}`, {
      username: label,
      kind,
      error: message,
    });
    return { ok: false, imported: 0, skippedNoMal: 0, username: label, error: message, errorKind: kind };
  }
}
