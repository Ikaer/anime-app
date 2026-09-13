/**
 * The FETCH half of "Mon mix" / a box's recos tab — which anchors are asked
 * about, and their crowd edges — lifted out of
 * `api/anime/recommendations/mix.ts`.
 *
 * Lifted for `similarFetch.ts`' reason: a second caller needed the exact same
 * thing. `scripts/probe-profile.js --rank --pool anchored` measures what a reco
 * profile does to a box's recos tab, and it has to run the REAL anchor
 * selection and the REAL edge resolution — a JS copy of either would drift from
 * the route, and a probe that ranks a different pool measures nothing. The
 * ranking itself was already shared (`computeAnchored`).
 *
 * Two properties of the fetch, both deliberate:
 *
 *  - **Edges are cached per anchor for the process's lifetime.** The page
 *    refetches on every add/remove, so without this, adding a 5th anchor would
 *    re-ask MAL about the other four. Crowd edges move on a scale of months —
 *    a stale entry is not a correctness problem, and the cache is dropped on
 *    every deploy. Only successful fetches are cached, so a failed source
 *    retries on the next request.
 *  - **MAL is one request per anchor, AniList is one for all of them** (its
 *    query takes `id_in`, 50 per page), so cost scales with the ANCHORS ADDED,
 *    not with the anchor count.
 *
 * **This is the ingest boundary** (E9): each provider is asked with its own id
 * and the edges it answers with are converted to canonical ids here.
 * Conversion is resolve-only — an edge naming a title the store doesn't know is
 * dropped, which costs nothing because the ranker drops unhydrated candidates
 * anyway (these surfaces deliberately fetch nothing to hydrate).
 *
 * Server-only: reads the store and calls MAL / AniList.
 */

import { getValidMalToken } from '@/lib/providers/mal/client';
import {
  getMalIdForCanonical,
  buildCrosswalkIndexes,
  getAllAnilistMeta,
  getRegistry,
  toNum,
} from '@/lib/store';
import { fetchRecoEdges } from '@/lib/reco/refresh';
import { fetchAnilistRecommendations } from '@/lib/providers/anilist/sync';
import { resolveBoxUnits } from '@/lib/domain/boxUnits';
import type { AnchoredEdge } from '@/lib/reco/anchored';
import type { AnimeRecord, Box, UserGroup } from '@/models/anime';

/** Hard cap on anchors — a guard on the MAL fetch cost, not a UX preference. */
export const MAX_MIX_ANCHORS = 12;

/**
 * The same guard for a `box=` request, an order of magnitude looser.
 *
 * `MAX_MIX_ANCHORS` is small because `ids=` is arbitrary URL input and MAL costs
 * one request per anchor. A box is neither arbitrary nor transient: it is a
 * curated file the owner filled by hand, 20-40 titles by design, and the
 * per-anchor edge cache means the fetch is paid ONCE for the process's life.
 * AniList costs one request for all of them either way (`id_in`).
 *
 * Over the cap, the highest-scored UNITS win — a box's best-loved entries are
 * the ones whose crowd neighbourhoods best describe what the box is, and the
 * anchors are collapsed by group before the cap is applied (see `boxAnchorIds`).
 */
export const MAX_BOX_ANCHORS = 40;

export interface MixSourceOutcome {
  ok: boolean;
  error?: string;
}

/**
 * The anchors a box's recos tab asks about: ONE representative per unit, best-
 * loved units first, capped at `MAX_BOX_ANCHORS`.
 *
 * ⚠️ **Anchors are collapsed by group** (boxesV2 §6.3), the highest-scored
 * member standing for its unit.
 *
 * A representative here, and fractional weights in `rankBoxCandidates` — the
 * two are not inconsistent. The profile ranker reads every member's METADATA,
 * so splitting a unit's vote across its cours keeps a tag all four share at 1
 * and a tag unique to one at 1/4. This fetches CROWD EDGES per anchor: you
 * either ask MAL about a title or you do not, so a fractional weight has nothing
 * to apply to. Asking about seven Demon Slayer cours would return seven
 * near-identical neighbourhoods, eat the `MAX_BOX_ANCHORS` budget with one show,
 * and cost six extra MAL requests.
 *
 * `present` is the box's members already filtered to titles the store knows.
 */
export function boxAnchorIds(
  box: Box,
  present: string[],
  byId: Map<string, AnimeRecord>,
  groups: UserGroup[]
): string[] {
  const units = resolveBoxUnits(box, groups);
  const byScore = (a: string, b: string) =>
    (byId.get(b)!.personal.score || 0) - (byId.get(a)!.personal.score || 0);
  const known = new Set(present);
  return units.units
    .map(unit => unit.members.filter(id => known.has(id)).sort(byScore)[0])
    .filter((id): id is string => !!id)
    // Best-loved units first, because the cap bites here: a box's strongest
    // entries are the ones whose crowd neighbourhoods best describe it.
    .sort(byScore)
    .slice(0, MAX_BOX_ANCHORS);
}

/**
 * What a box has already ANSWERED, dropped from its crowd-anchored ranking.
 *
 * ⚠️ A box's « Oui » (members) and « Non » (excluded) are both answered
 * questions, and must stay answered across a reload — the recos tab once hid
 * them only client-side and every « Non » came back. Members count, not just
 * the anchors: one representative per unit is asked about and the cap bites at
 * 40, so a filed title can still be a crowd neighbour of the rest of the box.
 * Shared by the mix route and the profile preview's `anchored` pool, so the
 * preview cannot show a card the tab would hide.
 */
export function boxAnsweredIds(box: Box): Set<string> {
  return new Set([...box.members, ...(box.excluded ?? [])]);
}

/**
 * Per-anchor edge caches, canonical-keyed. Process-lifetime, no TTL (see above).
 * Module-level, so shared by every importer in the process — today the mix route
 * and the probe script, which run in separate processes anyway.
 */
const malEdgeCache = new Map<string, AnchoredEdge[]>();
const anilistEdgeCache = new Map<string, AnchoredEdge[]>();

/**
 * MAL crowd edges for the anchors missing from the cache, one request each,
 * serially — the same pacing `refresh.ts` uses. Non-fatal as a whole: a failure
 * leaves those anchors contributing no MAL edges and is reported as an outcome.
 */
async function loadMalEdges(anchorIds: string[]): Promise<MixSourceOutcome> {
  const missing = anchorIds.filter(id => !malEdgeCache.has(id));
  if (missing.length === 0) return { ok: true };

  const token = getValidMalToken();
  if (!token) return { ok: false, error: 'Not authenticated with MAL' };

  const { byMal } = buildCrosswalkIndexes();
  try {
    for (const anchorId of missing) {
      const malId = getMalIdForCanonical(anchorId);
      if (malId === undefined) { malEdgeCache.set(anchorId, []); continue; }
      const raw = await fetchRecoEdges(malId, token.access_token);
      malEdgeCache.set(anchorId, raw
        .map(e => ({ anchorId, id: e.malId !== undefined ? byMal.get(e.malId) : undefined, num: e.num }))
        .filter((e): e is AnchoredEdge => e.id !== undefined));
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * AniList crowd edges for the anchors missing from the cache — a single batched
 * query for all of them. An anchor with no AniList id is simply not asked (E8).
 */
async function loadAnilistEdges(anchorIds: string[]): Promise<MixSourceOutcome> {
  const missing = anchorIds.filter(id => !anilistEdgeCache.has(id));
  if (missing.length === 0) return { ok: true };

  const meta = getAllAnilistMeta();
  const registry = getRegistry();
  const anilistIdOf = new Map<string, number>();
  for (const id of missing) {
    const anilistId = meta[id]?.anilist_id ?? toNum(registry[id]?.anilist);
    if (anilistId !== undefined) anilistIdOf.set(id, anilistId);
    else anilistEdgeCache.set(id, []); // nothing to ask AniList about
  }
  if (anilistIdOf.size === 0) return { ok: true };

  try {
    const recs = await fetchAnilistRecommendations([...anilistIdOf.values()]);
    const { byMal, byAnilist } = buildCrosswalkIndexes();
    for (const [anchorId, anilistId] of anilistIdOf) {
      // An AniList-only rec resolves through its own id first, its MAL id second (E11).
      anilistEdgeCache.set(anchorId, (recs.get(anilistId) || [])
        .map(e => ({
          anchorId,
          id: byAnilist.get(e.anilistId) ?? (e.malId !== undefined ? byMal.get(e.malId) : undefined),
          num: e.rating,
        }))
        .filter((e): e is AnchoredEdge => e.id !== undefined));
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Both pipes in parallel, each non-fatal: MAL needs auth, AniList needs none.
 * The caller decides what "both failed" means for it (the route answers 502).
 */
export async function loadMixEdges(anchorIds: string[]): Promise<{
  sources: { mal: MixSourceOutcome; anilist: MixSourceOutcome };
  malEdges: AnchoredEdge[];
  anilistEdges: AnchoredEdge[];
}> {
  const [mal, anilist] = await Promise.all([loadMalEdges(anchorIds), loadAnilistEdges(anchorIds)]);
  return {
    sources: { mal, anilist },
    malEdges: anchorIds.flatMap(id => malEdgeCache.get(id) || []),
    anilistEdges: anchorIds.flatMap(id => anilistEdgeCache.get(id) || []),
  };
}
