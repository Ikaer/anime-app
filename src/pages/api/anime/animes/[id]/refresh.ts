import { NextApiRequest, NextApiResponse } from 'next';
import { getAllMALAnime, upsertMALAnime, getMALAuthData, isMALTokenValid } from '@/lib/anime';
import { refreshAnilistTagsForIds } from '@/lib/anilistSync';
import { performSimklSync } from '@/lib/simklSync';
import { MALAnime } from '@/models/anime';
import { appendLog } from '@/lib/connectionLog';

/**
 * Refresh a single anime's data from all three sources, on demand (detail page).
 * Each source is independent and non-fatal — the response carries a per-source
 * outcome so the client can show which pipes refilled.
 *
 * - MAL: GET /v2/anime/{id} (single-title catalog + personal status), merged
 *   over the existing local record so unreturned fields are preserved.
 * - AniList: force-refetch tags + staff for this MAL id (bypasses "missing only").
 * - SIMKL: the standard incremental library delta (SIMKL has no per-id read; the
 *   user accepted the incremental sync for the refresh).
 */

// Same field set as the seasonal sync, so a single-title fetch produces a
// complete record (the merge below preserves anything MAL omits regardless).
const MAL_FIELDS = [
  'id', 'title', 'main_picture', 'alternative_titles',
  'start_date', 'end_date', 'synopsis', 'mean', 'rank', 'popularity',
  'num_list_users', 'num_scoring_users', 'nsfw', 'genres',
  'created_at', 'updated_at', 'media_type', 'status',
  'my_list_status', 'num_episodes', 'start_season', 'broadcast',
  'source', 'average_episode_duration', 'rating', 'pictures',
  'background', 'related_anime', 'studios',
].join(',');

async function refreshMal(
  animeId: number
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const { token } = getMALAuthData();
  if (!token || !isMALTokenValid(token)) {
    return { ok: false, error: 'Not authenticated with MAL' };
  }

  const url = `https://api.myanimelist.net/v2/anime/${animeId}?fields=${MAL_FIELDS}&nsfw=true`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!response.ok) {
    return { ok: false, error: `MAL API ${response.status} ${response.statusText}` };
  }

  const fetched = (await response.json()) as MALAnime;
  if (!fetched?.id) return { ok: false, error: 'MAL returned no anime' };

  // Merge over the existing record so any field MAL didn't return survives.
  const existing = getAllMALAnime()[String(animeId)];
  upsertMALAnime([{ ...existing, ...fetched }]);
  return { ok: true };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const animeId = parseInt(req.query.id as string, 10);
  if (!Number.isInteger(animeId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  // Each source is isolated: one failing must not sink the others.
  const [malResult, anilistResult, simklResult] = await Promise.all([
    refreshMal(animeId).catch(e => ({ ok: false, error: e instanceof Error ? e.message : 'MAL refresh failed' })),
    refreshAnilistTagsForIds([animeId]).catch(e => ({ ok: false, tagged: 0, error: e instanceof Error ? e.message : 'AniList refresh failed' })),
    performSimklSync().catch(e => ({ ok: false, phase: 'noop' as const, added: 0, removed: 0, orphansSkipped: 0, error: e instanceof Error ? e.message : 'SIMKL sync failed' })),
  ]);

  appendLog('refresh', 'info', `Per-anime refresh for ${animeId}`, {
    animeId,
    mal: malResult.ok,
    anilist: anilistResult.ok,
    simkl: simklResult.ok,
  });

  return res.status(200).json({
    ok: true,
    mal: malResult,
    anilist: anilistResult,
    simkl: simklResult,
  });
}
