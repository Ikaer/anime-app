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
import { getEffectiveStatus, getEffectiveScore, catalogNameKey } from '@/lib/domain/animeUtils';
import { resolveRelations, type RelationIndex } from '@/lib/domain/relations';
import { staffRoleTier } from '@/lib/domain/staffRole';

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
  /** Relative weight of genre vs studio overlap in the 👍 feedback profile match. */
  GENRE_WEIGHT: 0.6,
  STUDIO_WEIGHT: 0.4,
  /**
   * How much of the OTHER side's rate is subtracted when netting the taste
   * profiles (see `buildDiscriminativeProfiles`). `1` = full netting: a value
   * equally represented in what you liked and what you dropped contributes to
   * neither side. `0` reproduces the pre-netting behaviour, where such a value
   * scored on both at once.
   */
  DISCRIMINATION: 1,
  /**
   * Mix of the three fields inside the `rejection` source value. Sums to 1, so
   * the value stays in [0,1] and the -0.35 default weight keeps its meaning.
   *
   * `staffT1` carries the largest share on purpose: genre and studio describe
   * what a show is ABOUT, and a drop is usually a verdict on how it was
   * EXECUTED — which is the T1 crew's output (director, series composition,
   * character design, music). It is also the only one of the three that needs an
   * AniList sync; on an unsynced store it simply scores 0, which weakens the
   * penalty rather than skewing it.
   */
  REJECTION_MIX: { genre: 0.35, studio: 0.25, staffT1: 0.4 },
  /**
   * How far a seed's weight may be moved by how much the owner OUT-scored the
   * community on it. See `seedGapBonus`; `0` disables the adjustment.
   */
  SEED_GAP_BONUS: 0.5,
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
  // Keyed on the NORMALIZED NAME, not `s.id`: studio ids belong to whichever
  // provider supplied them, and MAL's and AniList's namespaces disagree. That
  // mixing is live today — titles MAL has no studio for fall through to AniList
  // — so an id key splits one real studio's affinity in two. See
  // docs/DECISIONS.md.
  studio: a => (a.catalog.studios || []).map(s => catalogNameKey(s.name)),
  nsfw: a => (a.catalog.nsfw ? [a.catalog.nsfw] : []),
  rating: a => (a.catalog.rating ? [a.catalog.rating] : []),
  anilistTags: a => (a.sources.anilist?.tags || []).map(t => t.name),
  anilistStaff: a => (a.sources.anilist?.staff || []).map(s => s.id),
};

/**
 * T1 staff ids — the auteur tier from `domain/staffRole.ts` (director, chief
 * director, original creator/story, series composition, character design,
 * music).
 *
 * **Deliberately NOT a `MetaField`.** It exists for the REJECTION profile only,
 * so promoting it would add a seventh IDF pass and a seventh positive profile
 * that nothing reads. The positive `anilistStaff` source keeps the full top-50
 * credit list, unchanged.
 *
 * ⚠️ **Narrowing the POSITIVE source to T1 as well was tried and measured
 * WORSE — do not redo it blind.** The dilution argument that justifies T1 on
 * the rejection side looks like it should transfer, but it does not: narrowing
 * the extractor shrinks `fieldMatch`'s numerator (fewer credits can match) as
 * much as its denominator (fewer credits to divide by), so the values barely
 * move — live-measured median 0.044 -> 0.047. What did move was the ranking,
 * and the wrong way. Backtested against held-out favourites
 * (`scripts/backtest-reco.js`) at three cutoffs, MRR fell every time
 * (0.054->0.047, 0.046->0.040, 0.050->0.047) while mean rank improved every
 * time. It trades the top of the feed — the only part read — for the middle.
 *
 * Why T1 rather than all 50 on the negative side: `fieldMatch` divides by the
 * candidate's value COUNT, so a series composer's signal drowns among ~13-50
 * key animators and sound staff (the ~0.05-vs-0.40 dilution measured in
 * `weights.ts`). T1 measures median 2 / p90 5 credits per title, which puts a
 * staff match on roughly the same scale as a genre match — the precondition for
 * `REJECTION_MIX` summing meaningfully.
 */
export const staffT1Extractor = (a: AnimeRecord): FieldValue[] =>
  (a.sources.anilist?.staff || []).filter(s => staffRoleTier(s.role) === 1).map(s => s.id);

/**
 * Normalizer for the `popularity` source: log10 member count, min-max scaled
 * across the candidate pool.
 *
 * **The min matters, and its absence was a real bug.** This used to be a bare
 * `log10(users) / log10(maxUsers)` — a RATIO, not a normalization. Because a
 * candidate pool is made of titles the crowd already recommends, its members
 * all sit within about one order of magnitude of each other, so dividing by the
 * max compressed every value into the top of the range instead of spanning
 * [0,1] like every other source. Live-measured on the 974-candidate pool: the
 * values ran [0.488, 1.000] with an interquartile range of 0.107, which at the
 * -0.15 default weight is a 0.016 spread — a constant offset applied to
 * everything rather than a penalty that discriminates. Subtracting the pool
 * floor restores the [0,1] contract the additive model assumes.
 *
 * Deliberately min-max on the log rather than a percentile rank: a percentile
 * would be perfectly uniform but would stop meaning "how popular" and start
 * meaning "how popular RELATIVE TO the rest of this pool", which changes what
 * the slider does depending on how the pool was fetched. The log keeps the
 * magnitudes honest — a 2M-member blockbuster really is far from a 300k one.
 *
 * Returns `() => 0` for a degenerate pool (one distinct popularity, or none):
 * with no spread there is nothing to penalize, and a flat 0 is the neutral
 * answer rather than an arbitrary constant.
 */
export function popularityScale(minUsers: number, maxUsers: number): (users: number) => number {
  const floor = (n: number) => Math.log10(Math.max(n, TUNING.POPULARITY_FLOOR));
  const lo = floor(minUsers);
  const span = floor(maxUsers) - lo;
  if (span <= 0) return () => 0;
  return (users: number) => (floor(users) - lo) / span;
}

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
    // T1 credits, NOT the full top-50 — the same dilution argument the rejection
    // side was already built on, applied to the positive side. `fieldMatch`
    // divides by the CANDIDATE's value count, so scoring a shared director
    // against ~40 credits (of which most are key animators and sound staff)
    // buries it: live-measured, this source's values ran a median 0.044 against
    // genre's 0.232, and its 1.0 default weight existed only to compensate for
    // that. Narrowing the extractor puts a staff match on genre's scale instead
    // of inflating the knob. IDF stays `idf.anilistStaff` (full credits) on
    // purpose: it measures how rare the PERSON is across the corpus, which is
    // the same question whatever role this particular credit was — see
    // `negStaffT1`, which nets on exactly this pairing.
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
 * Share of a weighted set's total mass carried by each value.
 *
 * The scale-free form the netting below needs: raw mass is not comparable
 * across the two sets (a few hundred liked titles weighted 1-3 against a few
 * dozen dislikes weighted 1), so subtracting one from the other would simply
 * erase the smaller set. Rates ask the only question that transfers — "what
 * FRACTION of this set carries the value" — so a genre in 1 of 30 dislikes
 * outweighs the same genre in 1 of 200 likes, which is the correct reading.
 *
 * The denominator counts (anime, value) pairs, not animes, so a title with five
 * genres spreads its weight over five slots and the rates sum to 1.
 */
function valueRates(
  animes: AnimeRecord[],
  weightFn: (a: AnimeRecord) => number,
  extract: (a: AnimeRecord) => FieldValue[]
): Map<FieldValue, number> {
  const acc = new Map<FieldValue, number>();
  let total = 0;
  for (const a of animes) {
    const w = weightFn(a);
    if (w <= 0) continue;
    for (const v of new Set(extract(a))) {
      acc.set(v, (acc.get(v) || 0) + w);
      total += w;
    }
  }
  if (total > 0) acc.forEach((v, k) => acc.set(k, v / total));
  return acc;
}

/** One side of a netted pair: `mine - α·theirs`, clamped at 0, then IDF-scaled. */
function netProfile(
  mine: Map<FieldValue, number>,
  theirs: Map<FieldValue, number>,
  extract: (a: AnimeRecord) => FieldValue[],
  idf: Map<FieldValue, number>
): FieldProfile {
  const acc = new Map<FieldValue, number>();
  mine.forEach((rate, v) => {
    const net = rate - TUNING.DISCRIMINATION * (theirs.get(v) ?? 0);
    if (net > 0) acc.set(v, net * (idf.get(v) ?? 0));
  });
  normalize(acc);
  return { weights: acc, extract };
}

/** The netted genre/studio pair plus the T1-staff rejection profile. */
export interface DiscriminativeProfiles {
  /** Liked-side genre/studio, with the dislike rates netted out. */
  posGenre: FieldProfile;
  posStudio: FieldProfile;
  /** Disliked-side genre/studio, with the like rates netted out. */
  negGenre: FieldProfile;
  negStudio: FieldProfile;
  /** Disliked-side T1 staff (auteur credits). No positive counterpart — see
   *  `staffT1Extractor`. */
  negStaffT1: FieldProfile;
}

/**
 * The dislike set: dropped, or scored <= `NEGATIVE_SCORE_THRESHOLD`, ∪ the 👎
 * "pas pour moi" thumbs.
 *
 * Named rather than inlined so the definition has one home — the rejection
 * profiles below are its only caller today.
 */
function getDislikedAnime(all: AnimeRecord[], downIds: Set<string>): AnimeRecord[] {
  const base = all.filter(a => {
    const st = getEffectiveStatus(a);
    const sc = getEffectiveScore(a) ?? 0;
    return st === 'dropped' || (sc > 0 && sc <= TUNING.NEGATIVE_SCORE_THRESHOLD);
  });
  const seen = new Set(base.map(a => a.id));
  return [...base, ...all.filter(a => downIds.has(a.id) && !seen.has(a.id))];
}

/**
 * Taste profiles built as a DISCRIMINATIVE pair: what separates the titles you
 * liked from the ones you dropped, rather than two independent tallies.
 *
 * The dislike set is unchanged — dropped, or scored <= `NEGATIVE_SCORE_THRESHOLD`,
 * ∪ 👎 "pas pour moi". What changed is that the two sides now cancel. Before,
 * a value could sit at 0.8 in the positive profile and 0.7 in the negative and
 * BOTH fired: a shonen watcher who drops the occasional shonen was scored
 * `+genre` and `-rejection` on every shonen candidate at once. The value that
 * appears at the same rate on both sides is precisely the one that predicts
 * nothing about what you will drop, so it should say nothing.
 *
 * This matters more than widening the negative side to more fields. Genre,
 * studio and tags describe what a show is ABOUT; a drop is usually a verdict on
 * how it was WRITTEN, which no catalog field encodes. Netting does not need to
 * know which fields are predictive — the non-predictive values fall out on their
 * own, and a value concentrated in the drops keeps its full penalty.
 *
 * `liked` defaults to the seed rule (completed, scored >= the default threshold,
 * weighted by `seedWeight`). `computeFeed` passes its own live seed set so the
 * netting matches the profile it actually ranks with; the anchored surfaces omit
 * it, because their positive profiles come from the anchors and only the
 * negatives — a global statement about the user — are wanted here.
 */
export function buildDiscriminativeProfiles(
  all: AnimeRecord[],
  downIds: Set<string>,
  idf: IdfSet,
  liked?: { animes: AnimeRecord[]; weight: (a: AnimeRecord) => number }
): DiscriminativeProfiles {
  const disliked = getDislikedAnime(all, downIds);

  const likedAnimes = liked?.animes ?? all.filter(a => {
    if (getEffectiveStatus(a) !== 'completed') return false;
    const sc = getEffectiveScore(a);
    return sc != null && sc >= TUNING.DEFAULT_SEED_THRESHOLD;
  });
  const likedWeight = liked?.weight
    ?? ((a: AnimeRecord) => seedWeight(getEffectiveScore(a) ?? TUNING.DEFAULT_SEED_THRESHOLD, TUNING.DEFAULT_SEED_THRESHOLD));

  const posG = valueRates(likedAnimes, likedWeight, FIELD_EXTRACTORS.genre);
  const negG = valueRates(disliked, () => 1, FIELD_EXTRACTORS.genre);
  const posS = valueRates(likedAnimes, likedWeight, FIELD_EXTRACTORS.studio);
  const negS = valueRates(disliked, () => 1, FIELD_EXTRACTORS.studio);
  // Both sides use the SAME extractor — netting a T1-only rate against a
  // full-credit rate would compare a fraction of ~3 slots to a fraction of ~40
  // and penalize every auteur who has ever been credited as a key animator.
  const posT1 = valueRates(likedAnimes, likedWeight, staffT1Extractor);
  const negT1 = valueRates(disliked, () => 1, staffT1Extractor);

  return {
    posGenre: netProfile(posG, negG, FIELD_EXTRACTORS.genre, idf.genre),
    posStudio: netProfile(posS, negS, FIELD_EXTRACTORS.studio, idf.studio),
    negGenre: netProfile(negG, posG, FIELD_EXTRACTORS.genre, idf.genre),
    negStudio: netProfile(negS, posS, FIELD_EXTRACTORS.studio, idf.studio),
    // IDF is the full-credit staff map on purpose: it measures how rare the
    // PERSON is across the corpus, which is the same question whatever role
    // this particular credit was. A T1-only IDF would also cost a seventh pass
    // over ~25k records for a near-identical ranking.
    negStaffT1: netProfile(negT1, posT1, staffT1Extractor, idf.anilistStaff),
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
 * Multiplier on a seed's weight for how far the owner's score sits ABOVE the
 * community mean — the sharpest signal a seed carries.
 *
 * A 10 on a title the whole world scores 8.4 says little: "fans of this" is
 * nearly everyone. A 10 on a title the crowd puts at 7.4 is a statement about
 * this owner specifically, and its crowd edges point somewhere more personal.
 * Weighting seeds by score alone cannot tell those apart.
 *
 * ⚠️ **Bounded and multiplicative, deliberately NOT `score − mean` outright.**
 * The raw difference is negative for a large share of the seed set — seeds are
 * score->=8 completions, which skew toward titles the community also rates 8+,
 * and this owner's mean gap is −0.57. A bare difference would therefore hand
 * half the seeds a weight of zero or less, silently dropping them from the
 * crowd accumulation (and, at negative values, making them SUBTRACT their own
 * backers). Clamping to ±1 before scaling keeps every seed in the model and
 * bounds the adjustment to [1−k, 1+k], so this re-ranks the seed set rather
 * than pruning it.
 *
 * Titles with no community mean return 1 — no information, no adjustment.
 */
export function seedGapBonus(anime: AnimeRecord, score: number): number {
  const mean = anime.catalog.mean;
  if (!mean) return 1;
  const gap = Math.max(-1, Math.min(1, score - mean));
  return 1 + TUNING.SEED_GAP_BONUS * gap;
}

/**
 * Title markers for "2nd Season / Season 3 / Third Stage"-style sequels.
 * Used only as a fallback when a candidate has no resolvable relations — some
 * titles genuinely have none on either provider, so the relation check alone
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
 * Takes a `RelationIndex`, not a MAL-id map: relations come from BOTH providers
 * and resolve to records (`domain/relations.ts`). That is not a refactor —
 * `catalog.relatedAnime` alone is populated on 48 of 25,391 titles, so the
 * prequel branch below was unreachable for the entire catalog and every
 * candidate was judged by the title regex alone.
 */
export function isPrematureSequel(anime: AnimeRecord, index: RelationIndex): boolean {
  const prequels = resolveRelations(anime, index).filter(r => r.relationType === 'prequel');
  if (prequels.length > 0) {
    return prequels.some(rel => {
      const status = getEffectiveStatus(rel.record);
      return !status || !PREQUEL_OK_STATUSES.has(status);
    });
  }
  // No relation data — fall back to the title heuristic.
  return SEQUEL_TITLE_REGEX.test(anime.catalog.title);
}
