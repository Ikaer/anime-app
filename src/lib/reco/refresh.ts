/**
 * The expensive FETCH half of the engine: seeds -> crowd edges (+ the optional
 * 2-hop), MAL suggestions, AniList crowd recos, then hydration of the candidates
 * the local catalog is missing. Everything it gathers lands in
 * `cache/recommendations.json` (`data.ts`); `feed.ts` re-ranks it live from
 * there, so a knob change never comes back through here.
 *
 * Server-only. Holds a module-level lock so two runs cannot overlap.
 */

import { MALAnime } from '@/models/anime';
import { getAnimeForDisplay, upsertAnime, buildCrosswalkIndexes, toNum } from '@/lib/store';
import { TUNING } from '@/lib/reco/scoring';
import { RecoEdge, RecommendationsData, saveRecommendationsData } from '@/lib/reco/data';
import { getFeedbackAnime } from '@/lib/reco/feedback';
import { getSeeds, type FeedOptions } from '@/lib/reco/feed';
import { fetchAnilistRecommendations, fetchAnilistCatalog } from '@/lib/providers/anilist/sync';
import {
  fetchAnimeById,
  fetchAnimeRecommendations,
  fetchUserSuggestions,
} from '@/lib/providers/mal/client';

export interface RecoRefreshProgress {
  type: 'start' | 'progress' | 'seed_done' | 'suggestions' | 'anilist' | 'hop2' | 'hydrate' | 'complete' | 'error';
  message?: string;
  totalSeeds?: number;
  currentSeed?: number;
  edges?: number;
  candidates?: number;
  hydrated?: number;
  error?: string;
  details?: string;
  /** Set on the terminal `complete` event: which pipes ran, which were skipped. */
  sources?: RecoRefreshSources;
}

/**
 * Per-source outcome of a refresh — the same "declare the asymmetry rather than
 * hide it" shape `similar/[id]` already returns, so the UI can say *which* pipe
 * was unavailable instead of showing a silently thinner feed.
 */
export interface RecoRefreshSources {
  /** MAL crowd edges (and the optional 2-hop). Needs a MAL token. */
  malCrowd: { ok: boolean; skipped?: boolean; reason?: string };
  /** MAL personal suggestions. Needs a MAL token. */
  malSuggestions: { ok: boolean; skipped?: boolean; reason?: string };
  /** AniList crowd recos. Anonymous — available on any install. */
  anilistCrowd: { ok: boolean; skipped?: boolean; reason?: string };
  /** Which provider filled in the missing candidates' catalog data. */
  hydration: { ok: boolean; via: 'mal' | 'anilist' | 'none'; reason?: string };
}

export interface RecoRefreshResult {
  success: boolean;
  alreadyRunning: boolean;
  seedCount: number;
  edgeCount: number;
  hydratedCount: number;
  sources?: RecoRefreshSources;
  error?: string;
}

// ============================================================================
// Fetch / refresh
// ============================================================================

// Module-level lock to prevent concurrent refresh runs.
let isRefreshRunning = false;

export function isRecommendationsRefreshRunning(): boolean {
  return isRefreshRunning;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A crowd edge as it ARRIVES — still in the provider's id space, before the
 * boundary conversion in `persist()` turns it into a canonical-keyed `RecoEdge`.
 *
 * Both id fields are optional and at least one is always set: MAL's endpoint
 * yields `malId`, AniList's yields `anilistId` plus `malId` when AniList knows
 * one. Carrying both is what lets an edge resolve through whichever crosswalk
 * entry exists, and is why an AniList-only recommendation is no longer dropped.
 */
export interface RawEdge {
  malId?: number;
  anilistId?: number;
  num: number;
  hop: 1 | 2;
}

/**
 * The target's crowd edges, capped at MAL's own per-anime ceiling. Thin over
 * `providers/mal/client.ts` — the cap and the `hop` tag are recommender
 * concerns, the HTTP is not. Returns RAW (MAL-id) edges; converting them is the
 * caller's job, at its ingest boundary.
 */
export async function fetchRecoEdges(animeId: number, accessToken: string): Promise<RawEdge[]> {
  const edges = await fetchAnimeRecommendations(accessToken, animeId);
  return edges
    .slice(0, TUNING.MAX_RECS_PER_ANIME)
    .map(e => ({ malId: e.id, num: e.num, hop: 1 as const }));
}

/** One candidate's full catalog record. Non-fatal: a dead title is skipped. */
async function fetchAnimeDetail(animeId: number, accessToken: string): Promise<MALAnime | null> {
  try {
    return (await fetchAnimeById(accessToken, animeId)) ?? null;
  } catch (error) {
    console.error(`Failed to hydrate anime ${animeId}:`, error);
    return null;
  }
}

/**
 * Run the expensive refresh: seeds -> recos (+ optional 2-hop), suggestions,
 * hydrate missing titles. Persists edges incrementally so an interruption does
 * not restart from zero. Holds a module-level lock (409 via the route).
 *
 * **`accessToken` is optional — `null` means "no MAL account".** The engine
 * needs MAL *ids*, which come free off AniList's own payload, not a MAL
 * *session*; do not put an auth gate in front of it. Without a token the two MAL
 * sources (crowd edges, personal suggestions) are skipped and the anonymous
 * AniList crowd source carries the feed alone, with candidate hydration falling
 * back to AniList's catalog. Every source reports its own outcome, so a thin
 * feed is explained rather than mysterious.
 */
export async function performRecommendationsRefresh(
  accessToken: string | null,
  // Only `nicheMode`/`threshold` are read below — this is the FETCH half, not
  // the ranking half, so it has no use for `FeedOptions`' ranking-only fields
  // (`titleLang` included). `Pick` rather than the whole interface so a caller
  // building this options bag never has to fabricate a title-language pref it
  // has no reason to hold.
  options: Pick<FeedOptions, 'nicheMode' | 'threshold'>,
  progress?: (p: RecoRefreshProgress) => void
): Promise<RecoRefreshResult> {
  if (isRefreshRunning) {
    return { success: false, alreadyRunning: true, seedCount: 0, edgeCount: 0, hydratedCount: 0 };
  }
  isRefreshRunning = true;

  const report = (p: RecoRefreshProgress) => { if (progress) progress(p); };
  const NO_MAL = 'No MAL account connected';
  const sources: RecoRefreshSources = {
    malCrowd: { ok: true },
    malSuggestions: { ok: true },
    anilistCrowd: { ok: true },
    hydration: { ok: true, via: accessToken ? 'mal' : 'anilist' },
  };

  try {
    const threshold = options.threshold ?? TUNING.DEFAULT_SEED_THRESHOLD;
    // Seeds = high-scored MAL completions ∪ 👍 "bonnes pioches". The latter let
    // an explicit endorsement pull in fresh crowd candidates (they're already
    // hydrated — they came from the feed — so no extra detail fetch is needed).
    const malSeeds = getSeeds(threshold);
    const seenSeed = new Set(malSeeds.map(s => s.id));
    const upSeeds = getFeedbackAnime('up').filter(a => !seenSeed.has(a.id));
    // Seeds are RECORDS, and each provider call takes that record's own id out
    // of the crosswalk (E9). A seed with no MAL id simply isn't asked of MAL;
    // one with no AniList id isn't asked of AniList. Neither disqualifies it
    // from the other source, which the old "reduce every seed to a MAL id"
    // step quietly did.
    const seedRecords = [...malSeeds, ...upSeeds];

    // Raw, provider-keyed accumulation. It is deliberately NOT what gets
    // persisted: `cache/recommendations.json` is canonical-keyed (E10), and the
    // conversion happens in `persist()` below, after hydration has had a chance
    // to mint the ids these edges point at.
    const malEdgesBySeed = new Map<string, RawEdge[]>();
    const anilistEdgesBySeed = new Map<string, RawEdge[]>();
    let rawSuggestions: { malId: number; rank: number }[] = [];

    /**
     * Convert everything gathered so far onto canonical ids and write it out.
     *
     * `buildCrosswalkIndexes()` is resolve-only, so an edge naming a title the
     * store has never heard of is DROPPED rather than minting a registry entry
     * with no slice behind it. That is not data loss: `computeFeed` drops any
     * candidate with no local record anyway, and hydration (which runs before
     * the final call) is what turns a worth-keeping candidate into a resolvable
     * one.
     */
    // Built once and reused across the incremental saves: nothing in the fetch
    // phase mints a canonical id, so the registry is static until hydration —
    // which is why the final `persist()` rebuilds it (see below).
    let indexes = buildCrosswalkIndexes();
    const persist = (lastRefresh: string | null = null): RecommendationsData => {
      const { byMal, byAnilist } = indexes;
      const canonical = (e: RawEdge): string | undefined =>
        (e.anilistId !== undefined ? byAnilist.get(e.anilistId) : undefined)
        ?? (e.malId !== undefined ? byMal.get(e.malId) : undefined);
      const convert = (bySeed: Map<string, RawEdge[]>): Record<string, RecoEdge[]> => {
        const out: Record<string, RecoEdge[]> = {};
        for (const [seedCanonicalId, edges] of bySeed) {
          out[seedCanonicalId] = edges
            .map(e => ({ id: canonical(e), num: e.num, hop: e.hop }))
            .filter((e): e is RecoEdge => e.id !== undefined);
        }
        return out;
      };
      const data: RecommendationsData = {
        lastRefresh,
        seedThreshold: threshold,
        nicheMode: options.nicheMode,
        seeds: convert(malEdgesBySeed),
        anilistSeeds: convert(anilistEdgesBySeed),
        suggestions: rawSuggestions
          .map(s => ({ id: byMal.get(s.malId), rank: s.rank }))
          .filter((s): s is { id: string; rank: number } => s.id !== undefined),
      };
      saveRecommendationsData(data);
      return data;
    };

    const totalSeeds = seedRecords.length;
    report({ type: 'start', message: `Refreshing recommendations from ${totalSeeds} seeds`, totalSeeds });

    // 1-hop crowd-seed. Skipped wholesale with no MAL token — MAL's
    // recommendations endpoint is authenticated, so there is nothing to attempt.
    let edgeCount = 0;
    if (!accessToken) {
      sources.malCrowd = { ok: false, skipped: true, reason: NO_MAL };
      report({ type: 'seed_done', totalSeeds, message: 'MAL crowd recos skipped (no MAL account)' });
    } else {
      for (let i = 0; i < seedRecords.length; i++) {
        const seed = seedRecords[i];
        const seedMalId = toNum(seed.crosswalk.mal);
        if (seedMalId === undefined) continue; // MAL cannot be asked about this seed
        try {
          const edges = await fetchRecoEdges(seedMalId, accessToken);
          malEdgesBySeed.set(seed.id, edges);
          edgeCount += edges.length;
        } catch (error) {
          console.error(`Failed to fetch recos for seed ${seed.id} (mal ${seedMalId}):`, error);
          malEdgesBySeed.set(seed.id, []);
        }
        // Persist incrementally, so an interrupted run leaves usable partial
        // results rather than nothing.
        persist();
        report({ type: 'seed_done', currentSeed: i + 1, totalSeeds, edges: edgeCount, message: `Seed ${i + 1}/${totalSeeds}` });
        await delay(TUNING.FETCH_DELAY_MS);
      }
    }

    // MAL personal suggestions (orthogonal source) — authenticated by nature:
    // they are suggestions *for the logged-in user*, so there is no keyless
    // equivalent to fall back to.
    if (!accessToken) {
      sources.malSuggestions = { ok: false, skipped: true, reason: NO_MAL };
    } else {
      try {
        report({ type: 'suggestions', message: 'Fetching personal suggestions...' });
        rawSuggestions = (await fetchUserSuggestions(accessToken)).map(s => ({ malId: s.id, rank: s.rank }));
        persist();
      } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        sources.malSuggestions = { ok: false, reason: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // AniList crowd recos for the same seeds (orthogonal source), asked of
    // AniList by AniList ids and answering with both ids per edge (E8/E11).
    // Batched + throttled inside `fetchAnilistRecommendations`. Non-fatal — a
    // failure leaves the AniList source empty (weight defaults to 0 anyway).
    try {
      report({ type: 'anilist', message: 'Fetching AniList recommendations...' });
      // Seed AniList ids, and the way back to the seed RECORD they belong to:
      // the response is keyed by the id we asked with, and the cache is keyed by
      // canonical id.
      const seedCanonicalByAnilistId = new Map<number, string>();
      for (const seed of seedRecords) {
        const anilistId = seed.sources.anilist?.anilist_id ?? toNum(seed.crosswalk.anilist);
        if (anilistId !== undefined && !seedCanonicalByAnilistId.has(anilistId)) {
          seedCanonicalByAnilistId.set(anilistId, seed.id);
        }
      }
      const anilistRecs = await fetchAnilistRecommendations(
        [...seedCanonicalByAnilistId.keys()],
        (done, total) => report({ type: 'anilist', currentSeed: done, totalSeeds: total, message: `AniList ${done}/${total}` })
      );
      anilistRecs.forEach((edges, seedAnilistId) => {
        const seedCanonicalId = seedCanonicalByAnilistId.get(seedAnilistId);
        if (!seedCanonicalId) return;
        anilistEdgesBySeed.set(
          seedCanonicalId,
          edges.map(e => ({ anilistId: e.anilistId, malId: e.malId, num: e.rating, hop: 1 as const }))
        );
      });
      persist();
    } catch (error) {
      console.error('Failed to fetch AniList recommendations:', error);
      sources.anilistCrowd = { ok: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Optional niche 2-hop: recos of each 1-hop candidate, stored under its seed.
    // Rides on the MAL crowd source, so it goes where that goes.
    if (options.nicheMode && accessToken) {
      for (let i = 0; i < seedRecords.length; i++) {
        const seedCanonicalId = seedRecords[i].id;
        const oneHop = (malEdgesBySeed.get(seedCanonicalId) || []).filter(e => e.hop === 1);
        const hop2: RawEdge[] = [];
        for (const cand of oneHop) {
          if (cand.malId === undefined) continue; // MAL's endpoint takes MAL ids
          try {
            const edges = await fetchRecoEdges(cand.malId, accessToken);
            for (const e of edges) hop2.push({ malId: e.malId, num: e.num, hop: 2 });
          } catch (error) {
            console.error(`Failed to fetch 2-hop for mal ${cand.malId}:`, error);
          }
          await delay(TUNING.FETCH_DELAY_MS);
        }
        malEdgesBySeed.set(seedCanonicalId, [...(malEdgesBySeed.get(seedCanonicalId) || []), ...hop2]);
        edgeCount += hop2.length;
        persist();
        report({ type: 'hop2', currentSeed: i + 1, totalSeeds, edges: edgeCount, message: `2-hop ${i + 1}/${totalSeeds}` });
      }
    }

    // Hydrate missing titles so the feed can render them.
    //
    // "Missing" means **no usable local record**, not "absent from the MAL
    // catalog slice". That distinction is E11's doing: an AniList-only candidate
    // will never have a MAL slice, so the old test re-hydrated it on every
    // single run and never converged — the same negative-caching shape E8
    // removed from the metadata sync.
    const { byMal, byAnilist } = indexes;
    const usable = new Set(getAnimeForDisplay().filter(a => a.catalog.title !== '').map(a => a.id));
    const candidates = new Map<string, RawEdge>(); // deduped by provider-id pair
    for (const edges of [...malEdgesBySeed.values(), ...anilistEdgesBySeed.values()]) {
      for (const e of edges) candidates.set(`${e.malId ?? ''}/${e.anilistId ?? ''}`, e);
    }
    for (const s of rawSuggestions) candidates.set(`${s.malId}/`, { malId: s.malId, num: 0, hop: 1 });

    const missing = [...candidates.values()].filter(e => {
      const canonicalId = (e.anilistId !== undefined ? byAnilist.get(e.anilistId) : undefined)
        ?? (e.malId !== undefined ? byMal.get(e.malId) : undefined);
      return canonicalId === undefined || !usable.has(canonicalId);
    });
    report({ type: 'hydrate', candidates: candidates.size, message: `Hydrating ${missing.length} missing titles` });

    // A candidate with no local record is DROPPED by computeFeed — there is no
    // metadata to rank it on. So hydration is what decides whether the feed has
    // content at all.
    //
    // The split is by WHICH ID THE CANDIDATE HAS, not by whether a MAL account
    // exists. With a token, MAL's one-at-a-time detail endpoint handles anything
    // holding a MAL id — but an AniList-ONLY candidate has nothing MAL can be
    // asked about, so it goes to AniList regardless. That case is new: before
    // E11 those edges were discarded at fetch time for lacking an `idMal`, which
    // is precisely the coverage a keyless install exists to surface. Sending
    // them down the `else` branch would have quietly re-lost them for anyone
    // with a MAL account.
    //
    // De-duplicated because one title can arrive as several edges (a MAL edge
    // keyed `mal only`, an AniList edge keyed `mal + anilist`), and a duplicate
    // here is a duplicate HTTP request.
    const missingMalIds = [...new Set(missing.map(e => e.malId).filter((id): id is number => id !== undefined))];
    const missingAnilistOnlyIds = [...new Set(
      missing.filter(e => e.malId === undefined).map(e => e.anilistId).filter((id): id is number => id !== undefined)
    )];
    const missingAnilistIds = [...new Set(missing.map(e => e.anilistId).filter((id): id is number => id !== undefined))];

    if (accessToken) {
      const hydrated: MALAnime[] = [];
      for (let i = 0; i < missingMalIds.length; i++) {
        const detail = await fetchAnimeDetail(missingMalIds[i], accessToken);
        if (detail) hydrated.push(detail);
        if (hydrated.length > 0 && hydrated.length % 25 === 0) {
          upsertAnime(hydrated.splice(0)); // flush in batches
          report({ type: 'hydrate', hydrated: i + 1, message: `Hydrated ${i + 1}/${missingMalIds.length}` });
        }
        await delay(TUNING.FETCH_DELAY_MS);
      }
      if (hydrated.length > 0) upsertAnime(hydrated);
      // The AniList-only remainder, batched 50 per request.
      if (missingAnilistOnlyIds.length > 0) {
        await fetchAnilistCatalog(missingAnilistOnlyIds, (done, total) =>
          report({ type: 'hydrate', hydrated: done, message: `Hydrated ${done}/${total} AniList-only titles` })
        );
      }
    } else if (missingAnilistIds.length > 0) {
      // Keyless: the candidates came from AniList's own recommendation edges and
      // carry AniList's id (E11), so AniList is asked with its own key — 50 per
      // request instead of one, landing as a `catalog` block that renders through
      // the normal provenance hydration, same as a season-crawled title.
      const result = await fetchAnilistCatalog(missingAnilistIds, (done, total) =>
        report({ type: 'hydrate', hydrated: done, message: `Hydrated ${done}/${total} via AniList` })
      );
      sources.hydration = result.failed > 0 && result.hydrated === 0
        ? { ok: false, via: 'anilist', reason: 'Every AniList hydration batch failed' }
        : { ok: true, via: 'anilist' };
    }

    // Final conversion, against a REBUILT index: hydration has just minted
    // canonical ids for the titles it landed, so this pass resolves the edges
    // every earlier persist had to drop.
    indexes = buildCrosswalkIndexes();
    persist(new Date().toISOString());

    report({
      type: 'complete',
      // The message names the degraded mode, so a keyless user sees WHY the feed
      // is built from one source rather than silently getting a thinner one.
      message: accessToken
        ? 'Recommendations refresh complete'
        : 'Recommendations refresh complete (AniList only — no MAL account connected)',
      totalSeeds,
      edges: edgeCount,
      hydrated: missing.length,
      sources,
    });

    return { success: true, alreadyRunning: false, seedCount: totalSeeds, edgeCount, hydratedCount: missing.length, sources };
  } catch (error) {
    console.error('Recommendations refresh error:', error);
    report({ type: 'error', error: 'Refresh failed', details: error instanceof Error ? error.message : 'Unknown error' });
    return { success: false, alreadyRunning: false, seedCount: 0, edgeCount: 0, hydratedCount: 0, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    isRefreshRunning = false;
  }
}

