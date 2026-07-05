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
import { MALAnime, AnimeForDisplay, RecoMeta, RecoSource, RecoContribution, SourceWeights, RecoVerdict } from '@/models/anime';
import { getAnimeForDisplay, getAllMALAnime, upsertMALAnime, getHiddenAnimeIds } from '@/lib/anime';
import { DEFAULT_WEIGHTS } from '@/lib/recoWeights';
import { getEffectiveStatus } from '@/lib/animeUtils';

const DATA_PATH = process.env.DATA_PATH || '/app/data';
const RECOMMENDATIONS_FILE = path.join(DATA_PATH, 'recommendations_MAL.json');
const DISMISSED_FILE = path.join(DATA_PATH, 'recommendations_dismissed.json');
const FEEDBACK_FILE = path.join(DATA_PATH, 'recommendations_feedback.json');

// ============================================================================
// Tuning constants (all knobs live here — no scattered magic numbers)
// ============================================================================

export const TUNING = {
  /** Default seed threshold: completed && score >= this value. */
  DEFAULT_SEED_THRESHOLD: 8,
  /** Damping λ applied to hop=2 edges (affinity *= λ^(hop-1)). */
  NICHE_DAMPING: 0.3,
  /** Popularity floor: log10 input is clamped to >= this (avoids log10(0)). */
  POPULARITY_FLOOR: 10,
  /** A personal score <= this marks an anime as "rejected" (negative profile). */
  NEGATIVE_SCORE_THRESHOLD: 5,
  /** Relative weight of genre vs studio overlap in the rejection profile match. */
  GENRE_WEIGHT: 0.6,
  STUDIO_WEIGHT: 0.4,
  /** How many top seeds to surface per candidate for the match hint. */
  TOP_SEEDS_PER_CANDIDATE: 2,
  /** Synthetic edge weight for a 👍 "bonne pioche" acting as a crowd seed
   *  (it has no MAL personal score to derive a weight from). ~ a score-9 seed. */
  FEEDBACK_SEED_WEIGHT: 2,
  /** MAL caps recommendations at 10 per anime. */
  MAX_RECS_PER_ANIME: 10,
  /** Delay between MAL detail calls during a refresh (ms). */
  FETCH_DELAY_MS: 350,
  /** Max retries on HTTP 429 before giving up on a single call. */
  MAX_429_RETRIES: 4,
} as const;

/** Metadata fields exposed as taste-profile sources, with their value extractor. */
type MetaField = 'genre' | 'studio' | 'nsfw' | 'rating' | 'anilistTags';
type FieldValue = string | number;

const FIELD_EXTRACTORS: Record<MetaField, (a: AnimeForDisplay) => FieldValue[]> = {
  genre: a => (a.genres || []).map(g => g.name),
  studio: a => (a.studios || []).map(s => s.id),
  nsfw: a => (a.nsfw ? [a.nsfw] : []),
  rating: a => (a.rating ? [a.rating] : []),
  anilistTags: a => (a.anilistTags?.tags || []).map(t => t.name),
};

/**
 * Inverse document frequency per value of a discrete field, over the whole
 * corpus: `log(N / (1 + df))`. Rare studios / ratings get a high weight, so a
 * shared `rx` rating or an obscure studio counts far more than a ubiquitous
 * `pg_13`. This is the lever that makes low- and high-cardinality fields
 * (rating ~6 values vs studios ~1000) comparable.
 */
function computeIdf(all: AnimeForDisplay[], extract: (a: AnimeForDisplay) => FieldValue[]): Map<FieldValue, number> {
  const df = new Map<FieldValue, number>();
  for (const a of all) {
    for (const v of new Set(extract(a))) df.set(v, (df.get(v) || 0) + 1);
  }
  const N = all.length;
  const idf = new Map<FieldValue, number>();
  df.forEach((count, v) => idf.set(v, Math.log(N / (1 + count))));
  return idf;
}

interface FieldProfile {
  /** value -> taste weight in [0,1] (seed-weighted × IDF, normalized to max 1). */
  weights: Map<FieldValue, number>;
  extract: (a: AnimeForDisplay) => FieldValue[];
}

/** Build an IDF-scaled taste profile for one field from weighted seed animes. */
function buildFieldProfile(
  animes: AnimeForDisplay[],
  weightFn: (a: AnimeForDisplay) => number,
  extract: (a: AnimeForDisplay) => FieldValue[],
  idf: Map<FieldValue, number>
): FieldProfile {
  const acc = new Map<FieldValue, number>();
  for (const a of animes) {
    const w = weightFn(a);
    if (w <= 0) continue;
    for (const v of new Set(extract(a))) acc.set(v, (acc.get(v) || 0) + w);
  }
  acc.forEach((v, k) => acc.set(k, v * (idf.get(k) ?? 0)));
  normalize(acc);
  return { weights: acc, extract };
}

/** Candidate's overlap with a field profile in [0,1], plus the matched values. */
function fieldMatch(candidate: AnimeForDisplay, profile: FieldProfile): { score: number; matched: FieldValue[] } {
  const vals = profile.extract(candidate);
  if (vals.length === 0) return { score: 0, matched: [] };
  let sum = 0;
  const matched: FieldValue[] = [];
  for (const v of vals) {
    const w = profile.weights.get(v) || 0;
    sum += w;
    if (w > 0) matched.push(v);
  }
  return { score: sum / vals.length, matched };
}

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
  /** Per-source weight overrides; unset sources fall back to DEFAULT_WEIGHTS. */
  weights?: Partial<SourceWeights>;
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
// Feedback store (👍 "bonne pioche" / 👎 "pas pour moi")
// ============================================================================
//
// A durable, standalone verdict map (id -> 'up'|'down'), decoupled from the
// transient feed: a thumb persists even after the title leaves the feed. 👎
// subsumes the old pure-hide "Écarter" (it hides AND feeds negative taste); 👍
// both re-ranks the feed (the `feedback` source) and, at the next refresh,
// joins the crowd seeds so new candidates enter.

export type FeedbackMap = Record<string, RecoVerdict>;

export function getFeedback(): FeedbackMap {
  return readJsonFile<FeedbackMap>(FEEDBACK_FILE, {});
}

export function setFeedbackVerdict(animeId: number, verdict: RecoVerdict): void {
  const fb = getFeedback();
  fb[String(animeId)] = verdict;
  writeJsonFile(FEEDBACK_FILE, fb);
}

export function removeFeedback(animeId: number): void {
  const fb = getFeedback();
  if (String(animeId) in fb) {
    delete fb[String(animeId)];
    writeJsonFile(FEEDBACK_FILE, fb);
  }
}

/** Ids carrying the given verdict. */
function feedbackIds(fb: FeedbackMap, verdict: RecoVerdict): Set<number> {
  return new Set(
    Object.entries(fb).filter(([, v]) => v === verdict).map(([k]) => Number(k))
  );
}

/** Anime carrying the given verdict, for the review lists. */
export function getFeedbackAnime(verdict: RecoVerdict): AnimeForDisplay[] {
  const ids = feedbackIds(getFeedback(), verdict);
  return getAnimeForDisplay().filter(a => ids.has(a.id));
}

// Legacy pure-hide dismiss list — superseded by 👎 feedback. Kept read-only so
// any previously-dismissed ids stay excluded from the feed (union below).
function getDismissedIds(): number[] {
  return readJsonFile<number[]>(DISMISSED_FILE, []);
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
// Taste profiles (for the metadata ranking sources)
// ============================================================================

function normalize<K>(m: Map<K, number>): void {
  let max = 0;
  m.forEach(v => { if (v > max) max = v; });
  if (max > 0) m.forEach((v, k) => m.set(k, v / max));
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
  const feedback = getFeedback();
  const upIds = feedbackIds(feedback, 'up');
  const downIds = feedbackIds(feedback, 'down');

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
    // Live threshold filter, with a fallback for 👍 seeds (no personal score).
    let weight: number;
    if (typeof seedScore === 'number' && seedScore >= threshold) {
      weight = seedWeight(seedScore, threshold);
    } else if (upIds.has(seedId)) {
      weight = TUNING.FEEDBACK_SEED_WEIGHT; // 👍 "bonne pioche" acting as a seed
    } else {
      continue; // seed below threshold and not thumbed-up — dropped
    }
    for (const edge of edges) {
      if (edge.hop === 2 && !options.nicheMode) continue; // 2-hop only in niche mode
      const lambda = edge.hop === 2 ? TUNING.NICHE_DAMPING : 1;
      bump(edge.id, seedId, edge.num * weight * lambda, edge.num);
    }
  }

  // Suggestions may have no crowd edges — ensure they're candidates (scored via
  // the `suggestions` source below, not a baked-in affinity boost).
  for (const s of data.suggestions) {
    if (!acc.has(s.id)) acc.set(s.id, { affinity: 0, perSeed: new Map() });
  }

  // Effective weights = defaults overridden by the caller's knobs.
  const weights: SourceWeights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };

  // IDF-scaled taste profiles for the metadata sources (positive = liked seeds,
  // negative = dropped / low-scored). IDF is computed once over the full corpus.
  const seeds = getSeeds(threshold);
  const seedW = (a: AnimeForDisplay) => seedWeight(a.my_list_status!.score, threshold);
  const idf = {
    genre: computeIdf(all, FIELD_EXTRACTORS.genre),
    studio: computeIdf(all, FIELD_EXTRACTORS.studio),
    nsfw: computeIdf(all, FIELD_EXTRACTORS.nsfw),
    rating: computeIdf(all, FIELD_EXTRACTORS.rating),
    anilistTags: computeIdf(all, FIELD_EXTRACTORS.anilistTags),
  };
  const pos = {
    genre: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.genre, idf.genre),
    studio: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.studio, idf.studio),
    nsfw: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.nsfw, idf.nsfw),
    rating: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.rating, idf.rating),
    anilistTags: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.anilistTags, idf.anilistTags),
  };
  // 👍 "bonne pioche" profile (genre + studio, flat weight — a thumb has no
  // numeric score). Its own weighted source, separate from the MAL-seed genre /
  // studio profiles, so the user can dial their explicit likes independently.
  const upAnime = all.filter(a => upIds.has(a.id));
  const fb = {
    genre: buildFieldProfile(upAnime, () => 1, FIELD_EXTRACTORS.genre, idf.genre),
    studio: buildFieldProfile(upAnime, () => 1, FIELD_EXTRACTORS.studio, idf.studio),
  };

  // Rejection profile = MAL dislikes (dropped / low-scored) ∪ 👎 "pas pour moi".
  const dislikedBase = all.filter(a => {
    const st = a.my_list_status?.status;
    const sc = a.my_list_status?.score ?? 0;
    return st === 'dropped' || (sc > 0 && sc <= TUNING.NEGATIVE_SCORE_THRESHOLD);
  });
  const dislikedSeen = new Set(dislikedBase.map(a => a.id));
  const disliked = [...dislikedBase, ...all.filter(a => downIds.has(a.id) && !dislikedSeen.has(a.id))];
  const negGenre = buildFieldProfile(disliked, () => 1, FIELD_EXTRACTORS.genre, idf.genre);
  const negStudio = buildFieldProfile(disliked, () => 1, FIELD_EXTRACTORS.studio, idf.studio);

  // Pass 1: apply hard filters and gather the maxima used to normalize the
  // unbounded sources (crowd affinity, popularity) onto a common [0,1] scale.
  const eligible: { anime: AnimeForDisplay; a: Accumulator }[] = [];
  let maxRaw = 0;
  let maxUsers: number = TUNING.POPULARITY_FLOOR;
  for (const [candId, a] of acc) {
    const anime = byId.get(candId);
    if (!anime) continue; // not hydrated yet — skip

    // Hard filters (spec §5.3)
    const st = getEffectiveStatus(anime);
    if (st && SEEN_STATUSES.has(st)) continue; // already seen (plan_to_watch allowed)
    if (dismissed.has(candId)) continue;
    if (hidden.has(candId)) continue;
    if (upIds.has(candId) || downIds.has(candId)) continue; // already thumbed
    if (isPrematureSequel(anime, byId)) continue; // later season of an unwatched show

    eligible.push({ anime, a });
    if (a.affinity > maxRaw) maxRaw = a.affinity;
    const users = Math.max(anime.num_list_users || 0, TUNING.POPULARITY_FLOOR);
    if (users > maxUsers) maxUsers = users;
  }
  const crowdDenom = Math.log(1 + maxRaw) || 1;
  const popDenom = Math.log10(maxUsers) || 1;

  // Pass 2: score each candidate as `Σ weight · normalizedSourceValue`, and
  // retain the per-source breakdown for the on-demand "Pourquoi ?" explain.
  const items: RecommendationItem[] = [];
  for (const { anime, a } of eligible) {
    const candId = anime.id;

    const genreM = fieldMatch(anime, pos.genre);
    const studioM = fieldMatch(anime, pos.studio);
    const nsfwM = fieldMatch(anime, pos.nsfw);
    const ratingM = fieldMatch(anime, pos.rating);
    const anilistTagsM = fieldMatch(anime, pos.anilistTags);
    const fbGenreM = fieldMatch(anime, fb.genre);
    const fbStudioM = fieldMatch(anime, fb.studio);
    const negGenreM = fieldMatch(anime, negGenre);
    const negStudioM = fieldMatch(anime, negStudio);
    const users = Math.max(anime.num_list_users || 0, TUNING.POPULARITY_FLOOR);

    const values: SourceWeights = {
      crowd: maxRaw > 0 ? Math.log(1 + a.affinity) / crowdDenom : 0,
      suggestions: suggestionIds.has(candId) ? 1 : 0,
      feedback: TUNING.GENRE_WEIGHT * fbGenreM.score + TUNING.STUDIO_WEIGHT * fbStudioM.score,
      genre: genreM.score,
      studio: studioM.score,
      nsfw: nsfwM.score,
      rating: ratingM.score,
      anilistTags: anilistTagsM.score,
      rejection: TUNING.GENRE_WEIGHT * negGenreM.score + TUNING.STUDIO_WEIGHT * negStudioM.score,
      popularity: Math.log10(users) / popDenom,
    };

    const topSeeds = Array.from(a.perSeed.entries())
      .sort((x, y) => y[1] - x[1])
      .slice(0, TUNING.TOP_SEEDS_PER_CANDIDATE)
      .map(([sid, backers]) => ({ id: sid, title: byId.get(sid)?.title || `#${sid}`, backers }));

    const studioNames = new Map((anime.studios || []).map(s => [s.id, s.name]));
    const details: Partial<Record<RecoSource, string | undefined>> = {
      crowd: topSeeds.length ? `Fans de ${topSeeds.map(s => s.title).join(', ')}` : undefined,
      suggestions: values.suggestions ? 'Dans tes suggestions MAL' : undefined,
      feedback: (() => {
        const parts = [
          ...(fbGenreM.matched as string[]),
          ...fbStudioM.matched.map(id => studioNames.get(id as number) || `#${id}`),
        ];
        return parts.length ? `Comme tes bonnes pioches : ${parts.join(', ')}` : undefined;
      })(),
      genre: genreM.matched.length ? (genreM.matched as string[]).join(', ') : undefined,
      studio: studioM.matched.length
        ? studioM.matched.map(id => studioNames.get(id as number) || `#${id}`).join(', ')
        : undefined,
      nsfw: values.nsfw > 0 && anime.nsfw ? anime.nsfw : undefined,
      rating: values.rating > 0 && anime.rating ? anime.rating.toUpperCase() : undefined,
      anilistTags: anilistTagsM.matched.length ? (anilistTagsM.matched as string[]).join(', ') : undefined,
      rejection: (() => {
        const parts = [
          ...(negGenreM.matched as string[]),
          ...negStudioM.matched.map(id => studioNames.get(id as number) || `#${id}`),
        ];
        return parts.length ? parts.join(', ') : undefined;
      })(),
      popularity: `${(anime.num_list_users || 0).toLocaleString('fr-FR')} membres`,
    };

    let score = 0;
    const breakdown: RecoContribution[] = [];
    (Object.keys(values) as RecoSource[]).forEach(src => {
      const weight = weights[src];
      const value = values[src];
      const contribution = weight * value;
      score += contribution;
      if (weight !== 0 && value !== 0) {
        breakdown.push({ source: src, value, weight, contribution, detail: details[src] });
      }
    });
    breakdown.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution));

    items.push({
      ...anime,
      recoMeta: {
        affinityScore: score,
        topSeeds,
        fromSuggestions: suggestionIds.has(candId),
        breakdown,
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
    // Seeds = high-scored MAL completions ∪ 👍 "bonnes pioches". The latter let
    // an explicit endorsement pull in fresh crowd candidates (they're already
    // hydrated — they came from the feed — so no extra detail fetch is needed).
    const malSeeds = getSeeds(threshold);
    const seenSeed = new Set(malSeeds.map(s => s.id));
    const upSeeds = getFeedbackAnime('up').filter(a => !seenSeed.has(a.id));
    const seeds = [...malSeeds, ...upSeeds];

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
