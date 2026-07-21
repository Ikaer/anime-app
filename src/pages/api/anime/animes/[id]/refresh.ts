import { NextApiRequest, NextApiResponse } from 'next';
import { getAllAnime, upsertAnime, getMalIdForCanonical, isCanonicalId, getAllAnilistMeta, getRegistry, toNum } from '@/lib/store';
import { getValidMalToken, fetchAnimeById } from '@/lib/providers/mal/client';
import { refreshAnilistMetaForIds } from '@/lib/providers/anilist/sync';
import { getOrFetchAnilistCast } from '@/lib/providers/anilist/cast';
import { performSimklSync } from '@/lib/providers/simkl/sync';
import { appendLog } from '@/lib/config/connectionLog';

/**
 * Refresh a single anime's data from all three sources, on demand (detail page).
 * Each source is independent and non-fatal — the response carries a per-source
 * outcome so the client can show which pipes refilled.
 *
 * - MAL: GET /v2/anime/{id} (single-title catalog + personal status), merged
 *   over the existing local record so unreturned fields are preserved.
 * - AniList: force-refetch tags + staff + banner + relations, by MAL id when
 *   there is one and by AniList id otherwise (PROVIDER-PARITY.md B2 — this used
 *   to be gated on the MAL id, making the button a no-op for AniList-only
 *   titles even though their AniList id was resolved right here).
 * - SIMKL: the standard incremental library delta (SIMKL has no per-id read; the
 *   user accepted the incremental sync for the refresh).
 */

const NO_MAL_ID: { ok: false; error: string } = { ok: false, error: 'No MAL id known for this title' };
const NO_ANILIST_HANDLE: { ok: false; tagged: number; error: string } =
  { ok: false, tagged: 0, error: 'No MAL or AniList id known for this title' };

async function refreshMal(
  canonicalId: string,
  malId: number
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const token = getValidMalToken();
  if (!token) {
    return { ok: false, error: 'Not authenticated with MAL' };
  }

  const fetched = await fetchAnimeById(token.access_token, malId);
  if (!fetched) return { ok: false, error: 'MAL returned no anime' };

  // Merge over the existing record so any field MAL didn't return survives.
  // upsertAnime re-resolves `fetched.id` to the same canonical key on write.
  const existing = getAllAnime()[canonicalId];
  upsertAnime([{ ...existing, ...fetched }]);
  return { ok: true };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const canonicalId = typeof req.query.id === 'string' ? req.query.id : '';
  if (!isCanonicalId(canonicalId)) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  // The MAL refill needs the real MAL id; a title with none known yet (true
  // AniList-only) can't be queried at all — report, don't crash.
  const malId = getMalIdForCanonical(canonicalId);

  // The AniList id, for the cast AND metadata refetches — it covers AniList-only
  // titles that have no MAL id, which the MAL refill can't touch. The meta slice
  // is authoritative (it's AniList's own `id`, resolved by AniList); the registry
  // crosswalk covers a title the enrichment sync has never reached.
  const anilistId = getAllAnilistMeta()[canonicalId]?.anilist_id
    ?? toNum(getRegistry()[canonicalId]?.anilist);

  // Each source is isolated: one failing must not sink the others.
  const [malResult, anilistResult, simklResult, castResult] = await Promise.all([
    malId !== undefined
      ? refreshMal(canonicalId, malId).catch(e => ({ ok: false, error: e instanceof Error ? e.message : 'MAL refresh failed' }))
      : Promise.resolve(NO_MAL_ID),
    // MAL id preferred (the id space the catalog is anchored on), AniList id as
    // the fallback that makes this work at all on a keyless install.
    malId !== undefined || anilistId !== undefined
      ? refreshAnilistMetaForIds(
          malId !== undefined ? [malId] : [anilistId as number],
          malId !== undefined ? 'mal' : 'anilist'
        ).catch(e => ({ ok: false, tagged: 0, error: e instanceof Error ? e.message : 'AniList refresh failed' }))
      : Promise.resolve(NO_ANILIST_HANDLE),
    performSimklSync().catch(e => ({ ok: false, phase: 'noop' as const, added: 0, removed: 0, orphansSkipped: 0, error: e instanceof Error ? e.message : 'SIMKL sync failed' })),
    // `force` — the point of a manual refresh is to re-pull, and an existing
    // cast entry would otherwise short-circuit the fetch.
    getOrFetchAnilistCast(canonicalId, { malId, anilistId }, true)
      .catch(e => ({ ok: false, cached: false, error: e instanceof Error ? e.message : 'AniList cast refresh failed' })),
  ]);

  appendLog('refresh', 'info', `Per-anime refresh for ${canonicalId}`, {
    canonicalId,
    malId,
    mal: malResult.ok,
    anilist: anilistResult.ok,
    simkl: simklResult.ok,
    cast: castResult.ok,
  });

  return res.status(200).json({
    ok: true,
    mal: malResult,
    anilist: anilistResult,
    simkl: simklResult,
    cast: castResult,
  });
}
