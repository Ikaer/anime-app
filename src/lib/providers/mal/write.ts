/**
 * MAL personal-list write path (server-only). Extracted so both the
 * status endpoint and the tier-list rating endpoint share one implementation.
 * Writes `my_list_status` via the MAL API (PUT, falling back to PATCH), and
 * removes the whole list entry via DELETE.
 */
import { getMALAuthData } from '@/lib/providers/mal/client';

export interface MalListStatusUpdate {
  status?: string;
  score?: number;
  num_episodes_watched?: number;
}

const MAL_LIST_STATUS_URL = (animeId: number) =>
  `https://api.myanimelist.net/v2/anime/${animeId}/my_list_status`;

/** A live access token, or a throw naming why there isn't one. */
function requireToken(): string {
  const { token } = getMALAuthData();
  if (!token) throw new Error('Not authenticated with MAL');
  // Token expiry with a 5-minute buffer.
  const tokenExpiresAt = token.created_at + token.expires_in * 1000;
  if (Date.now() >= tokenExpiresAt - 300000) throw new Error('Token expired');
  return token.access_token;
}

/**
 * Push a `my_list_status` update to MAL. Throws on auth/expiry/API failure —
 * callers treat the remote write as non-fatal (local cache is authority) and
 * decide how to surface the error.
 */
export async function updateMalListStatus(animeId: number, updates: MalListStatusUpdate): Promise<unknown> {
  const accessToken = requireToken();

  // MAL expects form-encoded `num_watched_episodes` (not `num_episodes_watched`).
  const malUpdates: Record<string, string> = {};
  if (updates.status !== undefined) malUpdates.status = updates.status;
  if (updates.score !== undefined) malUpdates.score = String(updates.score);
  if (updates.num_episodes_watched !== undefined) malUpdates.num_watched_episodes = String(updates.num_episodes_watched);

  const url = MAL_LIST_STATUS_URL(animeId);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const body = new URLSearchParams(malUpdates).toString();

  // Try PUT first, fall back to PATCH.
  let response = await fetch(url, { method: 'PUT', headers, body });
  if (!response.ok && response.status !== 404) {
    response = await fetch(url, { method: 'PATCH', headers, body });
  }
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MAL API error: ${response.status} - ${errorText}`);
  }
  return response.json();
}

/**
 * Remove the whole list entry — MAL's only way to clear a status, and it takes
 * the score and progress with it (plus `priority`, `tags`, `comments`,
 * `num_times_rewatched` and `rewatch_value`, which this app doesn't model and
 * so cannot restore).
 *
 * **Idempotent, live-verified**: deleting an already-absent entry answered `200`
 * with an empty body, not an error — the opposite of AniList, whose second
 * delete is a 400. A `404` is treated as success too on MAL's documented
 * "entry not in list" behaviour; that branch is *documented, not observed* (the
 * live run returned 200 both times).
 *
 * Throws on auth/expiry/other API failure, same contract as
 * `updateMalListStatus`.
 */
export async function deleteMalListEntry(animeId: number): Promise<void> {
  const accessToken = requireToken();

  const response = await fetch(MAL_LIST_STATUS_URL(animeId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.ok || response.status === 404) return;
  const errorText = await response.text();
  throw new Error(`MAL API error: ${response.status} - ${errorText}`);
}
