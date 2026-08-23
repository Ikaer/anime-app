import { NextApiRequest, NextApiResponse } from 'next';
import { getValidMalToken } from '@/lib/providers/mal/client';
import {
  getAnimeForDisplay,
  getMalIdForCanonical,
  isCanonicalId,
  buildCrosswalkIndexes,
  getAllAnilistMeta,
  getRegistry,
  toNum,
} from '@/lib/store';
import { computeAnchored, type AnchoredEdge } from '@/lib/reco/anchored';
import { getBox } from '@/lib/reco/boxes';
import { fetchRecoEdges } from '@/lib/reco/refresh';
import { fetchAnilistRecommendations } from '@/lib/providers/anilist/sync';
import { applyNarrowingFilters, getPrimaryTitle } from '@/lib/domain/animeUtils';
import { parseSourceWeights, resolveWeights, ANCHORED_WEIGHTS } from '@/lib/reco/weights';
import { getTitleLanguage } from '@/lib/config/settings';
import type { AnimeRecord, RecoMeta } from '@/models/anime';

/**
 * "Mon mix" — crowd recommendations anchored on a HAND-PICKED SET of anime,
 * ranked with the same weighted-source model as the "Pour toi" feed. The middle
 * ground between the detail page's single-target drill-down and the global feed:
 * the user chooses the seeds instead of their whole list deciding them.
 *
 * The ranking is `computeAnchored` (shared with "Plus comme ça"); this route
 * owns the FETCH half, which is where the two surfaces genuinely differ:
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
 * **This route is the ingest boundary** (E9): each provider is asked with its
 * own id and the edges it answers with are converted to canonical ids here.
 * Conversion is resolve-only — an edge naming a title the store doesn't know is
 * dropped, which costs nothing because the ranker drops unhydrated candidates
 * anyway (this page deliberately fetches nothing to hydrate).
 *
 * Stateless: nothing is persisted, and the stored `RecommendationsData` is
 * neither read nor written.
 */

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
 * Over the cap, the highest-scored members win — a box's best-loved entries are
 * the ones whose crowd neighbourhoods best describe what the box is.
 */
export const MAX_BOX_ANCHORS = 40;

export interface MixSourceOutcome {
  ok: boolean;
  error?: string;
}

/** Per-anchor edge caches, canonical-keyed. Process-lifetime, no TTL (see above). */
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  // Two ways in: `ids=` is /mix's hand-picked set, `box=` is a saved one. The
  // ranking is identical — a box IS an anchor set, which is the whole reason its
  // members are stored as a flat id array — so only the cap and the ordering
  // rule differ.
  const boxParam = typeof req.query.box === 'string' ? req.query.box.trim() : '';
  const box = boxParam ? getBox(boxParam) : undefined;
  if (boxParam && !box) return res.status(404).json({ error: 'Box not found' });

  const requested = box
    ? box.members
    : (typeof req.query.ids === 'string' ? req.query.ids : '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
  if (requested.some(id => !isCanonicalId(id))) {
    return res.status(400).json({ error: 'Invalid anime id' });
  }

  const titleLang = getTitleLanguage();
  const records = getAnimeForDisplay();
  const byId = new Map(records.map(a => [a.id, a]));
  // Unknown ids are dropped rather than 400'd: a bookmarked mix must survive an
  // anchor disappearing from the store, and the response says which were kept.
  let anchorIds = Array.from(new Set(requested)).filter(id => byId.has(id));
  if (box) {
    anchorIds = anchorIds
      .sort((a, b) => (byId.get(b)!.personal.score || 0) - (byId.get(a)!.personal.score || 0))
      .slice(0, MAX_BOX_ANCHORS);
  } else {
    anchorIds = anchorIds.slice(0, MAX_MIX_ANCHORS);
  }
  const anchors = anchorIds.map(id => {
    const a = byId.get(id)!;
    return { id, title: getPrimaryTitle(a, titleLang), poster: a.catalog.mainPicture?.medium || a.catalog.mainPicture?.large };
  });

  if (anchorIds.length === 0) {
    return res.json({ animes: [], total: 0, anchors: [], sources: { mal: { ok: true }, anilist: { ok: true } } });
  }

  const lang = req.query.lang === 'en' ? 'en' : 'fr';
  // Overrides land on the ANCHORED base, not the feed's — the URL only carries
  // what the sliders moved off it.
  const weights = resolveWeights(
    parseSourceWeights(typeof req.query.w === 'string' ? req.query.w : undefined),
    ANCHORED_WEIGHTS
  );
  // Seen titles are excluded by default here (unlike the drill-down): the pool
  // is N anchors wide and the question is what to watch NEXT.
  const includeSeen = req.query.includeSeen === 'true';

  const { mediaType, search, minScore, maxScore, minYear, maxYear, genres } = req.query;
  const narrowing = {
    mediaTypes: typeof mediaType === 'string' && mediaType.trim() !== ''
      ? mediaType.split(',').map(t => t.trim()).filter(Boolean)
      : undefined,
    search: typeof search === 'string' ? search : undefined,
    minScore: typeof minScore === 'string' ? parseFloat(minScore) : null,
    maxScore: typeof maxScore === 'string' ? parseFloat(maxScore) : null,
    minYear: typeof minYear === 'string' ? parseInt(minYear, 10) : null,
    maxYear: typeof maxYear === 'string' ? parseInt(maxYear, 10) : null,
    genres: typeof genres === 'string' && genres.trim() !== ''
      ? genres.split(',').map(g => g.trim()).filter(Boolean)
      : undefined,
  };

  try {
    // Both pipes in parallel, each non-fatal: MAL needs auth, AniList needs none.
    const [mal, anilist] = await Promise.all([loadMalEdges(anchorIds), loadAnilistEdges(anchorIds)]);
    if (!mal.ok && !anilist.ok) {
      return res.status(502).json({ error: 'Both recommendation sources failed', sources: { mal, anilist } });
    }

    const malEdges = anchorIds.flatMap(id => malEdgeCache.get(id) || []);
    const anilistEdges = anchorIds.flatMap(id => anilistEdgeCache.get(id) || []);

    const ranked = computeAnchored(anchorIds, malEdges, anilistEdges, {
      weights,
      excludeSeen: !includeSeen,
      lang,
      titleLang,
    });

    // Projected into the feed's card shape, so `/mix` renders through the same
    // `AnimeCardView` + "Pourquoi ?" explain as "Pour toi". `topSeeds` names the
    // anchors that backed the card — with several anchors that IS meaningful,
    // which is exactly why the drill-down's lean shape doesn't fit here.
    const animes: (AnimeRecord & { recoMeta: RecoMeta })[] = ranked.map(item => ({
      ...item.anime,
      recoMeta: {
        affinityScore: item.score,
        topSeeds: item.perAnchor.slice(0, 3),
        totalSeeds: item.perAnchor.length,
        fromSuggestions: false,
        breakdown: item.breakdown,
      },
    }));

    const filtered = applyNarrowingFilters(animes, narrowing);
    res.json({ animes: filtered, total: filtered.length, anchors, sources: { mal, anilist } });
  } catch (error) {
    console.error('Mix recommendations error:', error);
    res.status(500).json({
      error: 'Failed to compute the mix',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
