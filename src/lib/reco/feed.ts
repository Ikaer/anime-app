/**
 * "Pour toi" — the ranked feed.
 *
 * The cheap RANKING half of the engine: it recomputes the whole feed live from
 * the edges `refresh.ts` stored, so changing a ranking knob never requires a
 * re-fetch. Scoring is an additive `Σ weight · normalizedSourceValue` over the
 * pure kernel in `scoring.ts`; each card carries the per-source breakdown that
 * powers the on-demand "Pourquoi ?" explain.
 *
 * **Canonical ids throughout** (E9). Crowd edges arrive from MAL and AniList in
 * their own id spaces, but `refresh.ts` converts them at ingest, so nothing here
 * speaks a provider id: candidates, seeds, suggestions, the hidden/feedback
 * exclusions and each item's `.id` are all `a_<n>`. Relation edges are the one
 * provider-id payload left, and they are resolved to records by
 * `domain/relations.ts` rather than compared as ids.
 *
 * Server-only (reads the store and the two JSON caches). Never import this
 * module client-side except via `import type`.
 */

import { AnimeRecord, RecoMeta, RecoSource, RecoContribution, SourceWeights } from '@/models/anime';
import { getAnimeForDisplay, getHiddenAnimeIds } from '@/lib/store';
import { DEFAULT_WEIGHTS } from '@/lib/reco/weights';
import {
  TUNING,
  FIELD_EXTRACTORS,
  computeIdfSet,
  popularityScale,
  buildFieldProfile,
  buildFieldProfileSet,
  buildDiscriminativeProfiles,
  fieldMatch,
  isPrematureSequel,
  seedWeight,
  seedGapBonus,
  SEEN_STATUSES,
} from '@/lib/reco/scoring';
import { getRecommendationsData } from '@/lib/reco/data';
import { feedbackIds, getFeedback } from '@/lib/reco/feedback';
import { getEffectiveStatus, getEffectiveScore, getPrimaryTitle, catalogNameKey } from '@/lib/domain/animeUtils';
import { buildRelationIndex } from '@/lib/domain/relations';
import { staffRoleTier } from '@/lib/domain/staffRole';
import { makeT, DEFAULT_LANG, type Lang } from '@/lib/i18n';
import type { TitleLanguage } from '@/lib/url/viewDefaults';

export interface RecommendationItem extends AnimeRecord {
  recoMeta: RecoMeta;
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
  /** Language for the server-built "Pourquoi ?" detail strings. Defaults to `fr`. */
  lang?: Lang;
  /** Which of a title's three names seed/candidate titles are built from. */
  titleLang: TitleLanguage;
}

// ============================================================================
// Seeds
// ============================================================================

/**
 * Completed anime scored >= threshold, sorted by score desc. Uses the effective
 * (SIMKL-first) personal status/score — a SIMKL-only completion with no MAL
 * `my_list_status` still seeds the feed. NOTE: because a seed may carry no MAL
 * personal record, downstream reads of a seed's score MUST go through
 * `getEffectiveScore`, never `my_list_status!.score`.
 *
 * Exported because `refresh.ts` seeds the fetch from the same set — the seed
 * definition is one function, not one per half of the engine.
 */
export function getSeeds(threshold: number): AnimeRecord[] {
  return getAnimeForDisplay()
    .filter(a => {
      if (getEffectiveStatus(a) !== 'completed') return false;
      const score = getEffectiveScore(a);
      return score != null && score >= threshold;
    })
    .sort((a, b) => (getEffectiveScore(b) ?? 0) - (getEffectiveScore(a) ?? 0));
}

// ============================================================================
// Ranking (live, cheap)
// ============================================================================

interface Accumulator {
  affinity: number;
  /** seed canonical id -> summed backers (num) contributed by that seed. */
  perSeed: Map<string, number>;
}

/**
 * Cheap content signature for the diversity re-rank: the namespaced union of a
 * candidate's genre names + studio ids (the same two fields `fieldMatch`
 * already extracts). Namespacing (`g:` / `s:`) keeps a genre and a studio that
 * happen to share a string from colliding.
 */
function diversitySignature(anime: AnimeRecord): Set<string> {
  const s = new Set<string>();
  for (const g of anime.catalog.genres || []) s.add(`g:${g.name}`);
  for (const st of anime.catalog.studios || []) s.add(`s:${catalogNameKey(st.name)}`);
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

  const sig = new Map<string, Set<string>>();
  for (const it of items) sig.set(it.id, diversitySignature(it));

  const remaining = [...items]; // already sorted by (affinity desc, mean desc)
  const first = remaining.shift()!;
  const selected: RecommendationItem[] = [first];
  const maxSim = new Map<string, number>();
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
  const lang = options.lang ?? DEFAULT_LANG;
  const t = makeT(lang);
  const threshold = options.threshold ?? data.seedThreshold ?? TUNING.DEFAULT_SEED_THRESHOLD;

  const all = getAnimeForDisplay();
  // Canonical throughout (E9): the stored edges were converted at ingest, so
  // this is the record's own `.id` rather than a MAL crosswalk lookup.
  const byId = new Map<string, AnimeRecord>(all.map(a => [a.id, a]));
  // Relation lookups for `isPrematureSequel`, built once for the whole pass.
  const relations = buildRelationIndex(all);
  const hidden = new Set(getHiddenAnimeIds());
  const suggestionIds = new Set(data.suggestions.map(s => s.id));
  /**
   * MAL's suggestions arrive ORDERED (ranks 1..100 on the live store) and that
   * order was being thrown away: the source scored a flat 1 for all 100, so
   * MAL's top pick and its hundredth were indistinguishable. The rank was
   * already sitting in the cache unused. Discounted NDCG-style — `1/log2(1+rank)`
   * is bounded in [0,1] by construction (rank >= 1), gives rank 1 the full 1.0
   * and still leaves rank 100 a meaningful 0.15 rather than a cliff.
   */
  const suggestionRank = new Map(data.suggestions.map(s => [s.id, s.rank]));
  const suggestionValue = (candId: string): number => {
    const rank = suggestionRank.get(candId);
    return rank && rank > 0 ? 1 / Math.log2(1 + rank) : 0;
  };
  const feedback = getFeedback();
  const upIds = feedbackIds(feedback, 'up');
  const downIds = feedbackIds(feedback, 'down');

  // Accumulate affinity from edges, grouped by originating seed.
  const acc = new Map<string, Accumulator>();
  const bump = (candId: string, seedId: string, contribution: number, backers: number) => {
    let a = acc.get(candId);
    if (!a) { a = { affinity: 0, perSeed: new Map() }; acc.set(candId, a); }
    a.affinity += contribution;
    a.perSeed.set(seedId, (a.perSeed.get(seedId) || 0) + backers);
  };

  for (const [seedId, edges] of Object.entries(data.seeds)) {
    const seed = byId.get(seedId);
    const seedScore = seed ? getEffectiveScore(seed) : undefined;
    // Live threshold filter, with a fallback for 👍 seeds (no personal score).
    let weight: number;
    if (seed && typeof seedScore === 'number' && seedScore >= threshold) {
      weight = seedWeight(seedScore, threshold) * seedGapBonus(seed, seedScore);
    } else if (seed && upIds.has(seed.id)) {
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
  const anilistAcc = new Map<string, Accumulator>();
  const bumpAnilist = (candId: string, seedId: string, contribution: number, backers: number) => {
    let a = anilistAcc.get(candId);
    if (!a) { a = { affinity: 0, perSeed: new Map() }; anilistAcc.set(candId, a); }
    a.affinity += contribution;
    a.perSeed.set(seedId, (a.perSeed.get(seedId) || 0) + backers);
  };
  for (const [seedId, edges] of Object.entries(data.anilistSeeds || {})) {
    const seed = byId.get(seedId);
    const seedScore = seed ? getEffectiveScore(seed) : undefined;
    let weight: number;
    if (seed && typeof seedScore === 'number' && seedScore >= threshold) {
      weight = seedWeight(seedScore, threshold) * seedGapBonus(seed, seedScore);
    } else if (seed && upIds.has(seed.id)) {
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
  const seedW = (a: AnimeRecord) => {
    const score = getEffectiveScore(a) ?? threshold;
    return seedWeight(score, threshold) * seedGapBonus(a, score);
  };
  const idf = computeIdfSet(all);
  // Genre and studio come from the DISCRIMINATIVE pair (netted against the
  // dislikes) rather than the plain tally: a genre you complete and drop at the
  // same rate now scores on neither side instead of on both. The other four
  // fields have no negative counterpart and keep the plain profile.
  const disc = buildDiscriminativeProfiles(all, downIds, idf, { animes: seeds, weight: seedW });
  const pos = { ...buildFieldProfileSet(seeds, seedW, idf), genre: disc.posGenre, studio: disc.posStudio };
  // 👍 "bonne pioche" profile (genre + studio, flat weight — a thumb has no
  // numeric score). Its own weighted source, separate from the MAL-seed genre /
  // studio profiles, so the user can dial their explicit likes independently.
  const upAnime = all.filter(a => upIds.has(a.id));
  const fb = {
    genre: buildFieldProfile(upAnime, () => 1, FIELD_EXTRACTORS.genre, idf.genre),
    studio: buildFieldProfile(upAnime, () => 1, FIELD_EXTRACTORS.studio, idf.studio),
  };

  const { negGenre, negStudio, negStaffT1 } = disc;

  // Pass 1: apply hard filters and gather the maxima used to normalize the
  // unbounded sources (crowd affinity, popularity) onto a common [0,1] scale.
  const eligible: { anime: AnimeRecord; a: Accumulator; candId: string }[] = [];
  let maxRaw = 0;
  let maxAnilistRaw = 0;
  let maxUsers: number = TUNING.POPULARITY_FLOOR;
  let minUsers: number = Infinity;
  for (const [candId, a] of acc) {
    const anime = byId.get(candId);
    if (!anime) continue; // not hydrated yet — skip

    // Hard filters (spec §5.3)
    const st = getEffectiveStatus(anime);
    if (st && SEEN_STATUSES.has(st)) continue; // already seen (plan_to_watch allowed)
    if (hidden.has(anime.id)) continue;
    if (upIds.has(anime.id) || downIds.has(anime.id)) continue; // already thumbed
    if (isPrematureSequel(anime, relations)) continue; // later season of an unwatched show

    eligible.push({ anime, a, candId });
    if (a.affinity > maxRaw) maxRaw = a.affinity;
    const anilistAffinity = anilistAcc.get(candId)?.affinity ?? 0;
    if (anilistAffinity > maxAnilistRaw) maxAnilistRaw = anilistAffinity;
    const users = Math.max(anime.catalog.numListUsers || 0, TUNING.POPULARITY_FLOOR);
    if (users > maxUsers) maxUsers = users;
    if (users < minUsers) minUsers = users;
  }
  const crowdDenom = Math.log(1 + maxRaw) || 1;
  const anilistCrowdDenom = Math.log(1 + maxAnilistRaw) || 1;
  // Min-max, NOT a bare ratio — see `popularityScale`.
  const popValue = popularityScale(minUsers, maxUsers);

  // Pass 2: score each candidate as `Σ weight · normalizedSourceValue`, and
  // retain the per-source breakdown for the on-demand "Pourquoi ?" explain.
  const items: RecommendationItem[] = [];
  for (const { anime, a, candId } of eligible) {
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
    const negStaffM = fieldMatch(anime, negStaffT1);
    const users = Math.max(anime.catalog.numListUsers || 0, TUNING.POPULARITY_FLOOR);
    const anilistA = anilistAcc.get(candId);
    const anilistAffinity = anilistA?.affinity ?? 0;

    const values: SourceWeights = {
      crowd: maxRaw > 0 ? Math.log(1 + a.affinity) / crowdDenom : 0,
      anilistCrowd: maxAnilistRaw > 0 ? Math.log(1 + anilistAffinity) / anilistCrowdDenom : 0,
      suggestions: suggestionValue(candId),
      feedback: TUNING.GENRE_WEIGHT * fbGenreM.score + TUNING.STUDIO_WEIGHT * fbStudioM.score,
      genre: genreM.score,
      studio: studioM.score,
      nsfw: nsfwM.score,
      rating: ratingM.score,
      anilistTags: anilistTagsM.score,
      anilistStaff: anilistStaffM.score,
      rejection: TUNING.REJECTION_MIX.genre * negGenreM.score
        + TUNING.REJECTION_MIX.studio * negStudioM.score
        + TUNING.REJECTION_MIX.staffT1 * negStaffM.score,
      popularity: popValue(users),
    };

    const sortedSeeds = Array.from(a.perSeed.entries()).sort((x, y) => y[1] - x[1]);
    const seedTitle = (sid: string) => { const s = byId.get(sid); return s ? getPrimaryTitle(s, options.titleLang) : sid; };
    const topSeeds = sortedSeeds
      .slice(0, TUNING.TOP_SEEDS_PER_CANDIDATE)
      .map(([sid, backers]) => ({ id: sid, title: seedTitle(sid), backers }));
    // Full list (not just topSeeds) so the "Pourquoi ?" explain shows every seed.
    const allSeedTitles = sortedSeeds.map(([sid]) => seedTitle(sid));

    const anilistAllTitles = Array.from(anilistA?.perSeed.entries() ?? [])
      .sort((x, y) => y[1] - x[1])
      .map(([sid]) => seedTitle(sid));

    // Keyed like the studio profile (normalized name) so the explain can turn a
    // matched key back into the studio's display name.
    const studioNames = new Map((anime.catalog.studios || []).map(s => [catalogNameKey(s.name), s.name]));
    const staffById = new Map((anime.sources.anilist?.staff || []).map(s => [s.id, s]));
    const details: Partial<Record<RecoSource, string | undefined>> = {
      crowd: allSeedTitles.length ? t('recoDetail.crowd', { titles: allSeedTitles.join(', ') }) : undefined,
      anilistCrowd: anilistAllTitles.length ? t('recoDetail.anilistCrowd', { titles: anilistAllTitles.join(', ') }) : undefined,
      suggestions: values.suggestions ? t('recoDetail.suggestions') : undefined,
      feedback: (() => {
        const parts = [
          ...(fbGenreM.matched as string[]),
          ...fbStudioM.matched.map(k => studioNames.get(k as string) || String(k)),
        ];
        return parts.length ? t('recoDetail.feedback', { parts: parts.join(', ') }) : undefined;
      })(),
      genre: genreM.matched.length ? (genreM.matched as string[]).join(', ') : undefined,
      studio: studioM.matched.length
        ? studioM.matched.map(k => studioNames.get(k as string) || String(k)).join(', ')
        : undefined,
      nsfw: values.nsfw > 0 && anime.catalog.nsfw ? anime.catalog.nsfw : undefined,
      rating: values.rating > 0 && anime.catalog.rating ? anime.catalog.rating.toUpperCase() : undefined,
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
        // Staff names resolve against the candidate's T1 credits specifically:
        // `staffById` keeps whichever credit came last for a person with several
        // on this title, so it would happily render "Key Animation : X" as the
        // reason a T1 match fired.
        const t1ById = new Map(
          (anime.sources.anilist?.staff || [])
            .filter(s => staffRoleTier(s.role) === 1)
            .map(s => [s.id, s])
        );
        const parts = [
          ...(negGenreM.matched as string[]),
          ...negStudioM.matched.map(k => studioNames.get(k as string) || String(k)),
          ...negStaffM.matched.map(id => {
            const s = t1ById.get(id as number);
            if (!s) return `#${id}`;
            return s.role ? `${s.role} : ${s.name}` : s.name;
          }),
        ];
        return parts.length ? parts.join(', ') : undefined;
      })(),
      popularity: `${(anime.catalog.numListUsers || 0).toLocaleString('fr-FR')} membres`,
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
    return (y.catalog.mean || 0) - (x.catalog.mean || 0);
  });

  // Optional diversity re-rank (MMR). λ = 0 (default) leaves `items` untouched.
  return mmrRerank(items, options.diversity ?? 0);
}

