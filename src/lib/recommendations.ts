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

import { MALAnime, AnimeForDisplay, RecoMeta, RecoSource, RecoContribution, SourceWeights, RecoVerdict } from '@/models/anime';
import { getAnimeForDisplay, getAllAnime, upsertAnime, getHiddenAnimeIds } from '@/lib/store';
import { DEFAULT_WEIGHTS } from '@/lib/recoWeights';
import { getEffectiveStatus, getEffectiveScore, getPrimaryTitle } from '@/lib/animeUtils';
import { fetchAnilistRecommendations } from '@/lib/anilistSync';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/jsonStore';
import { MAL_ANIME_FIELDS } from '@/lib/mal';

const RECOMMENDATIONS_FILE = dataFile('recommendations_MAL.json');
const DISMISSED_FILE = dataFile('recommendations_dismissed.json');
const FEEDBACK_FILE = dataFile('recommendations_feedback.json');

// ============================================================================
// Tuning constants (all knobs live here — no scattered magic numbers)
// ============================================================================

const TUNING = {
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
type MetaField = 'genre' | 'studio' | 'nsfw' | 'rating' | 'anilistTags' | 'anilistStaff';
type FieldValue = string | number;

const FIELD_EXTRACTORS: Record<MetaField, (a: AnimeForDisplay) => FieldValue[]> = {
  genre: a => (a.genres || []).map(g => g.name),
  studio: a => (a.studios || []).map(s => s.id),
  nsfw: a => (a.nsfw ? [a.nsfw] : []),
  rating: a => (a.rating ? [a.rating] : []),
  anilistTags: a => (a.anilistTags?.tags || []).map(t => t.name),
  anilistStaff: a => (a.anilistTags?.staff || []).map(s => s.id),
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

/**
 * Negative taste profiles = MAL dislikes (dropped / low-scored) ∪ 👎 "pas pour
 * moi". Shared by the global feed and the single-target drill-down: both push a
 * candidate down when it resembles what the user has rejected.
 */
function buildRejectionProfiles(
  all: AnimeForDisplay[],
  downIds: Set<number>,
  idfGenre: Map<FieldValue, number>,
  idfStudio: Map<FieldValue, number>
): { negGenre: FieldProfile; negStudio: FieldProfile } {
  const dislikedBase = all.filter(a => {
    const st = getEffectiveStatus(a);
    const sc = getEffectiveScore(a) ?? 0;
    return st === 'dropped' || (sc > 0 && sc <= TUNING.NEGATIVE_SCORE_THRESHOLD);
  });
  const dislikedSeen = new Set(dislikedBase.map(a => a.id));
  const disliked = [...dislikedBase, ...all.filter(a => downIds.has(a.id) && !dislikedSeen.has(a.id))];
  return {
    negGenre: buildFieldProfile(disliked, () => 1, FIELD_EXTRACTORS.genre, idfGenre),
    negStudio: buildFieldProfile(disliked, () => 1, FIELD_EXTRACTORS.studio, idfStudio),
  };
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
  /**
   * AniList crowd recommendations, keyed by seed MAL id (string) -> edges.
   * Parallel to `seeds` but sourced from AniList's `Media.recommendations`
   * connection. `num` holds AniList's net recommendation rating. Optional for
   * backward compat: files written before this feature lack it.
   */
  anilistSeeds?: Record<string, RecoEdge[]>;
  suggestions: { id: number; rank: number }[];
}

export interface RecommendationItem extends AnimeForDisplay {
  recoMeta: RecoMeta;
}

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
  /**
   * MMR diversity λ ∈ [0, DIVERSITY_MAX]. `0` (default) keeps the pure affinity
   * ordering; higher values re-rank the feed to spread genres/studios apart.
   */
  diversity?: number | null;
}

const EMPTY_DATA: RecommendationsData = {
  lastRefresh: null,
  seedThreshold: TUNING.DEFAULT_SEED_THRESHOLD,
  nicheMode: false,
  seeds: {},
  anilistSeeds: {},
  suggestions: [],
};

export function getRecommendationsData(): RecommendationsData {
  return readJsonFile<RecommendationsData>(RECOMMENDATIONS_FILE, { ...EMPTY_DATA });
}

function saveRecommendationsData(data: RecommendationsData): void {
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

function getFeedback(): FeedbackMap {
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

function seedWeight(score: number, threshold: number): number {
  // threshold=8: 8->1, 9->2, 10->3
  return score - (threshold - 1);
}

/**
 * Completed anime scored >= threshold, sorted by score desc. Uses the effective
 * (SIMKL-first) personal status/score — a SIMKL-only completion with no MAL
 * `my_list_status` still seeds the feed. NOTE: because a seed may carry no MAL
 * personal record, downstream reads of a seed's score MUST go through
 * `getEffectiveScore`, never `my_list_status!.score`.
 */
function getSeeds(threshold: number): AnimeForDisplay[] {
  return getAnimeForDisplay()
    .filter(a => {
      if (getEffectiveStatus(a) !== 'completed') return false;
      const score = getEffectiveScore(a);
      return score != null && score >= threshold;
    })
    .sort((a, b) => (getEffectiveScore(b) ?? 0) - (getEffectiveScore(a) ?? 0));
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
      const target = byId.get(rel.node.id);
      const status = target ? getEffectiveStatus(target) : undefined;
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
 * Cheap content signature for the diversity re-rank: the namespaced union of a
 * candidate's genre names + studio ids (the same two fields `fieldMatch`
 * already extracts). Namespacing (`g:` / `s:`) keeps a genre and a studio that
 * happen to share a string from colliding.
 */
function diversitySignature(anime: AnimeForDisplay): Set<string> {
  const s = new Set<string>();
  for (const g of anime.genres || []) s.add(`g:${g.name}`);
  for (const st of anime.studios || []) s.add(`s:${st.id}`);
  return s;
}

/** Jaccard overlap of two signatures in [0,1]; 0 if either side is empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Maximal Marginal Relevance re-rank for variety. A pass ON TOP of the affinity
 * ordering (not a change to the score), so the additive weighted-sum model — and
 * the "Pourquoi ?" breakdown — stays intact. Greedily builds the output: after
 * seeding with the top-affinity item, each step picks the candidate maximizing
 * `affinityScore − λ · maxSimilarity(alreadyPicked)`.
 *
 * `λ = 0` is a no-op that returns the input untouched (strict-`>` selection over
 * the already-(affinity, mean)-sorted list reproduces the exact prior order).
 * A running max-similarity map keeps this O(n²) rather than O(n³).
 */
function mmrRerank(items: RecommendationItem[], lambda: number): RecommendationItem[] {
  if (lambda <= 0 || items.length <= 2) return items;

  const sig = new Map<number, Set<string>>();
  for (const it of items) sig.set(it.id, diversitySignature(it));

  const remaining = [...items]; // already sorted by (affinity desc, mean desc)
  const first = remaining.shift()!;
  const selected: RecommendationItem[] = [first];
  const maxSim = new Map<number, number>();
  const firstSig = sig.get(first.id)!;
  for (const it of remaining) maxSim.set(it.id, jaccard(sig.get(it.id)!, firstSig));

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      const mmr = cand.recoMeta.affinityScore - lambda * (maxSim.get(cand.id) ?? 0);
      if (mmr > bestVal) { bestVal = mmr; bestIdx = i; }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    selected.push(picked);
    const pickedSig = sig.get(picked.id)!;
    for (const it of remaining) {
      const sim = jaccard(sig.get(it.id)!, pickedSig);
      if (sim > (maxSim.get(it.id) ?? 0)) maxSim.set(it.id, sim);
    }
  }
  return selected;
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
    const seedScore = seed ? getEffectiveScore(seed) : undefined;
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

  // AniList crowd — its own accumulator, normalized independently (AniList's net
  // `rating` isn't comparable to MAL's `num_recommendations`). Same seed-weight
  // and threshold gating as MAL crowd. Candidates surfaced ONLY by AniList are
  // ensured in `acc` (with zero MAL affinity) so they enter the eligible pass.
  const anilistAcc = new Map<number, Accumulator>();
  const bumpAnilist = (candId: number, seedId: number, contribution: number, backers: number) => {
    let a = anilistAcc.get(candId);
    if (!a) { a = { affinity: 0, perSeed: new Map() }; anilistAcc.set(candId, a); }
    a.affinity += contribution;
    a.perSeed.set(seedId, (a.perSeed.get(seedId) || 0) + backers);
  };
  for (const [seedIdStr, edges] of Object.entries(data.anilistSeeds || {})) {
    const seedId = Number(seedIdStr);
    const seed = byId.get(seedId);
    const seedScore = seed ? getEffectiveScore(seed) : undefined;
    let weight: number;
    if (typeof seedScore === 'number' && seedScore >= threshold) {
      weight = seedWeight(seedScore, threshold);
    } else if (upIds.has(seedId)) {
      weight = TUNING.FEEDBACK_SEED_WEIGHT;
    } else {
      continue;
    }
    for (const edge of edges) {
      bumpAnilist(edge.id, seedId, edge.num * weight, edge.num);
      if (!acc.has(edge.id)) acc.set(edge.id, { affinity: 0, perSeed: new Map() });
    }
  }

  // Effective weights = defaults overridden by the caller's knobs.
  const weights: SourceWeights = { ...DEFAULT_WEIGHTS, ...(options.weights || {}) };

  // IDF-scaled taste profiles for the metadata sources (positive = liked seeds,
  // negative = dropped / low-scored). IDF is computed once over the full corpus.
  const seeds = getSeeds(threshold);
  const seedW = (a: AnimeForDisplay) => seedWeight(getEffectiveScore(a) ?? threshold, threshold);
  const idf = {
    genre: computeIdf(all, FIELD_EXTRACTORS.genre),
    studio: computeIdf(all, FIELD_EXTRACTORS.studio),
    nsfw: computeIdf(all, FIELD_EXTRACTORS.nsfw),
    rating: computeIdf(all, FIELD_EXTRACTORS.rating),
    anilistTags: computeIdf(all, FIELD_EXTRACTORS.anilistTags),
    anilistStaff: computeIdf(all, FIELD_EXTRACTORS.anilistStaff),
  };
  const pos = {
    genre: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.genre, idf.genre),
    studio: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.studio, idf.studio),
    nsfw: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.nsfw, idf.nsfw),
    rating: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.rating, idf.rating),
    anilistTags: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.anilistTags, idf.anilistTags),
    anilistStaff: buildFieldProfile(seeds, seedW, FIELD_EXTRACTORS.anilistStaff, idf.anilistStaff),
  };
  // 👍 "bonne pioche" profile (genre + studio, flat weight — a thumb has no
  // numeric score). Its own weighted source, separate from the MAL-seed genre /
  // studio profiles, so the user can dial their explicit likes independently.
  const upAnime = all.filter(a => upIds.has(a.id));
  const fb = {
    genre: buildFieldProfile(upAnime, () => 1, FIELD_EXTRACTORS.genre, idf.genre),
    studio: buildFieldProfile(upAnime, () => 1, FIELD_EXTRACTORS.studio, idf.studio),
  };

  const { negGenre, negStudio } = buildRejectionProfiles(all, downIds, idf.genre, idf.studio);

  // Pass 1: apply hard filters and gather the maxima used to normalize the
  // unbounded sources (crowd affinity, popularity) onto a common [0,1] scale.
  const eligible: { anime: AnimeForDisplay; a: Accumulator }[] = [];
  let maxRaw = 0;
  let maxAnilistRaw = 0;
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
    const anilistAffinity = anilistAcc.get(candId)?.affinity ?? 0;
    if (anilistAffinity > maxAnilistRaw) maxAnilistRaw = anilistAffinity;
    const users = Math.max(anime.num_list_users || 0, TUNING.POPULARITY_FLOOR);
    if (users > maxUsers) maxUsers = users;
  }
  const crowdDenom = Math.log(1 + maxRaw) || 1;
  const anilistCrowdDenom = Math.log(1 + maxAnilistRaw) || 1;
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
    const anilistStaffM = fieldMatch(anime, pos.anilistStaff);
    const fbGenreM = fieldMatch(anime, fb.genre);
    const fbStudioM = fieldMatch(anime, fb.studio);
    const negGenreM = fieldMatch(anime, negGenre);
    const negStudioM = fieldMatch(anime, negStudio);
    const users = Math.max(anime.num_list_users || 0, TUNING.POPULARITY_FLOOR);
    const anilistA = anilistAcc.get(candId);
    const anilistAffinity = anilistA?.affinity ?? 0;

    const values: SourceWeights = {
      crowd: maxRaw > 0 ? Math.log(1 + a.affinity) / crowdDenom : 0,
      anilistCrowd: maxAnilistRaw > 0 ? Math.log(1 + anilistAffinity) / anilistCrowdDenom : 0,
      suggestions: suggestionIds.has(candId) ? 1 : 0,
      feedback: TUNING.GENRE_WEIGHT * fbGenreM.score + TUNING.STUDIO_WEIGHT * fbStudioM.score,
      genre: genreM.score,
      studio: studioM.score,
      nsfw: nsfwM.score,
      rating: ratingM.score,
      anilistTags: anilistTagsM.score,
      anilistStaff: anilistStaffM.score,
      rejection: TUNING.GENRE_WEIGHT * negGenreM.score + TUNING.STUDIO_WEIGHT * negStudioM.score,
      popularity: Math.log10(users) / popDenom,
    };

    const sortedSeeds = Array.from(a.perSeed.entries()).sort((x, y) => y[1] - x[1]);
    const seedTitle = (sid: number) => { const s = byId.get(sid); return s ? getPrimaryTitle(s) : `#${sid}`; };
    const topSeeds = sortedSeeds
      .slice(0, TUNING.TOP_SEEDS_PER_CANDIDATE)
      .map(([sid, backers]) => ({ id: sid, title: seedTitle(sid), backers }));
    // Full list (not just topSeeds) so the "Pourquoi ?" explain shows every seed.
    const allSeedTitles = sortedSeeds.map(([sid]) => seedTitle(sid));

    const anilistAllTitles = Array.from(anilistA?.perSeed.entries() ?? [])
      .sort((x, y) => y[1] - x[1])
      .map(([sid]) => seedTitle(sid));

    const studioNames = new Map((anime.studios || []).map(s => [s.id, s.name]));
    const staffById = new Map((anime.anilistTags?.staff || []).map(s => [s.id, s]));
    const details: Partial<Record<RecoSource, string | undefined>> = {
      crowd: allSeedTitles.length ? `Fans de ${allSeedTitles.join(', ')}` : undefined,
      anilistCrowd: anilistAllTitles.length ? `Fans AniList de ${anilistAllTitles.join(', ')}` : undefined,
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
      anilistStaff: anilistStaffM.matched.length
        ? anilistStaffM.matched
            .map(id => {
              const s = staffById.get(id as number);
              if (!s) return `#${id}`;
              return s.role ? `${s.role} : ${s.name}` : s.name;
            })
            .join(', ')
        : undefined,
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
        totalSeeds: sortedSeeds.length,
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

  // Optional diversity re-rank (MMR). λ = 0 (default) leaves `items` untouched.
  return mmrRerank(items, options.diversity ?? 0);
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
      anilistSeeds: {},
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

    // AniList crowd recos for the same seeds (orthogonal source). AniList
    // resolves recs straight to MAL ids, so no crosswalk; batched + throttled
    // inside fetchAnilistRecommendations. Non-fatal — a failure leaves the
    // AniList source empty (weight defaults to 0 anyway).
    try {
      report({ type: 'anilist', message: 'Fetching AniList recommendations...' });
      const anilistRecs = await fetchAnilistRecommendations(
        seeds.map(s => s.id),
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
    const existing = getAllAnime();
    const candidateIds = new Set<number>();
    for (const edges of Object.values(data.seeds)) {
      for (const e of edges) candidateIds.add(e.id);
    }
    for (const edges of Object.values(data.anilistSeeds || {})) {
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
        upsertAnime(hydrated.splice(0)); // flush in batches
        report({ type: 'hydrate', hydrated: i + 1, message: `Hydrated ${i + 1}/${missing.length}` });
      }
      await delay(TUNING.FETCH_DELAY_MS);
    }
    if (hydrated.length > 0) upsertAnime(hydrated);

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

// ============================================================================
// "Plus comme ça" — single-target drill-down (detail page)
// ============================================================================
//
// Same machinery as `computeFeed`, one anchor instead of the whole seed set.
// The question flips from "what fits my taste" to "what resembles THIS title",
// so the taste profiles are built from the target anime alone rather than from
// the user's high-scored completions. Two consequences:
//
//  - `suggestions` and `feedback` are user-global sources with no per-title
//    meaning here, so they are forced to weight 0.
//  - `rejection` and `popularity` stay ON: they still express "don't hand me
//    something that looks like what I dropped", which holds for any candidate.
//
// The candidate set is strictly the crowd edges of the target (MAL + AniList) —
// metadata only RE-RANKS within it, never injects. That keeps this block
// distinct from the sibling "Dans le même studio / staff" section, which IS a
// pure catalog-wide credit similarity.
//
// Unlike the feed, seen titles are NOT excluded: the pool is at most ~25 edges
// before filtering, and a heavy watcher would see the block gutted. They are
// returned with their effective `status` so the UI can mark them "déjà vu".
//
// Nothing is fetched to hydrate: a crowd edge pointing at a title absent from
// the local catalog is skipped (no metadata to rank on). Stateless — this never
// touches the stored `RecommendationsData`.

/** Per-source weights for the drill-down: the two user-global sources are off. */
const SIMILAR_WEIGHTS: SourceWeights = { ...DEFAULT_WEIGHTS, suggestions: 0, feedback: 0 };

/** Default number of similar titles returned. */
export const SIMILAR_LIMIT = 12;

/** One AniList crowd edge as returned by `fetchAnilistRecommendations`. */
export interface AnilistEdgeInput {
  id: number;
  rating: number;
}

/**
 * Lean card shape for the drill-down — deliberately NOT `AnimeForDisplay` +
 * `RecoMeta`: `topSeeds` / `fromSuggestions` are meaningless with a single
 * anchor, and the detail page only needs enough to render a poster card.
 */
export interface SimilarItem {
  id: number;
  title: string;
  poster?: string;
  mean?: number;
  mediaType?: string;
  year?: number;
  /** Effective (SIMKL-first) personal status, when the user already listed it. */
  status?: string;
  /** True when that status means the title has already been watched. */
  seen: boolean;
  /** Σ weight · normalizedSourceValue, same additive model as the feed. */
  score: number;
  breakdown: RecoContribution[];
}

/**
 * Rank the crowd recommendations of ONE anime. Pure read + math over edges the
 * caller fetched — no MAL/AniList calls, no writes.
 */
export function computeSimilarTo(
  targetId: number,
  malEdges: RecoEdge[],
  anilistEdges: AnilistEdgeInput[],
  limit: number = SIMILAR_LIMIT
): SimilarItem[] {
  const all = getAnimeForDisplay();
  const byId = new Map<number, AnimeForDisplay>(all.map(a => [a.id, a]));
  const target = byId.get(targetId);
  if (!target) return [];

  // The target itself and its franchise entries trivially "resemble" it, and the
  // page already lists relations in its own section.
  const excluded = new Set<number>([
    targetId,
    ...(target.related_anime || []).map(r => r.node.id),
    ...getHiddenAnimeIds(),
    ...feedbackIds(getFeedback(), 'down'),
  ]);

  const crowd = new Map<number, number>();
  for (const e of malEdges) {
    if (e.num > 0) crowd.set(e.id, (crowd.get(e.id) || 0) + e.num);
  }
  const anilistCrowd = new Map<number, number>();
  for (const e of anilistEdges) {
    if (e.rating > 0) anilistCrowd.set(e.id, (anilistCrowd.get(e.id) || 0) + e.rating);
  }

  // Pass 1: hard filters + the maxima that normalize the unbounded sources.
  const eligible: AnimeForDisplay[] = [];
  let maxCrowd = 0;
  let maxAnilist = 0;
  let maxUsers: number = TUNING.POPULARITY_FLOOR;
  for (const candId of new Set([...crowd.keys(), ...anilistCrowd.keys()])) {
    if (excluded.has(candId)) continue;
    const anime = byId.get(candId);
    if (!anime) continue; // absent from the local catalog — nothing to rank on
    if (isPrematureSequel(anime, byId)) continue;

    eligible.push(anime);
    maxCrowd = Math.max(maxCrowd, crowd.get(candId) || 0);
    maxAnilist = Math.max(maxAnilist, anilistCrowd.get(candId) || 0);
    maxUsers = Math.max(maxUsers, anime.num_list_users || 0);
  }
  if (eligible.length === 0) return [];

  const crowdDenom = Math.log(1 + maxCrowd) || 1;
  const anilistDenom = Math.log(1 + maxAnilist) || 1;
  const popDenom = Math.log10(maxUsers) || 1;

  // IDF over the full corpus (as in the feed), but the positive profiles are
  // built from the single target: "shares a RARE genre/tag/studio/creator with
  // this title" scores far above "shares a ubiquitous one".
  const idf = {
    genre: computeIdf(all, FIELD_EXTRACTORS.genre),
    studio: computeIdf(all, FIELD_EXTRACTORS.studio),
    nsfw: computeIdf(all, FIELD_EXTRACTORS.nsfw),
    rating: computeIdf(all, FIELD_EXTRACTORS.rating),
    anilistTags: computeIdf(all, FIELD_EXTRACTORS.anilistTags),
    anilistStaff: computeIdf(all, FIELD_EXTRACTORS.anilistStaff),
  };
  const one = () => 1;
  const self = {
    genre: buildFieldProfile([target], one, FIELD_EXTRACTORS.genre, idf.genre),
    studio: buildFieldProfile([target], one, FIELD_EXTRACTORS.studio, idf.studio),
    nsfw: buildFieldProfile([target], one, FIELD_EXTRACTORS.nsfw, idf.nsfw),
    rating: buildFieldProfile([target], one, FIELD_EXTRACTORS.rating, idf.rating),
    anilistTags: buildFieldProfile([target], one, FIELD_EXTRACTORS.anilistTags, idf.anilistTags),
    anilistStaff: buildFieldProfile([target], one, FIELD_EXTRACTORS.anilistStaff, idf.anilistStaff),
  };
  const downIds = feedbackIds(getFeedback(), 'down');
  const { negGenre, negStudio } = buildRejectionProfiles(all, downIds, idf.genre, idf.studio);

  // Names/roles as the TARGET credits them — the explain says what the candidate
  // shares with the anime you're looking at.
  const targetStudioNames = new Map((target.studios || []).map(s => [s.id, s.name]));
  const targetStaffById = new Map((target.anilistTags?.staff || []).map(s => [s.id, s]));

  // Pass 2: score with the same additive weighted sum as the feed.
  const items: SimilarItem[] = [];
  for (const anime of eligible) {
    const candId = anime.id;
    const crowdNum = crowd.get(candId) || 0;
    const anilistNum = anilistCrowd.get(candId) || 0;

    const genreM = fieldMatch(anime, self.genre);
    const studioM = fieldMatch(anime, self.studio);
    const nsfwM = fieldMatch(anime, self.nsfw);
    const ratingM = fieldMatch(anime, self.rating);
    const tagsM = fieldMatch(anime, self.anilistTags);
    const staffM = fieldMatch(anime, self.anilistStaff);
    const negGenreM = fieldMatch(anime, negGenre);
    const negStudioM = fieldMatch(anime, negStudio);
    const users = Math.max(anime.num_list_users || 0, TUNING.POPULARITY_FLOOR);

    const values: SourceWeights = {
      crowd: maxCrowd > 0 ? Math.log(1 + crowdNum) / crowdDenom : 0,
      anilistCrowd: maxAnilist > 0 ? Math.log(1 + anilistNum) / anilistDenom : 0,
      suggestions: 0,
      feedback: 0,
      genre: genreM.score,
      studio: studioM.score,
      nsfw: nsfwM.score,
      rating: ratingM.score,
      anilistTags: tagsM.score,
      anilistStaff: staffM.score,
      rejection: TUNING.GENRE_WEIGHT * negGenreM.score + TUNING.STUDIO_WEIGHT * negStudioM.score,
      popularity: Math.log10(users) / popDenom,
    };

    const details: Partial<Record<RecoSource, string | undefined>> = {
      crowd: crowdNum > 0 ? `${crowdNum} fan${crowdNum > 1 ? 's' : ''} de ce titre le recommandent` : undefined,
      anilistCrowd: anilistNum > 0 ? `${anilistNum} recommandation${anilistNum > 1 ? 's' : ''} AniList depuis ce titre` : undefined,
      genre: genreM.matched.length ? `En commun : ${(genreM.matched as string[]).join(', ')}` : undefined,
      studio: studioM.matched.length
        ? `En commun : ${studioM.matched.map(id => targetStudioNames.get(id as number) || `#${id}`).join(', ')}`
        : undefined,
      nsfw: values.nsfw > 0 && anime.nsfw ? `Même classement NSFW : ${anime.nsfw}` : undefined,
      rating: values.rating > 0 && anime.rating ? `Même classification : ${anime.rating.toUpperCase()}` : undefined,
      anilistTags: tagsM.matched.length ? `En commun : ${(tagsM.matched as string[]).join(', ')}` : undefined,
      anilistStaff: staffM.matched.length
        ? `En commun : ${staffM.matched
            .map(id => {
              const s = targetStaffById.get(id as number);
              if (!s) return `#${id}`;
              return s.role ? `${s.role} : ${s.name}` : s.name;
            })
            .join(', ')}`
        : undefined,
      rejection: (() => {
        const candStudioNames = new Map((anime.studios || []).map(s => [s.id, s.name]));
        const parts = [
          ...(negGenreM.matched as string[]),
          ...negStudioM.matched.map(id => candStudioNames.get(id as number) || `#${id}`),
        ];
        return parts.length ? `Proche de tes rejets : ${parts.join(', ')}` : undefined;
      })(),
      popularity: `${(anime.num_list_users || 0).toLocaleString('fr-FR')} membres`,
    };

    let score = 0;
    const breakdown: RecoContribution[] = [];
    (Object.keys(values) as RecoSource[]).forEach(src => {
      const weight = SIMILAR_WEIGHTS[src];
      const value = values[src];
      const contribution = weight * value;
      score += contribution;
      if (weight !== 0 && value !== 0) {
        breakdown.push({ source: src, value, weight, contribution, detail: details[src] });
      }
    });
    breakdown.sort((x, y) => Math.abs(y.contribution) - Math.abs(x.contribution));

    const status = getEffectiveStatus(anime);
    items.push({
      id: candId,
      title: getPrimaryTitle(anime),
      poster: anime.main_picture?.medium || anime.main_picture?.large,
      mean: anime.mean,
      mediaType: anime.media_type,
      year: anime.start_season?.year,
      status,
      seen: !!status && SEEN_STATUSES.has(status),
      score,
      breakdown,
    });
  }

  items.sort((x, y) => y.score - x.score || (y.mean || 0) - (x.mean || 0) || x.id - y.id);
  return items.slice(0, limit);
}
