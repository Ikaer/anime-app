/**
 * MAL personal-list write path (server-only). Extracted so both the
 * status endpoint and the tier-list rating endpoint share one implementation.
 * Writes `my_list_status` via the MAL API (PUT, falling back to PATCH).
 */
import { getMALAuthData } from '@/lib/anime';

export interface MalListStatusUpdate {
  status?: string;
  score?: number;
  num_episodes_watched?: number;
}

/**
 * Push a `my_list_status` update to MAL. Throws on auth/expiry/API failure —
 * callers treat the remote write as non-fatal (local cache is authority) and
 * decide how to surface the error.
 */
export async function updateMalListStatus(animeId: number, updates: MalListStatusUpdate): Promise<unknown> {
  const { token } = getMALAuthData();
  if (!token) throw new Error('Not authenticated with MAL');

  // Token expiry with a 5-minute buffer.
  const now = Date.now();
  const tokenExpiresAt = token.created_at + token.expires_in * 1000;
  if (now >= tokenExpiresAt - 300000) throw new Error('Token expired');

  // MAL expects form-encoded `num_watched_episodes` (not `num_episodes_watched`).
  const malUpdates: Record<string, string> = {};
  if (updates.status !== undefined) malUpdates.status = updates.status;
  if (updates.score !== undefined) malUpdates.score = String(updates.score);
  if (updates.num_episodes_watched !== undefined) malUpdates.num_watched_episodes = String(updates.num_episodes_watched);

  const url = `https://api.myanimelist.net/v2/anime/${animeId}/my_list_status`;
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
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
