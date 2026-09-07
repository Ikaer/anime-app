/**
 * « Recommandé » — the taste-affinity mark on the main list.
 *
 * **Why this is a fourth ranker and not a call into the feed.** `computeFeed`
 * and `computeAnchored` both build their candidate set out of CROWD EDGES (MAL
 * recommendations, AniList's `recommendations` connection). A title that has
 * not aired has no crowd edges — nobody has recommended it yet — so it is not
 * "thin" in those surfaces, it is structurally absent. That is exactly the
 * moment this mark exists for: a season starts, `catalog.mean` is null on every
 * row, and the list has no signal to offer beyond the poster. So the score here
 * is metadata-only — genres, AniList tags, T1 staff, studio, netted against the
 * rejection profile — which is available the day a title is announced.
 *
 * **Measured, not asserted.** `node scripts/probe-affinity.js --season
 * 2024-fall` replays a past season the way `backtest-reco.js` replays the feed:
 * it rebuilds the taste profile from what the owner had watched by that
 * season's start (SIMKL `watched_at`, the only usable clock) and asks where the
 * titles they went on to score >= 8 landed. Over six seasons of TV titles,
 * 420 candidates and 40 held-out favourites:
 *
 *   p90 → badged 24% of the season, caught 60% of the favourites
 *   p95 → badged 12%, caught 48%
 *   p97 → badged  7%, caught 38%
 *
 * ⚠️ **Those numbers are the CEILING, not the season-start reality.** They score
 * past seasons with today's AniList tags, which accumulate by user vote as a
 * show airs. Live-measured on the store: an aired season carries a median of 12
 * tags (8 above rank 60) and 20 staff credits, while the NEXT season carries 4
 * / 1 / 8, with 32 of 72 TV titles holding no strong tag at all. Re-running the
 * probe with candidate metadata truncated to that density (`--thin`) costs
 * roughly a fifth of the recall. Two consequences that are load-bearing here:
 * the denominator floor is mandatory rather than tidy (see below), and the mark
 * FILLS IN over the first weeks of a season as tags land — which is free,
 * because the list re-scores on every request.
 *
 * ⚠️ **MAL member counts are deliberately NOT in this score, and that is a
 * measurement rule rather than a taste one.** `num_list_users` is the one crowd
 * number that exists before a title airs (2026-fall TV: no `mean` at all, but a
 * median 5,006 members and a p90 of 35,463), and it is a real anticipation
 * signal — see `buildAnticipationIndex`, which surfaces it. It cannot enter
 * THIS ranking because the store holds only a present-day snapshot: Dandadan
 * carries 1,019,332 members today, 23× its season's median, precisely BECAUSE
 * it turned out to be a hit. Folding that into the score would let the probe
 * above "discover" a signal that is pure hindsight. Making it honest needs a
 * per-title member-count history the store does not keep — a different project,
 * and until then hype is shown beside the mark rather than inside it.
 *
 * Client-safe by construction (pure math over records the caller already
 * holds), so it stays OUT of the eslint server-only list — `api/anime/animes`
 * is the `fs` boundary.
 */

import { AnimeRecord, AffinityMark, AffinityTier, AnticipationMark } from '@/models/anime';
import { getEffectiveStatus, getEffectiveScore } from '@/lib/domain/animeUtils';
import { buildRelationIndex } from '@/lib/domain/relations';
import {
  TUNING,
  type MetaField,
  type FieldValue,
  type FieldProfile,
  FIELD_EXTRACTORS,
  MATCH_DENOM_FLOOR,
  buildDiscriminativeProfiles,
  buildFieldProfileSet,
  computeIdf,
  computeIdfSet,
  buildFieldProfile,
  flooredFieldMatch,
  isPrematureSequel,
  SEEN_STATUSES,
  seedWeight,
  seedGapBonus,
} from '@/lib/reco/scoring';

/**
 * How the mark is weighted — the box ranker's shape, not the feed's, and for
 * the box's reason (see `BOX_WEIGHTS`): `fieldMatch` divides by the candidate's
 * value count, so a near-binary `studio` hit scores ~1.0 against a tag hit's
 * ~0.4 and drags its own staff match along with it. "More from a studio you
 * like" is a fair recommendation in a crowd-anchored feed; it is a poor answer
 * to "is this new show my kind of thing".
 *
 * `staff` sits above the box's 0.35 on purpose: it is the field that is already
 * populated when a season is announced (median 8 credits against 1 strong tag),
 * so it carries the mark in the weeks where tags cannot. Swept with
 * `probe-affinity.js --thin --weights`; a staff-led variant traded recall
 * for precision season by season with no consistent winner, so this stays near
 * the measured box weighting rather than chasing noise across a 40-positive
 * sample.
 */
export const AFFINITY_WEIGHTS: Record<MetaField, number> = {
  genre: 0.25,
  studio: 0.05,
  nsfw: 0,
  rating: 0,
  anilistTags: 1.0,
  anilistStaff: 0.5,
};

/** Weight of the rejection profile (dropped / low-scored / 👎). Negative. */
export const AFFINITY_REJECTION_WEIGHT = -0.35;

/**
 * Minimum AniList tag relevance counted, 0-100 — the same cut and the same
 * reason as `BOX_TAG_MIN_RANK`, duplicated rather than imported because that
 * one lives in the `fs`-bound `boxes.ts` and this module is client-safe.
 * Without it the long tail of rank-20 descriptors (`Male Protagonist`,
 * `Primarily Teen Cast`) enters the profile beside `Lost Civilization`.
 */
export const AFFINITY_TAG_MIN_RANK = 60;

const AFFINITY_FIELDS: MetaField[] = ['genre', 'studio', 'anilistTags', 'anilistStaff'];

/**
 * Where the two tiers cut, as percentiles of the SCOREABLE unseen catalog.
 *
 * ⚠️ **Percentile of a fixed population, never of the current view.** A cut
 * taken over whatever the user has filtered to would badge the same share of
 * every screen, which makes the mark assert nothing: a weak season has to be
 * allowed to come out with two marks and a strong one with fifteen. And the
 * population is the SCOREABLE unseen set, not all unseen — roughly 7,000 of
 * 25,600 rows carry no AniList entry at all and score a flat 0, so a percentile
 * over the full set would put the bar inside a block of zeros and mean nothing.
 * That is the `popularityScale` lesson (a ratio is not a normalization) in its
 * threshold form.
 */
export const AFFINITY_TIER_PERCENTILE: Record<AffinityTier, number> = {
  strong: 0.97,
  notable: 0.90,
};

/** Matched values kept per field for the "why" hint — enough to justify a mark. */
const WHY_VALUE_LIMIT = 3;
/** Fields listed in the hint. Two is a tooltip; four is a paragraph. */
const WHY_FIELD_LIMIT = 2;

export interface AffinityIndex {
  /** Affinity score per unseen candidate — every scoreable row, for the sort. */
  scores: Map<string, number>;
  /** The badge, for the rows that earned one. */
  marks: Map<string, AffinityMark>;
  /** The score each tier cut at, so a caller can report the bar it applied. */
  thresholds: Record<AffinityTier, number>;
  /**
   * How many unseen rows could be scored at all, out of how many. The mark's
   * absence on an unscoreable title means "no metadata yet", NOT "not for you",
   * and only this number can tell the two apart — the same declare-the-degraded
   * -mode posture as `GraphCoverage` and `/activity`'s `available: false`.
   */
  coverage: { scoreable: number; unseen: number };
  /** Seeds the profile was built from. Zero means the mark is meaningless. */
  seedCount: number;
}

export interface AffinityOptions {
  /** 👎 ids: excluded from the mark and folded into the rejection profile. */
  downIds?: Set<string>;
  /** Override for tuning probes; defaults to `AFFINITY_WEIGHTS`. */
  weights?: Record<MetaField, number>;
  /** Override for tuning probes; defaults to `AFFINITY_TAG_MIN_RANK`. */
  tagMinRank?: number;
}

/** Tags above the rank floor; every other field is the shared extractor. */
function affinityExtractors(minRank: number): Record<MetaField, (a: AnimeRecord) => FieldValue[]> {
  return {
    ...FIELD_EXTRACTORS,
    anilistTags: a => (a.sources.anilist?.tags || [])
      .filter(t => (t.rank ?? 0) >= minRank)
      .map(t => t.name),
  };
}

/**
 * A matched value as a human would name it.
 *
 * ⚠️ `FIELD_EXTRACTORS.anilistStaff` keys on the AniList staff **id**, which is
 * right for the math (a person's id is stable where their romanized name is
 * not) and unreadable in a tooltip — live-verified, the mark's reason rendered
 * as "anilistStaff: 120066, 100070". The record carries the names alongside
 * the ids, so the lookup is local and free; every other field is already its
 * own label.
 */
function labelFor(field: MetaField, value: FieldValue, anime: AnimeRecord): string {
  if (field !== 'anilistStaff') return String(value);
  const credit = (anime.sources.anilist?.staff || []).find(s => s.id === value);
  return credit?.name || String(value);
}

/** A title AniList has told us nothing about cannot be scored — only skipped. */
function isScoreable(a: AnimeRecord): boolean {
  const src = a.sources.anilist;
  return !!src && ((src.tags?.length ?? 0) > 0 || (src.staff?.length ?? 0) > 0);
}

/**
 * Score every unseen title against the owner's taste, and mark the top of the
 * distribution.
 *
 * Eligibility follows the feed's `SEEN_STATUSES` rather than "has any status":
 * `plan_to_watch` is a title you flagged, not one you judged, and both
 * `computeFeed` and `/mix` count it as unseen — a mark that disagreed would put
 * the badge on the main list at odds with the two surfaces it sits beside.
 * Also excluded: hidden, 👎'd, and premature sequels — a season is mostly
 * sequels, and "recommended" on part 3 of a show never started is the one
 * failure mode that would discredit the mark on sight.
 */
export function buildAffinityIndex(all: AnimeRecord[], options: AffinityOptions = {}): AffinityIndex {
  const downIds = options.downIds ?? new Set<string>();
  const weights = options.weights ?? AFFINITY_WEIGHTS;
  const minRank = options.tagMinRank ?? AFFINITY_TAG_MIN_RANK;

  const seeds = all.filter(a => {
    if (getEffectiveStatus(a) !== 'completed') return false;
    const sc = getEffectiveScore(a);
    return sc != null && sc >= TUNING.DEFAULT_SEED_THRESHOLD;
  });
  const empty: AffinityIndex = {
    scores: new Map(),
    marks: new Map(),
    thresholds: { strong: Infinity, notable: Infinity },
    coverage: { scoreable: 0, unseen: 0 },
    seedCount: seeds.length,
  };
  // No seeds, no taste profile: a fresh install would otherwise badge whatever
  // the IDF happened to favour, which is worse than badging nothing.
  if (seeds.length === 0) return empty;

  const seedW = (a: AnimeRecord) => {
    const score = getEffectiveScore(a) ?? TUNING.DEFAULT_SEED_THRESHOLD;
    return seedWeight(score, TUNING.DEFAULT_SEED_THRESHOLD) * seedGapBonus(a, score);
  };

  const idf = computeIdfSet(all);
  const disc = buildDiscriminativeProfiles(all, downIds, idf, { animes: seeds, weight: seedW });
  const extractors = affinityExtractors(minRank);
  // Tags get their own IDF: the rank floor changes their document frequencies,
  // so `idf.anilistTags` (built over every tag) would misweight them.
  const tagIdf = computeIdf(all, extractors.anilistTags);
  const base = buildFieldProfileSet(seeds, seedW, idf);
  const profiles: Record<MetaField, FieldProfile> = {
    ...base,
    // The netted pair, so a genre equally present in what the owner loved and
    // what they dropped scores on neither side.
    genre: disc.posGenre,
    studio: disc.posStudio,
    anilistTags: buildFieldProfile(seeds, seedW, extractors.anilistTags, tagIdf),
  };

  const relations = buildRelationIndex(all);
  const scores = new Map<string, number>();
  const eligible: AnimeRecord[] = [];
  let unseen = 0;

  for (const anime of all) {
    const status = getEffectiveStatus(anime);
    if (status && SEEN_STATUSES.has(status)) continue;
    if (anime.hidden || downIds.has(anime.id)) continue;
    unseen++;
    if (!isScoreable(anime)) continue;
    if (isPrematureSequel(anime, relations)) continue;

    let score = 0;
    for (const field of AFFINITY_FIELDS) {
      if (weights[field] <= 0) continue;
      score += weights[field] * flooredFieldMatch(anime, profiles[field], MATCH_DENOM_FLOOR[field]).score;
    }
    const rejection =
      TUNING.REJECTION_MIX.genre * flooredFieldMatch(anime, disc.negGenre, MATCH_DENOM_FLOOR.genre).score +
      TUNING.REJECTION_MIX.studio * flooredFieldMatch(anime, disc.negStudio, MATCH_DENOM_FLOOR.studio).score +
      TUNING.REJECTION_MIX.staffT1 * flooredFieldMatch(anime, disc.negStaffT1, MATCH_DENOM_FLOOR.anilistStaff).score;
    score += AFFINITY_REJECTION_WEIGHT * rejection;

    scores.set(anime.id, score);
    eligible.push(anime);
  }

  if (eligible.length === 0) return { ...empty, coverage: { scoreable: 0, unseen } };

  const sorted = [...scores.values()].sort((a, b) => b - a);
  const cutAt = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * (1 - p)))];
  const thresholds: Record<AffinityTier, number> = {
    strong: cutAt(AFFINITY_TIER_PERCENTILE.strong),
    notable: cutAt(AFFINITY_TIER_PERCENTILE.notable),
  };

  // Second pass over the badged rows only: the matched values are what make a
  // mark readable, and keeping them for all ~18k scored rows would be pure
  // memory for data nothing reads.
  const marks = new Map<string, AffinityMark>();
  for (const anime of eligible) {
    const score = scores.get(anime.id)!;
    if (score < thresholds.notable) continue;
    const tier: AffinityTier = score >= thresholds.strong ? 'strong' : 'notable';
    const why: { field: MetaField; values: string[]; weight: number }[] = [];
    for (const field of AFFINITY_FIELDS) {
      if (weights[field] <= 0) continue;
      const profile = profiles[field];
      const hit = flooredFieldMatch(anime, profile, MATCH_DENOM_FLOOR[field]);
      if (hit.score <= 0) continue;
      why.push({
        field,
        weight: weights[field] * hit.score,
        values: hit.matched
          .sort((a, b) => (profile.weights.get(b) || 0) - (profile.weights.get(a) || 0))
          .slice(0, WHY_VALUE_LIMIT)
          .map(value => labelFor(field, value, anime)),
      });
    }
    marks.set(anime.id, {
      tier,
      score,
      why: why.sort((a, b) => b.weight - a.weight).slice(0, WHY_FIELD_LIMIT).map(({ field, values }) => ({ field, values })),
    });
  }

  return { scores, marks, thresholds, coverage: { scoreable: eligible.length, unseen }, seedCount: seeds.length };
}

// ---------------------------------------------------------------------------
// Anticipation — the crowd number that exists BEFORE a title airs
// ---------------------------------------------------------------------------

/**
 * A season's titles have no `mean` until they air, which is the whole reason
 * the affinity mark exists. `num_list_users` is the one crowd figure MAL does
 * publish beforehand — people putting an announced show on their plan-to-watch
 * — so it answers "how much is this anticipated" at exactly the moment the
 * score column is empty.
 *
 * ⚠️ **Ranked WITHIN its own season, never across seasons.** The counts are a
 * present-day snapshot and grow for as long as a show exists, so a 2026-fall
 * title's 5,006 members and a 2024-fall title's 44,548 are not on one scale —
 * comparing them measures age, not hype. Within one unaired season every title
 * has had the same time to accumulate, which is the only comparison the number
 * supports.
 *
 * ⚠️ **Scoped to titles with no `mean`, on purpose.** Once a show airs, its
 * member count stops being anticipation and becomes success — and the score
 * column is back to say so. Showing both would be reporting the same fact
 * twice, with the weaker one dressed as news.
 */
const MIN_SEASON_COHORT = 8;

export function buildAnticipationIndex(all: AnimeRecord[]): Map<string, AnticipationMark> {
  const cohorts = new Map<string, AnimeRecord[]>();
  for (const anime of all) {
    const season = anime.catalog.startSeason;
    if (!season || anime.catalog.mean) continue;
    const key = `${season.year}-${season.season}`;
    const bucket = cohorts.get(key);
    if (bucket) bucket.push(anime); else cohorts.set(key, [anime]);
  }

  const out = new Map<string, AnticipationMark>();
  cohorts.forEach(cohort => {
    // A handful of titles carries no distribution to sit in — a percentile over
    // five rows says "third of five", which is not a claim about hype.
    if (cohort.length < MIN_SEASON_COHORT) return;
    const ranked = [...cohort].sort((a, b) => (b.catalog.numListUsers ?? 0) - (a.catalog.numListUsers ?? 0));
    ranked.forEach((anime, index) => {
      const users = anime.catalog.numListUsers ?? 0;
      if (users <= 0) return;
      out.set(anime.id, {
        users,
        rank: index + 1,
        cohort: ranked.length,
        percentile: 1 - index / ranked.length,
      });
    });
  });
  return out;
}
