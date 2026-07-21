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
import { getAllAnime, upsertAnime, toNum } from '@/lib/store';
import { TUNING } from '@/lib/reco/scoring';
import { RecoEdge, RecommendationsData, saveRecommendationsData } from '@/lib/reco/data';
import { getFeedbackAnime } from '@/lib/reco/feedback';
import { getSeeds, type FeedOptions } from '@/lib/reco/feed';
import { fetchAnilistRecommendations, fetchAnilistCatalogByMalIds } from '@/lib/providers/anilist/sync';
import { MAL_ANIME_FIELDS } from '@/lib/providers/mal/client';

/** Max retries on HTTP 429 before giving up on a single call. */
const MAX_429_RETRIES = 4;

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

interface MalRecommendationsResponse {
  recommendations?: Array<{
    node: { id: number; title: string; main_picture?: { medium: string; large: string } };
    num_recommendations: number;
  }>;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Fetch with retry/backoff on HTTP 429. Returns parsed JSON or throws. */
async function malFetch(url: string, accessToken: string): Promise<any> {
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '', 10);
      const wait = Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * (attempt + 1) * 2;
      await delay(wait);
      continue;
    }
    if (!response.ok) {
      throw new Error(`MAL API request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
  throw new Error('MAL API request failed: rate limited (429) after retries');
}

export async function fetchRecoEdges(animeId: number, accessToken: string): Promise<RecoEdge[]> {
  const url = `https://api.myanimelist.net/v2/anime/${animeId}?fields=recommendations`;
  const data: MalRecommendationsResponse = await malFetch(url, accessToken);
  return (data.recommendations || [])
    .slice(0, TUNING.MAX_RECS_PER_ANIME)
    .map(r => ({ id: r.node.id, num: r.num_recommendations, hop: 1 as const }));
}

async function fetchSuggestions(accessToken: string): Promise<{ id: number; rank: number }[]> {
  const url = `https://api.myanimelist.net/v2/anime/suggestions?limit=100&fields=id,title`;
  const data: any = await malFetch(url, accessToken);
  return (data.data || []).map((item: any, i: number) => ({ id: item.node.id, rank: i + 1 }));
}

async function fetchAnimeDetail(animeId: number, accessToken: string): Promise<MALAnime | null> {
  const url = `https://api.myanimelist.net/v2/anime/${animeId}?fields=${MAL_ANIME_FIELDS}&nsfw=true`;
  try {
    return await malFetch(url, accessToken);
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
 * **`accessToken` is optional — `null` means "no MAL account".** This used to be
 * a required argument behind a `requireMalAuth` 401, which made the feed
 * unreachable on a keyless install even though the engine needs no MAL *account*
 * to work: it is MAL-*id*-keyed, and those ids come free off AniList's own
 * payload. Without a token the two MAL sources (crowd edges, personal
 * suggestions) are skipped and the anonymous AniList crowd source carries the
 * feed alone; candidate hydration falls back to AniList's catalog. Every source
 * reports its own outcome, so a thin feed is explained rather than mysterious —
 * the same shape `similar/[id]` has always had.
 */
export async function performRecommendationsRefresh(
  accessToken: string | null,
  options: FeedOptions,
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
    const seedRecords = [...malSeeds, ...upSeeds];
    // `data.seeds`/`data.anilistSeeds` stay MAL-id-keyed by design (the reco
    // engine's internal math is MAL-keyed — docs/PROVIDER-FREE-CUTOVER.md
    // Phase D/Risks), so seeds are reduced to their MAL id here. Every stored
    // record has a resolvable MAL id (assembleDisplayRow's invariant), but the
    // filter guards rather than assumes.
    const seeds = seedRecords
      .map(record => toNum(record.crosswalk.mal))
      .filter((id): id is number => id !== undefined);

    const data: RecommendationsData = {
      lastRefresh: null,
      seedThreshold: threshold,
      nicheMode: options.nicheMode,
      seeds: {},
      anilistSeeds: {},
      suggestions: [],
    };

    report({ type: 'start', message: `Refreshing recommendations from ${seeds.length} seeds`, totalSeeds: seeds.length });

    // 1-hop crowd-seed. Skipped wholesale with no MAL token — MAL's
    // recommendations endpoint is authenticated, so there is nothing to attempt.
    let edgeCount = 0;
    if (!accessToken) {
      sources.malCrowd = { ok: false, skipped: true, reason: NO_MAL };
      report({ type: 'seed_done', totalSeeds: seeds.length, message: 'MAL crowd recos skipped (no MAL account)' });
    } else {
      for (let i = 0; i < seeds.length; i++) {
        const seedMalId = seeds[i];
        try {
          const edges = await fetchRecoEdges(seedMalId, accessToken);
          data.seeds[seedMalId.toString()] = edges;
          edgeCount += edges.length;
        } catch (error) {
          console.error(`Failed to fetch recos for seed ${seedMalId}:`, error);
          data.seeds[seedMalId.toString()] = [];
        }
        // Persist incrementally (resumability).
        saveRecommendationsData(data);
        report({ type: 'seed_done', currentSeed: i + 1, totalSeeds: seeds.length, edges: edgeCount, message: `Seed ${i + 1}/${seeds.length}` });
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
        data.suggestions = await fetchSuggestions(accessToken);
        saveRecommendationsData(data);
      } catch (error) {
        console.error('Failed to fetch suggestions:', error);
        sources.malSuggestions = { ok: false, reason: error instanceof Error ? error.message : 'Unknown error' };
      }
    }

    // AniList crowd recos for the same seeds (orthogonal source). AniList
    // resolves recs straight to MAL ids, so no crosswalk; batched + throttled
    // inside fetchAnilistRecommendations. Non-fatal — a failure leaves the
    // AniList source empty (weight defaults to 0 anyway).
    try {
      report({ type: 'anilist', message: 'Fetching AniList recommendations...' });
      const anilistRecs = await fetchAnilistRecommendations(
        seeds,
        (done, total) => report({ type: 'anilist', currentSeed: done, totalSeeds: total, message: `AniList ${done}/${total}` })
      );
      const anilistSeeds: Record<string, RecoEdge[]> = {};
      anilistRecs.forEach((edges, seedMalId) => {
        anilistSeeds[seedMalId.toString()] = edges.map(e => ({ id: e.id, num: e.rating, hop: 1 as const }));
      });
      data.anilistSeeds = anilistSeeds;
      saveRecommendationsData(data);
    } catch (error) {
      console.error('Failed to fetch AniList recommendations:', error);
      sources.anilistCrowd = { ok: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }

    // Optional niche 2-hop: recos of each 1-hop candidate, stored under its seed.
    // Rides on the MAL crowd source, so it goes where that goes.
    if (options.nicheMode && accessToken) {
      for (let i = 0; i < seeds.length; i++) {
        const seedKey = seeds[i].toString();
        const oneHop = (data.seeds[seedKey] || []).filter(e => e.hop === 1);
        const hop2: RecoEdge[] = [];
        for (const cand of oneHop) {
          try {
            const edges = await fetchRecoEdges(cand.id, accessToken);
            for (const e of edges) hop2.push({ id: e.id, num: e.num, hop: 2 });
          } catch (error) {
            console.error(`Failed to fetch 2-hop for ${cand.id}:`, error);
          }
          await delay(TUNING.FETCH_DELAY_MS);
        }
        data.seeds[seedKey] = [...(data.seeds[seedKey] || []), ...hop2];
        edgeCount += hop2.length;
        saveRecommendationsData(data);
        report({ type: 'hop2', currentSeed: i + 1, totalSeeds: seeds.length, edges: edgeCount, message: `2-hop ${i + 1}/${seeds.length}` });
      }
    }

    // Hydrate missing titles so the feed can render them. The store is
    // canonical-keyed now, but candidate/edge ids are MAL ids — test coverage
    // against the raw MAL slice's own `.id` (getAllAnime(), unaffected by the
    // AnimeRecord collapse), not the slice's canonical key.
    const existingMalIds = new Set(Object.values(getAllAnime()).map(a => a.id));
    const candidateIds = new Set<number>();
    for (const edges of Object.values(data.seeds)) {
      for (const e of edges) candidateIds.add(e.id);
    }
    for (const edges of Object.values(data.anilistSeeds || {})) {
      for (const e of edges) candidateIds.add(e.id);
    }
    for (const s of data.suggestions) candidateIds.add(s.id);

    const missing = Array.from(candidateIds).filter(id => !existingMalIds.has(id));
    report({ type: 'hydrate', candidates: candidateIds.size, message: `Hydrating ${missing.length} missing titles` });

    // A candidate with no local record is DROPPED by computeFeed — there is no
    // metadata to rank it on. So hydration is what decides whether the feed has
    // content at all, and it must not be MAL-only: without it, a keyless install
    // would gather AniList crowd edges and then render none of them.
    if (accessToken) {
      const hydrated: MALAnime[] = [];
      for (let i = 0; i < missing.length; i++) {
        const detail = await fetchAnimeDetail(missing[i], accessToken);
        if (detail) hydrated.push(detail);
        if (hydrated.length > 0 && hydrated.length % 25 === 0) {
          upsertAnime(hydrated.splice(0)); // flush in batches
          report({ type: 'hydrate', hydrated: i + 1, message: `Hydrated ${i + 1}/${missing.length}` });
        }
        await delay(TUNING.FETCH_DELAY_MS);
      }
      if (hydrated.length > 0) upsertAnime(hydrated);
    } else if (missing.length > 0) {
      // Keyless: AniList's public API answers by MAL id, which is exactly the
      // key candidates already carry — 50 per request instead of one, and the
      // result lands as a `catalog` block that renders through the normal
      // provenance hydration, same as a season-crawled title.
      const result = await fetchAnilistCatalogByMalIds(missing, (done, total) =>
        report({ type: 'hydrate', hydrated: done, message: `Hydrated ${done}/${total} via AniList` })
      );
      sources.hydration = result.failed > 0 && result.hydrated === 0
        ? { ok: false, via: 'anilist', reason: 'Every AniList hydration batch failed' }
        : { ok: true, via: 'anilist' };
    }

    data.lastRefresh = new Date().toISOString();
    saveRecommendationsData(data);

    report({
      type: 'complete',
      // The message names the degraded mode, so a keyless user sees WHY the feed
      // is built from one source rather than silently getting a thinner one.
      message: accessToken
        ? 'Recommendations refresh complete'
        : 'Recommendations refresh complete (AniList only — no MAL account connected)',
      totalSeeds: seeds.length,
      edges: edgeCount,
      hydrated: missing.length,
      sources,
    });

    return { success: true, alreadyRunning: false, seedCount: seeds.length, edgeCount, hydratedCount: missing.length, sources };
  } catch (error) {
    console.error('Recommendations refresh error:', error);
    report({ type: 'error', error: 'Refresh failed', details: error instanceof Error ? error.message : 'Unknown error' });
    return { success: false, alreadyRunning: false, seedCount: 0, edgeCount: 0, hydratedCount: 0, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    isRefreshRunning = false;
  }
}

