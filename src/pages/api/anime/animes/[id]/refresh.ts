import { NextApiRequest, NextApiResponse } from 'next';
import { getAllAnime, upsertAnime, getMalIdForCanonical, isCanonicalId, getAllAnilistMeta, getRegistry, toNum } from '@/lib/store';
import { getValidMalToken, fetchAnimeById } from '@/lib/providers/mal/client';
import { refreshAnilistMetaForIds } from '@/lib/providers/anilist/sync';
import { getOrFetchAnilistCast } from '@/lib/providers/anilist/cast';
import { importAnilistPersonalList } from '@/lib/providers/anilist/personalSync';
import { performSimklSync } from '@/lib/providers/simkl/sync';
import { isPersonalProviderEnabled } from '@/lib/providers/registry';
import { appendLog } from '@/lib/config/connectionLog';

/**
 * Refresh a single anime's data from all three sources, on demand (detail page,
 * discrepancies table). Each source is independent and non-fatal — the response
 * carries a per-source outcome so the client can show which pipes refilled.
 *
 * - MAL: GET /v2/anime/{id} (single-title catalog + personal status), merged
 *   over the existing local record so unreturned fields are preserved.
 * - AniList catalog: force-refetch tags + staff + banner + relations, **by
 *   AniList id** — the only id space AniList is queried in (E8). A title with no
 *   AniList id is one AniList has never returned; finding it is the season
 *   crawl's job, not this button's.
 * - AniList personal: the viewer's list import. **Every provider whose PERSONAL
 *   state this button is expected to re-read has to be here** — that is the
 *   whole point on the discrepancies page, where the button exists to make a
 *   resolved disagreement go away. Leaving AniList out made it the one provider
 *   a refresh could never clear, while the badge still reported "AniList ✓" off
 *   the catalog refetch above. Like SIMKL below it has no per-title read, so the
 *   whole-list call is what a single-title refresh runs — and unlike SIMKL's
 *   delta that is a SINGLE GraphQL request (`MediaListCollection` is not
 *   paginated), so it is the cheapest pipe here, not the most expensive.
 * - SIMKL: the standard incremental library delta (SIMKL has no per-id read; the
 *   user accepted the incremental sync for the refresh).
 */

const NO_MAL_ID: { ok: false; error: string } = { ok: false, error: 'No MAL id known for this title' };
const NO_ANILIST_HANDLE: { ok: false; tagged: number; error: string } =
  { ok: false, tagged: 0, error: 'No AniList id known for this title' };

/**
 * Not connected is `ok: true, skipped: true` — the same distinction cron-sync
 * draws. A provider the user never linked must not render as a failed pipe.
 */
const NO_ANILIST_ACCOUNT: { ok: true; skipped: true; imported: number; reason: string } =
  { ok: true, skipped: true, imported: 0, reason: 'No AniList account connected' };

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
  const [malResult, anilistResult, anilistPersonalResult, simklResult, castResult] = await Promise.all([
    malId !== undefined
      ? refreshMal(canonicalId, malId).catch(e => ({ ok: false, error: e instanceof Error ? e.message : 'MAL refresh failed' }))
      : Promise.resolve(NO_MAL_ID),
    // AniList id only. This used to prefer the MAL id and fall back to AniList's;
    // E8 removed the MAL branch, so a title with no AniList id reports that
    // rather than issuing a `Media(idMal:)` lookup that could only miss.
    anilistId !== undefined
      ? refreshAnilistMetaForIds([anilistId])
          .catch(e => ({ ok: false, tagged: 0, error: e instanceof Error ? e.message : 'AniList refresh failed' }))
      : Promise.resolve(NO_ANILIST_HANDLE),
    // Full-replace list import, gated on the one enablement predicate rather
    // than on this title having an AniList id: the import is by viewer, not by
    // title, and a title absent from the list is exactly what a full replace
    // has to be able to express.
    isPersonalProviderEnabled('anilist')
      ? importAnilistPersonalList()
          .catch(e => ({ ok: false, imported: 0, error: e instanceof Error ? e.message : 'AniList list import failed' }))
      : Promise.resolve(NO_ANILIST_ACCOUNT),
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
    anilistPersonal: anilistPersonalResult.ok,
    simkl: simklResult.ok,
    cast: castResult.ok,
  });

  return res.status(200).json({
    ok: true,
    mal: malResult,
    anilist: anilistResult,
    anilistPersonal: anilistPersonalResult,
    simkl: simklResult,
    cast: castResult,
  });
}
