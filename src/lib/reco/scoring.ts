/**
 * The recommendation scoring kernel — pure math over `AnimeRecord`s.
 *
 * **Client-safe by construction.** Nothing here touches `fs`, MAL or AniList:
 * IDF, taste profiles, field matching and the two hard heuristics
 * (`isPrematureSequel`, the seen-status set) are functions of records the caller
 * already holds. That is the whole point of the module — the same math used to
 * live at the top of the `fs`-bound engine, which quarantined it server-side for
 * no reason (the mistake `weights.ts` already exists to avoid).
 *
 * The `fs`-bound halves are its consumers: `feed.ts`, `similar.ts`, `refresh.ts`.
 */

import { AnimeRecord } from '@/models/anime';
import { getEffectiveStatus, getEffectiveScore } from '@/lib/domain/animeUtils';

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
} as const;

/** Metadata fields exposed as taste-profile sources, with their value extractor. */
export type MetaField = 'genre' | 'studio' | 'nsfw' | 'rating' | 'anilistTags' | 'anilistStaff';
export type FieldValue = string | number;

export const FIELD_EXTRACTORS: Record<MetaField, (a: AnimeRecord) => FieldValue[]> = {
  genre: a => (a.catalog.genres || []).map(g => g.name),
  studio: a => (a.catalog.studios || []).map(s => s.id),
  nsfw: a => (a.catalog.nsfw ? [a.catalog.nsfw] : []),
  rating: a => (a.catalog.rating ? [a.catalog.rating] : []),
  anilistTags: a => (a.sources.anilist?.tags || []).map(t => t.name),
  anilistStaff: a => (a.sources.anilist?.staff || []).map(s => s.id),
};

/**
 * Inverse document frequency per value of a discrete field, over the whole
 * corpus: `log(N / (1 + df))`. Rare studios / ratings get a high weight, so a
 * shared `rx` rating or an obscure studio counts far more than a ubiquitous
 * `pg_13`. This is the lever that makes low- and high-cardinality fields
 * (rating ~6 values vs studios ~1000) comparable.
 */
export function computeIdf(all: AnimeRecord[], extract: (a: AnimeRecord) => FieldValue[]): Map<FieldValue, number> {
  const df = new Map<FieldValue, number>();
  for (const a of all) {
    for (const v of new Set(extract(a))) df.set(v, (df.get(v) || 0) + 1);
  }
  const N = all.length;
  const idf = new Map<FieldValue, number>();
  df.forEach((count, v) => idf.set(v, Math.log(N / (1 + count))));
  return idf;
}

/** The full IDF set, computed once per corpus and shared by every profile. */
export type IdfSet = Record<MetaField, Map<FieldValue, number>>;

/** IDF for every metadata field over one corpus. */
export function computeIdfSet(all: AnimeRecord[]): IdfSet {
  return {
    genre: computeIdf(all, FIELD_EXTRACTORS.genre),
    studio: computeIdf(all, FIELD_EXTRACTORS.studio),
    nsfw: computeIdf(all, FIELD_EXTRACTORS.nsfw),
    rating: computeIdf(all, FIELD_EXTRACTORS.rating),
    anilistTags: computeIdf(all, FIELD_EXTRACTORS.anilistTags),
    anilistStaff: computeIdf(all, FIELD_EXTRACTORS.anilistStaff),
  };
}

export interface FieldProfile {
  /** value -> taste weight in [0,1] (seed-weighted × IDF, normalized to max 1). */
  weights: Map<FieldValue, number>;
  extract: (a: AnimeRecord) => FieldValue[];
}

export function normalize<K>(m: Map<K, number>): void {
  let max = 0;
  m.forEach(v => { if (v > max) max = v; });
  if (max > 0) m.forEach((v, k) => m.set(k, v / max));
}

/** Build an IDF-scaled taste profile for one field from weighted seed animes. */
export function buildFieldProfile(
  animes: AnimeRecord[],
  weightFn: (a: AnimeRecord) => number,
  extract: (a: AnimeRecord) => FieldValue[],
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

/** One taste profile per metadata field, built from the same anime set. */
export type FieldProfileSet = Record<MetaField, FieldProfile>;

/** Build all six metadata profiles from one weighted anime set. */
export function buildFieldProfileSet(
  animes: AnimeRecord[],
  weightFn: (a: AnimeRecord) => number,
  idf: IdfSet
): FieldProfileSet {
  return {
    genre: buildFieldProfile(animes, weightFn, FIELD_EXTRACTORS.genre, idf.genre),
    studio: buildFieldProfile(animes, weightFn, FIELD_EXTRACTORS.studio, idf.studio),
    nsfw: buildFieldProfile(animes, weightFn, FIELD_EXTRACTORS.nsfw, idf.nsfw),
    rating: buildFieldProfile(animes, weightFn, FIELD_EXTRACTORS.rating, idf.rating),
    anilistTags: buildFieldProfile(animes, weightFn, FIELD_EXTRACTORS.anilistTags, idf.anilistTags),
    anilistStaff: buildFieldProfile(animes, weightFn, FIELD_EXTRACTORS.anilistStaff, idf.anilistStaff),
  };
}

/** Candidate's overlap with a field profile in [0,1], plus the matched values. */
export function fieldMatch(candidate: AnimeRecord, profile: FieldProfile): { score: number; matched: FieldValue[] } {
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
export function buildRejectionProfiles(
  all: AnimeRecord[],
  downIds: Set<string>,
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

// ============================================================================
// Seed weighting + hard heuristics
// ============================================================================

/** Statuses that mean "already seen" — hard-excluded from the feed (spec §2). */
export const SEEN_STATUSES = new Set(['completed', 'watching', 'on_hold', 'dropped']);

/**
 * Prequel statuses that make a sequel a legitimate recommendation. If a
 * candidate's prequel is anything else (unseen, plan_to_watch, on_hold,
 * dropped, or absent from the dataset), recommending the sequel is premature
 * and the candidate is hard-filtered. Prevents "Jian Lai 2nd Season"-type junk.
 */
const PREQUEL_OK_STATUSES = new Set(['completed', 'watching']);

export function seedWeight(score: number, threshold: number): number {
  // threshold=8: 8->1, 9->2, 10->3
  return score - (threshold - 1);
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
 *
 * `byId` is MAL-id-keyed, like every other id map in the reco engine
 * (docs/PROVIDER-FREE-CUTOVER.md Phase D/Risks) — relation targets are MAL ids.
 */
export function isPrematureSequel(anime: AnimeRecord, byId: Map<number, AnimeRecord>): boolean {
  const prequels = (anime.catalog.relatedAnime || []).filter(r => r.relation_type === 'prequel');
  if (prequels.length > 0) {
    return prequels.some(rel => {
      const target = byId.get(rel.node.id);
      const status = target ? getEffectiveStatus(target) : undefined;
      return !status || !PREQUEL_OK_STATUSES.has(status);
    });
  }
  // No relation data — fall back to the title heuristic.
  return SEQUEL_TITLE_REGEX.test(anime.catalog.title);
}
