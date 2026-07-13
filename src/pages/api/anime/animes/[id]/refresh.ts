import { NextApiRequest, NextApiResponse } from 'next';
import { getAllAnime, upsertAnime, resolveByMalId } from '@/lib/store';
import { getValidMalToken, fetchAnimeById } from '@/lib/mal';
import { refreshAnilistMetaForIds } from '@/lib/anilistSync';
import { performSimklSync } from '@/lib/simklSync';
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

async function refreshMal(
  animeId: number
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const token = getValidMalToken();
  if (!token) {
    return { ok: false, error: 'Not authenticated with MAL' };
  }

  const fetched = await fetchAnimeById(token.access_token, animeId);
  if (!fetched) return { ok: false, error: 'MAL returned no anime' };

  // Merge over the existing record so any field MAL didn't return survives.
  // `animeId` is the outward MAL id; the slice is canonical-keyed. upsertAnime
  // re-resolves `fetched.id` to the same canonical key on write.
  const canonicalId = resolveByMalId(animeId);
  const existing = canonicalId ? getAllAnime()[canonicalId] : undefined;
  upsertAnime([{ ...existing, ...fetched }]);
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
    refreshAnilistMetaForIds([animeId]).catch(e => ({ ok: false, tagged: 0, error: e instanceof Error ? e.message : 'AniList refresh failed' })),
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
