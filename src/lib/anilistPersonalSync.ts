/**
 * AniList personal-list import (docs/PROVIDER-FREE.md Phase 3 "P3b" — the
 * north-star no-key feature). Anonymous, unauthenticated, read-only: pull a
 * PUBLIC AniList user's anime list by USERNAME, normalize it to MAL-keyed
 * AniListPersonalEntry records, and persist. No OAuth (that is the deferred
 * P3d). The username is persisted so re-import needs no re-entry.
 *
 * `MediaListCollection(userName:)` returns the WHOLE list in one response — it
 * is not a paginated connection — so this is a SINGLE GraphQL call, not a
 * throttled batch loop like the tags/catalog syncs. The endpoint / 429-retry
 * style mirrors anilistSync.ts.
 *
 * Phase 0 (2026-07-12) verified three distinguishable outcomes, so we never
 * fail opaquely: public → data; private profile → 404 "Private User";
 * nonexistent username → 404 "User not found".
 *
 * Server-only (persists via store.ts / jsonStore).
 */
import { replaceAnilistPersonalEntries } from '@/lib/store';
import { appendLog } from '@/lib/connectionLog';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/jsonStore';
import { AniListPersonalEntry, UserAnimeStatus } from '@/models/anime';

const ANILIST_ENDPOINT = 'https://graphql.anilist.co';
const CONFIG_FILE = dataFile('anilist_personal_config.json');

// AniList list-status vocabulary -> MAL vocabulary (docs/PROVIDER-FREE.md P3b).
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
const LIST_QUERY = `
query ($u: String) {
  MediaListCollection(userName: $u, type: ANIME) {
    lists {
      entries {
        status
        score(format: POINT_10)
        progress
        media { id idMal }
      }
    }
  }
}`;

// ---- Persisted config (username + last-import stats). Not part of the merged
// record, so it writes through jsonStore directly (no cache to invalidate). ----
export interface AniListPersonalConfig {
  username: string | null;
  lastImportedCount: number | null;
  lastImportedAt: string | null;
}

export function getAnilistPersonalConfig(): AniListPersonalConfig {
  return readJsonFile<AniListPersonalConfig>(CONFIG_FILE, {
    username: null,
    lastImportedCount: null,
    lastImportedAt: null,
  });
}

function saveAnilistPersonalConfig(cfg: AniListPersonalConfig): void {
  writeJsonFile(CONFIG_FILE, cfg);
}

// ---- Import result + error kinds ----
export type AniListPersonalErrorKind = 'private' | 'not_found' | 'empty' | 'network';

export interface AniListPersonalImportResult {
  ok: boolean;
  imported: number;      // entries stored (MAL-id-keyed; visibility depends on catalog coverage)
  skippedNoMal: number;  // AniList-only entries (media.idMal === null) — skipped, can't join yet
  username?: string;
  error?: string;
  errorKind?: AniListPersonalErrorKind;
}

// Typed error so the fetch layer can surface the private/not-found distinction.
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
interface RawResponse {
  data?: { MediaListCollection?: { lists?: RawList[] | null } | null };
  errors?: { message?: string }[];
}

async function fetchList(username: string, retryOn429 = true): Promise<RawResponse> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query: LIST_QUERY, variables: { u: username } }),
  });

  if (res.status === 429 && retryOn429) {
    const retryAfterHeader = res.headers.get('Retry-After');
    const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 60_000;
    await new Promise(resolve => setTimeout(resolve, Number.isFinite(retryAfterMs) ? retryAfterMs : 60_000));
    return fetchList(username, false);
  }

  const text = await res.text().catch(() => '');
  let json: RawResponse;
  try {
    json = text ? (JSON.parse(text) as RawResponse) : {};
  } catch {
    throw new AniListPersonalError(`AniList returned non-JSON (${res.status})`, 'network');
  }

  // GraphQL surfaces the meaningful cases as `errors` even on a 404 HTTP code.
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    const first = json.errors[0]?.message ?? '';
    const joined = json.errors.map(e => e.message ?? 'unknown error').join('; ');
    if (first.includes('Private User')) throw new AniListPersonalError(joined, 'private');
    if (first.includes('User not found')) throw new AniListPersonalError(joined, 'not_found');
    throw new AniListPersonalError(`AniList GraphQL error: ${joined}`, 'network');
  }

  if (!res.ok) {
    throw new AniListPersonalError(`AniList request failed: ${res.status} ${res.statusText}`, 'network');
  }

  return json;
}

/**
 * Import a public AniList user's anime list by username. Single GraphQL call,
 * full-replace store write (removals drop out for free). Returns real counts in
 * the response so the API route can stay synchronous.
 */
export async function importAnilistPersonalList(usernameRaw: string): Promise<AniListPersonalImportResult> {
  const username = (usernameRaw || '').trim();
  if (!username) {
    return { ok: false, imported: 0, skippedNoMal: 0, error: 'Username required', errorKind: 'empty' };
  }

  try {
    const json = await fetchList(username);
    const lists = json.data?.MediaListCollection?.lists ?? [];

    const byMalId: Record<string, AniListPersonalEntry> = {};
    let skippedNoMal = 0;

    for (const list of lists) {
      for (const e of list?.entries ?? []) {
        const idMal = e.media?.idMal;
        // AniList-only titles have no MAL id to join by yet (deferred outward-id
        // work). Count them for the report, but don't store.
        if (!idMal) {
          skippedNoMal++;
          continue;
        }
        const status = STATUS_MAP[(e.status ?? '').toUpperCase()];
        const score = typeof e.score === 'number' && e.score > 0 ? e.score : undefined;
        const progress = typeof e.progress === 'number' ? e.progress : undefined;
        // Custom lists can repeat a title across lists — the MAL-id key dedupes.
        byMalId[idMal.toString()] = {
          anilist_id: e.media?.id ?? 0,
          status,
          score,
          progress,
        };
      }
    }

    replaceAnilistPersonalEntries(byMalId);
    const imported = Object.keys(byMalId).length;
    saveAnilistPersonalConfig({
      username,
      lastImportedCount: imported,
      lastImportedAt: new Date().toISOString(),
    });

    appendLog(
      'anilist-personal-import',
      'success',
      `AniList personal import for @${username}: ${imported} stored, ${skippedNoMal} skipped (no MAL id)`,
      { username, imported, skippedNoMal }
    );

    return { ok: true, imported, skippedNoMal, username };
  } catch (error) {
    const kind: AniListPersonalErrorKind =
      error instanceof AniListPersonalError ? error.kind : 'network';
    const message = error instanceof Error ? error.message : 'Unknown error';
    appendLog('anilist-personal-import', 'error', `AniList personal import for @${username} failed (${kind}): ${message}`, {
      username,
      kind,
      error: message,
    });
    return { ok: false, imported: 0, skippedNoMal: 0, username, error: message, errorKind: kind };
  }
}
