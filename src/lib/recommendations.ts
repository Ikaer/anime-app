/**
 * "Pour toi" recommendation engine — crowd-seeded MAL recommendations.
 *
 * Server-only (uses fs). Never import this module client-side except via
 * `import type`. See docs/specs/2026-06-29-for-you-recommendations.md.
 *
 * The expensive FETCH (seeds -> MAL recos, suggestions, missing-title
 * hydration, optional 2-hop) is separated from the cheap RANKING, which is
 * recomputed live from the stored edges on every feed visit. Changing a
 * ranking knob never requires a re-fetch.
 */

import fs from 'fs';
import path from 'path';
import { MALAnime, AnimeForDisplay, RecoMeta } from '@/models/anime';
import { getAnimeForDisplay, getAllMALAnime, upsertMALAnime, getHiddenAnimeIds } from '@/lib/anime';

const DATA_PATH = process.env.DATA_PATH || '/app/data';
const RECOMMENDATIONS_FILE = path.join(DATA_PATH, 'recommendations_MAL.json');
const DISMISSED_FILE = path.join(DATA_PATH, 'recommendations_dismissed.json');

// ============================================================================
// Tuning constants (all knobs live here — no scattered magic numbers)
// ============================================================================

export const TUNING = {
  /** Default seed threshold: completed && score >= this value. */
  DEFAULT_SEED_THRESHOLD: 8,
  /** Damping λ applied to hop=2 edges (affinity *= λ^(hop-1)). */
  NICHE_DAMPING: 0.3,
  /** Flat affinity boost for candidates present in MAL personal suggestions. */
  SUGGESTION_BOOST: 50,
  /** Popularity penalty floor: log10 input is clamped to >= this (avoids log10(0)). */
  POPULARITY_FLOOR: 10,
  /**
   * Gentleness of the niche/popularity penalty: score /= (1 + K * log10(users)).
   * Lower K = milder penalty. At K=0.2 an obscure (~1k users) title gets only a
   * ~1.35x edge over a mega-popular one, vs the runaway ~1.9x of a raw 1/log10
   * divisor — niche is nudged, not allowed to dominate.
   */
  POPULARITY_PENALTY_K: 0.2,
  /** A personal score <= this marks an anime as "rejected" (negative profile). */
  NEGATIVE_SCORE_THRESHOLD: 5,
  /** Max multiplicative penalty from the negative profile (0..1). */
  NEGATIVE_PENALTY_MAX: 0.6,
  /** Strength of the positive genre/studio affinity booster. */
  GENRE_STUDIO_ALPHA: 0.5,
  /** Relative weight of genre vs studio overlap in a taste profile match. */
  GENRE_WEIGHT: 0.6,
  STUDIO_WEIGHT: 0.4,
  /** How many top seeds to surface per candidate for the match hint. */
  TOP_SEEDS_PER_CANDIDATE: 2,
  /** MAL caps recommendations at 10 per anime. */
  MAX_RECS_PER_ANIME: 10,
  /** Delay between MAL detail calls during a refresh (ms). */
  FETCH_DELAY_MS: 350,
  /** Max retries on HTTP 429 before giving up on a single call. */
  MAX_429_RETRIES: 4,
} as const;

/** Statuses that mean "already seen" — hard-excluded from the feed (spec §2). */
const SEEN_STATUSES = new Set(['completed', 'watching', 'on_hold', 'dropped']);

/**
 * Prequel statuses that make a sequel a legitimate recommendation. If a
 * candidate's prequel is anything else (unseen, plan_to_watch, on_hold,
 * dropped, or absent from the dataset), recommending the sequel is premature
 * and the candidate is hard-filtered. Prevents "Jian Lai 2nd Season"-type junk.
 */
const PREQUEL_OK_STATUSES = new Set(['completed', 'watching']);

/** Full field list for hydrating missing titles (mirrors fetchSeasonalAnime). */
const FULL_FIELDS = [
  'id', 'title', 'main_picture', 'alternative_titles',
  'start_date', 'end_date', 'synopsis', 'mean', 'rank', 'popularity',
  'num_list_users', 'num_scoring_users', 'nsfw', 'genres',
  'created_at', 'updated_at', 'media_type', 'status',
  'my_list_status', 'num_episodes', 'start_season', 'broadcast',
  'source', 'average_episode_duration', 'rating', 'pictures',
  'background', 'related_anime', 'studios',
].join(',');

// ============================================================================
// Types
// ============================================================================

export interface RecoEdge {
  /** Recommended anime id. */
  id: number;
  /** num_recommendations (crowd backers) for this edge. */
  num: number;
  /** 1 = direct reco of a seed, 2 = reco of a 1-hop candidate. */
  hop: 1 | 2;
}

export interface RecommendationsData {
  lastRefresh: string | null;
  seedThreshold: number;
  nicheMode: boolean;
  /** Keyed by seed id (string) -> edges produced within that seed's subtree. */
  seeds: Record<string, RecoEdge[]>;
  suggestions: { id: number; rank: number }[];
}

export interface RecommendationItem extends AnimeForDisplay {
  recoMeta: RecoMeta;
}

export interface RecoRefreshProgress {
  type: 'start' | 'progress' | 'seed_done' | 'suggestions' | 'hop2' | 'hydrate' | 'complete' | 'error';
  message?: string;
  totalSeeds?: number;
  currentSeed?: number;
  edges?: number;
  candidates?: number;
  hydrated?: number;
  error?: string;
  details?: string;
}

export interface RecoRefreshResult {
  success: boolean;
  alreadyRunning: boolean;
  seedCount: number;
  edgeCount: number;
  hydratedCount: number;
  error?: string;
}

export interface FeedOptions {
  nicheMode: boolean;
  /** Ranking-time seed threshold override; falls back to stored / default. */
  threshold?: number | null;
}

// ============================================================================
// JSON I/O
// ============================================================================

function ensureDataDirectory(): void {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true, mode: 0o755 });
  }
}

function readJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return defaultValue;
  }
}

function writeJsonFile<T>(filePath: string, data: T): void {
  ensureDataDirectory();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

const EMPTY_DATA: RecommendationsData = {
  lastRefresh: null,
  seedThreshold: TUNING.DEFAULT_SEED_THRESHOLD,
  nicheMode: false,
  seeds: {},
  suggestions: [],
};

export function getRecommendationsData(): RecommendationsData {
  return readJsonFile<RecommendationsData>(RECOMMENDATIONS_FILE, { ...EMPTY_DATA });
}

export function saveRecommendationsData(data: RecommendationsData): void {
  writeJsonFile(RECOMMENDATIONS_FILE, data);
}

// ============================================================================
// Dismiss list
// ============================================================================

export function getDismissedIds(): number[] {
  return readJsonFile<number[]>(DISMISSED_FILE, []);
}

export function addDismissedId(animeId: number): void {
  const ids = getDismissedIds();
  if (!ids.includes(animeId)) {
    ids.push(animeId);
    writeJsonFile(DISMISSED_FILE, ids);
  }
}

export function removeDismissedId(animeId: number): void {
  const ids = getDismissedIds().filter(id => id !== animeId);
  writeJsonFile(DISMISSED_FILE, ids);
}

// ============================================================================
// Seeds
// ============================================================================

export function seedWeight(score: number, threshold: number): number {
  // threshold=8: 8->1, 9->2, 10->3
  return score - (threshold - 1);
}

/** Completed anime scored >= threshold, sorted by score desc. */
export function getSeeds(threshold: number): AnimeForDisplay[] {
  return getAnimeForDisplay()
    .filter(a =>
      a.my_list_status?.status === 'completed' &&
      typeof a.my_list_status.score === 'number' &&
      a.my_list_status.score >= threshold
    )
    .sort((a, b) => (b.my_list_status!.score) - (a.my_list_status!.score));
}

// ============================================================================
// Taste profiles (for ranking knobs)
// ============================================================================

interface TasteProfile {
  genres: Map<string, number>;
  studios: Map<number, number>;
}

/** Build a weighted genre/studio profile, normalized so the max weight is 1. */
function buildTasteProfile(
  animes: AnimeForDisplay[],
  weightFn: (a: AnimeForDisplay) => number
): TasteProfile {
  const genres = new Map<string, number>();
  const studios = new Map<number, number>();
  for (const a of animes) {
    const w = weightFn(a);
    if (w <= 0) continue;
    for (const g of a.genres || []) {
      genres.set(g.name, (genres.get(g.name) || 0) + w);
    }
    for (const s of a.studios || []) {
      studios.set(s.id, (studios.get(s.id) || 0) + w);
    }
  }
  normalize(genres);
  normalize(studios);
  return { genres, studios };
}

function normalize<K>(m: Map<K, number>): void {
  let max = 0;
  m.forEach(v => { if (v > max) max = v; });
  if (max > 0) m.forEach((v, k) => m.set(k, v / max));
}

/** Overlap of a candidate with a taste profile, in [0, 1]. */
function profileMatch(candidate: AnimeForDisplay, profile: TasteProfile): number {
  const cGenres = candidate.genres || [];
  const cStudios = candidate.studios || [];
  let genreScore = 0;
  if (cGenres.length > 0) {
    let sum = 0;
    for (const g of cGenres) sum += profile.genres.get(g.name) || 0;
    genreScore = sum / cGenres.length;
  }
  let studioScore = 0;
  if (cStudios.length > 0) {
    let sum = 0;
    for (const s of cStudios) sum += profile.studios.get(s.id) || 0;
    studioScore = sum / cStudios.length;
  }
  return TUNING.GENRE_WEIGHT * genreScore + TUNING.STUDIO_WEIGHT * studioScore;
}

/**
 * Title markers for "2nd Season / Season 3 / Third Stage"-style sequels.
 * Used only as a fallback when a candidate has no `related_anime` links — many
 * obscure donghua ship with empty relations on MAL, so the relation check alone
 * misses exactly the worst offenders. Deliberately narrow (explicit ordinal +
 * Season/Stage/Cour) to avoid flagging standalone titles.
 */
const SEQUEL_TITLE_REGEX =
  /(\b\d+(?:st|nd|rd|th)\s+(?:season|stage|cour)\b)|(\bseason\s+\d+\b)|(\b(?:second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:season|stage|cour)\b)/i;

/**
 * True if recommending this candidate would mean surfacing a later season of a
 * show the user hasn't started. Two signals:
 *  1. A `prequel` relation whose target isn't completed/watching (gap in chain).
 *  2. Fallback when relations are absent: the title looks like an Nth season.
 * If relations exist and every prequel is seen, the candidate is kept even if
 * its title matches the pattern (the user is caught up).
 */
function isPrematureSequel(anime: AnimeForDisplay, byId: Map<number, AnimeForDisplay>): boolean {
  const prequels = (anime.related_anime || []).filter(r => r.relation_type === 'prequel');
  if (prequels.length > 0) {
    return prequels.some(rel => {
      const status = byId.get(rel.node.id)?.my_list_status?.status;
      return !status || !PREQUEL_OK_STATUSES.has(status);
    });
  }
  // No relation data — fall back to the title heuristic.
  return SEQUEL_TITLE_REGEX.test(anime.title);
}

// ============================================================================
// Ranking (live, cheap)
// ============================================================================

interface Accumulator {
  affinity: number;
  /** seed id -> summed backers (num) contributed by that seed. */
  perSeed: Map<number, number>;
}

/**
 * Compute the ranked feed from stored edges. Pure read + math — no MAL calls.
 */
export function computeFeed(options: FeedOptions): RecommendationItem[] {
  const data = getRecommendationsData();
  const threshold = options.threshold ?? data.seedThreshold ?? TUNING.DEFAULT_SEED_THRESHOLD;

  const all = getAnimeForDisplay();
  const byId = new Map<number, AnimeForDisplay>(all.map(a => [a.id, a]));
  const dismissed = new Set(getDismissedIds());
  const hidden = new Set(getHiddenAnimeIds());
  const suggestionIds = new Set(data.suggestions.map(s => s.id));

  // Accumulate affinity from edges, grouped by originating seed.
  const acc = new Map<number, Accumulator>();
  const bump = (candId: number, seedId: number, contribution: number, backers: number) => {
    let a = acc.get(candId);
    if (!a) { a = { affinity: 0, perSeed: new Map() }; acc.set(candId, a); }
    a.affinity += contribution;
    a.perSeed.set(seedId, (a.perSeed.get(seedId) || 0) + backers);
  };

  for (const [seedIdStr, edges] of Object.entries(data.seeds)) {
    const seedId = Number(seedIdStr);
    const seed = byId.get(seedId);
    const seedScore = seed?.my_list_status?.score;
    // Live threshold filter: a seed below the (override) threshold is dropped.
    if (typeof seedScore !== 'number' || seedScore < threshold) continue;
    const weight = seedWeight(seedScore, threshold);
    for (const edge of edges) {
      if (edge.hop === 2 && !options.nicheMode) continue; // 2-hop only in niche mode
      const lambda = edge.hop === 2 ? TUNING.NICHE_DAMPING : 1;
      bump(edge.id, seedId, edge.num * weight * lambda, edge.num);
    }
  }

  // Suggestions contribute a flat boost (they may have no crowd edges).
  for (const s of data.suggestions) {
    let a = acc.get(s.id);
    if (!a) { a = { affinity: 0, perSeed: new Map() }; acc.set(s.id, a); }
    a.affinity += TUNING.SUGGESTION_BOOST;
  }

  // Build taste profiles once for the knobs.
  const positiveProfile = buildTasteProfile(
    getSeeds(threshold),
    a => seedWeight(a.my_list_status!.score, threshold)
  );
  const negativeProfile = buildTasteProfile(
    all.filter(a => {
      const st = a.my_list_status?.status;
      const sc = a.my_list_status?.score ?? 0;
      return st === 'dropped' || (sc > 0 && sc <= TUNING.NEGATIVE_SCORE_THRESHOLD);
    }),
    () => 1
  );

  const items: RecommendationItem[] = [];
  for (const [candId, a] of acc) {
    const anime = byId.get(candId);
    if (!anime) continue; // not hydrated yet — skip

    // Hard filters (spec §5.3)
    const st = anime.my_list_status?.status;
    if (st && SEEN_STATUSES.has(st)) continue; // already seen (plan_to_watch allowed)
    if (dismissed.has(candId)) continue;
    if (hidden.has(candId)) continue;
    if (isPrematureSequel(anime, byId)) continue; // later season of an unwatched show

    // Knobs (spec §5.2)
    let score = a.affinity;
    // Gentle, bounded niche penalty — never inflates, never lets the most obscure
    // title run away with the feed (see TUNING.POPULARITY_PENALTY_K).
    const users = Math.max(anime.num_list_users || 0, TUNING.POPULARITY_FLOOR);
    score = score / (1 + TUNING.POPULARITY_PENALTY_K * Math.log10(users));
    score *= (1 - TUNING.NEGATIVE_PENALTY_MAX * profileMatch(anime, negativeProfile));
    score *= (1 + TUNING.GENRE_STUDIO_ALPHA * profileMatch(anime, positiveProfile));

    const topSeeds = Array.from(a.perSeed.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, TUNING.TOP_SEEDS_PER_CANDIDATE)
      .map(([sid, backers]) => ({ id: sid, title: byId.get(sid)?.title || `#${sid}`, backers }));

    items.push({
      ...anime,
      recoMeta: {
        affinityScore: score,
        topSeeds,
        fromSuggestions: suggestionIds.has(candId),
      },
    });
  }

  items.sort((x, y) => {
    if (y.recoMeta.affinityScore !== x.recoMeta.affinityScore) {
      return y.recoMeta.affinityScore - x.recoMeta.affinityScore;
    }
    return (y.mean || 0) - (x.mean || 0);
  });

  return items;
}

/** Anime in the dismissed list, for the "Écartés" view. */
export function getDismissedAnime(): AnimeForDisplay[] {
  const dismissed = new Set(getDismissedIds());
  return getAnimeForDisplay().filter(a => dismissed.has(a.id));
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
  for (let attempt = 0; attempt <= TUNING.MAX_429_RETRIES; attempt++) {
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

async function fetchRecoEdges(animeId: number, accessToken: string): Promise<RecoEdge[]> {
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
  const url = `https://api.myanimelist.net/v2/anime/${animeId}?fields=${FULL_FIELDS}&nsfw=true`;
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
 */
export async function performRecommendationsRefresh(
  accessToken: string,
  options: FeedOptions,
  progress?: (p: RecoRefreshProgress) => void
): Promise<RecoRefreshResult> {
  if (isRefreshRunning) {
    return { success: false, alreadyRunning: true, seedCount: 0, edgeCount: 0, hydratedCount: 0 };
  }
  isRefreshRunning = true;

  const report = (p: RecoRefreshProgress) => { if (progress) progress(p); };

  try {
    const threshold = options.threshold ?? TUNING.DEFAULT_SEED_THRESHOLD;
    const seeds = getSeeds(threshold);

    const data: RecommendationsData = {
      lastRefresh: null,
      seedThreshold: threshold,
      nicheMode: options.nicheMode,
      seeds: {},
      suggestions: [],
    };

    report({ type: 'start', message: `Refreshing recommendations from ${seeds.length} seeds`, totalSeeds: seeds.length });

    // 1-hop crowd-seed.
    let edgeCount = 0;
    for (let i = 0; i < seeds.length; i++) {
      const seed = seeds[i];
      try {
        const edges = await fetchRecoEdges(seed.id, accessToken);
        data.seeds[seed.id.toString()] = edges;
        edgeCount += edges.length;
      } catch (error) {
        console.error(`Failed to fetch recos for seed ${seed.id}:`, error);
        data.seeds[seed.id.toString()] = [];
      }
      // Persist incrementally (resumability).
      saveRecommendationsData(data);
      report({ type: 'seed_done', currentSeed: i + 1, totalSeeds: seeds.length, edges: edgeCount, message: `Seed ${i + 1}/${seeds.length}` });
      await delay(TUNING.FETCH_DELAY_MS);
    }

    // MAL personal suggestions (orthogonal source).
    try {
      report({ type: 'suggestions', message: 'Fetching personal suggestions...' });
      data.suggestions = await fetchSuggestions(accessToken);
      saveRecommendationsData(data);
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
    }

    // Optional niche 2-hop: recos of each 1-hop candidate, stored under its seed.
    if (options.nicheMode) {
      for (let i = 0; i < seeds.length; i++) {
        const seedKey = seeds[i].id.toString();
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

    // Hydrate missing titles so the feed can render them.
    const existing = getAllMALAnime();
    const candidateIds = new Set<number>();
    for (const edges of Object.values(data.seeds)) {
      for (const e of edges) candidateIds.add(e.id);
    }
    for (const s of data.suggestions) candidateIds.add(s.id);

    const missing = Array.from(candidateIds).filter(id => !existing[id.toString()]);
    report({ type: 'hydrate', candidates: candidateIds.size, message: `Hydrating ${missing.length} missing titles` });

    const hydrated: MALAnime[] = [];
    for (let i = 0; i < missing.length; i++) {
      const detail = await fetchAnimeDetail(missing[i], accessToken);
      if (detail) hydrated.push(detail);
      if (hydrated.length > 0 && hydrated.length % 25 === 0) {
        upsertMALAnime(hydrated.splice(0)); // flush in batches
        report({ type: 'hydrate', hydrated: i + 1, message: `Hydrated ${i + 1}/${missing.length}` });
      }
      await delay(TUNING.FETCH_DELAY_MS);
    }
    if (hydrated.length > 0) upsertMALAnime(hydrated);

    data.lastRefresh = new Date().toISOString();
    saveRecommendationsData(data);

    report({ type: 'complete', message: 'Recommendations refresh complete', totalSeeds: seeds.length, edges: edgeCount, hydrated: missing.length });

    return { success: true, alreadyRunning: false, seedCount: seeds.length, edgeCount, hydratedCount: missing.length };
  } catch (error) {
    console.error('Recommendations refresh error:', error);
    report({ type: 'error', error: 'Refresh failed', details: error instanceof Error ? error.message : 'Unknown error' });
    return { success: false, alreadyRunning: false, seedCount: 0, edgeCount: 0, hydratedCount: 0, error: error instanceof Error ? error.message : 'Unknown error' };
  } finally {
    isRefreshRunning = false;
  }
}
