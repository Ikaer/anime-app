/**
 * "Plus comme ça" — the single-target drill-down behind the detail page block.
 *
 * Same weighted-source machinery as `feed.ts`, one anchor instead of the user's
 * whole seed set, so the taste profiles are built from the target anime alone.
 * See the banner below for the consequences, all deliberate.
 *
 * Server-only (reads the store + the feedback slice), but stateless: it never
 * touches the stored `RecommendationsData`.
 */

import { AnimeRecord, RecoSource, RecoContribution, SourceWeights } from '@/models/anime';
import { getAnimeForDisplay, getHiddenAnimeIds, toNum } from '@/lib/store';
import { DEFAULT_WEIGHTS } from '@/lib/reco/weights';
import {
  TUNING,
  computeIdfSet,
  buildFieldProfileSet,
  buildRejectionProfiles,
  fieldMatch,
  isPrematureSequel,
  SEEN_STATUSES,
} from '@/lib/reco/scoring';
import type { RecoEdge } from '@/lib/reco/data';
import { feedbackIds, getFeedback } from '@/lib/reco/feedback';
import { getEffectiveStatus, getPrimaryTitle } from '@/lib/domain/animeUtils';
import { makeT, DEFAULT_LANG, type Lang } from '@/lib/i18n';

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
export interface AniListEdgeInput {
  id: number;
  rating: number;
}

/**
 * Lean card shape for the drill-down — deliberately NOT `AnimeRecord` +
 * `RecoMeta`: `topSeeds` / `fromSuggestions` are meaningless with a single
 * anchor, and the detail page only needs enough to render a poster card.
 */
export interface SimilarItem {
  /** Canonical id (docs/PROVIDER-FREE-CUTOVER.md Phase D) — the detail-page route key. */
  id: string;
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
  anilistEdges: AniListEdgeInput[],
  limit: number = SIMILAR_LIMIT,
  lang: Lang = DEFAULT_LANG
): SimilarItem[] {
  const t = makeT(lang);
  const all = getAnimeForDisplay();
  // MAL-keyed, same reasoning as `computeFeed`'s `byId` — `targetId`/edge ids
  // arrive as MAL ids (docs/PROVIDER-FREE-CUTOVER.md Phase D/Risks).
  const byId = new Map<number, AnimeRecord>();
  for (const a of all) {
    const malId = toNum(a.crosswalk.mal);
    if (malId !== undefined) byId.set(malId, a);
  }
  const target = byId.get(targetId);
  if (!target) return [];

  // The target itself and its franchise entries trivially "resemble" it, and the
  // page already lists relations in its own section. These are raw MAL ids
  // (the target's own relation payload), kept separate from hidden/feedback
  // below (canonical-keyed) since a crowd-edge candidate id is MAL too.
  const excludedMalIds = new Set<number>([
    targetId,
    ...(target.catalog.relatedAnime || []).map(r => r.node.id),
  ]);
  const hiddenCanonical = new Set(getHiddenAnimeIds());
  const downCanonical = feedbackIds(getFeedback(), 'down');

  const crowd = new Map<number, number>();
  for (const e of malEdges) {
    if (e.num > 0) crowd.set(e.id, (crowd.get(e.id) || 0) + e.num);
  }
  const anilistCrowd = new Map<number, number>();
  for (const e of anilistEdges) {
    if (e.rating > 0) anilistCrowd.set(e.id, (anilistCrowd.get(e.id) || 0) + e.rating);
  }

  // Pass 1: hard filters + the maxima that normalize the unbounded sources.
  const eligible: { anime: AnimeRecord; candId: number }[] = [];
  let maxCrowd = 0;
  let maxAnilist = 0;
  let maxUsers: number = TUNING.POPULARITY_FLOOR;
  for (const candId of new Set([...crowd.keys(), ...anilistCrowd.keys()])) {
    if (excludedMalIds.has(candId)) continue;
    const anime = byId.get(candId);
    if (!anime) continue; // absent from the local catalog — nothing to rank on
    if (hiddenCanonical.has(anime.id) || downCanonical.has(anime.id)) continue;
    if (isPrematureSequel(anime, byId)) continue;

    eligible.push({ anime, candId });
    maxCrowd = Math.max(maxCrowd, crowd.get(candId) || 0);
    maxAnilist = Math.max(maxAnilist, anilistCrowd.get(candId) || 0);
    maxUsers = Math.max(maxUsers, anime.catalog.numListUsers || 0);
  }
  if (eligible.length === 0) return [];

  const crowdDenom = Math.log(1 + maxCrowd) || 1;
  const anilistDenom = Math.log(1 + maxAnilist) || 1;
  const popDenom = Math.log10(maxUsers) || 1;

  // IDF over the full corpus (as in the feed), but the positive profiles are
  // built from the single target: "shares a RARE genre/tag/studio/creator with
  // this title" scores far above "shares a ubiquitous one".
  const idf = computeIdfSet(all);
  const self = buildFieldProfileSet([target], () => 1, idf);
  const { negGenre, negStudio } = buildRejectionProfiles(all, downCanonical, idf.genre, idf.studio);

  // Names/roles as the TARGET credits them — the explain says what the candidate
  // shares with the anime you're looking at.
  const targetStudioNames = new Map((target.catalog.studios || []).map(s => [s.id, s.name]));
  const targetStaffById = new Map((target.sources.anilist?.staff || []).map(s => [s.id, s]));

  // Pass 2: score with the same additive weighted sum as the feed.
  const items: SimilarItem[] = [];
  for (const { anime, candId } of eligible) {
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
    const users = Math.max(anime.catalog.numListUsers || 0, TUNING.POPULARITY_FLOOR);

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
      crowd: crowdNum > 0 ? t(crowdNum > 1 ? 'recoDetail.similarCrowd' : 'recoDetail.similarCrowdOne', { count: crowdNum }) : undefined,
      anilistCrowd: anilistNum > 0 ? t(anilistNum > 1 ? 'recoDetail.similarAnilistCrowd' : 'recoDetail.similarAnilistCrowdOne', { count: anilistNum }) : undefined,
      genre: genreM.matched.length ? t('recoDetail.inCommon', { parts: (genreM.matched as string[]).join(', ') }) : undefined,
      studio: studioM.matched.length
        ? t('recoDetail.inCommon', { parts: studioM.matched.map(id => targetStudioNames.get(id as number) || `#${id}`).join(', ') })
        : undefined,
      nsfw: values.nsfw > 0 && anime.catalog.nsfw ? t('recoDetail.sameNsfw', { value: anime.catalog.nsfw }) : undefined,
      rating: values.rating > 0 && anime.catalog.rating ? t('recoDetail.sameRating', { value: anime.catalog.rating.toUpperCase() }) : undefined,
      anilistTags: tagsM.matched.length ? t('recoDetail.inCommon', { parts: (tagsM.matched as string[]).join(', ') }) : undefined,
      anilistStaff: staffM.matched.length
        ? t('recoDetail.inCommon', { parts: staffM.matched
            .map(id => {
              const s = targetStaffById.get(id as number);
              if (!s) return `#${id}`;
              return s.role ? `${s.role} : ${s.name}` : s.name;
            })
            .join(', ') })
        : undefined,
      rejection: (() => {
        const candStudioNames = new Map((anime.catalog.studios || []).map(s => [s.id, s.name]));
        const parts = [
          ...(negGenreM.matched as string[]),
          ...negStudioM.matched.map(id => candStudioNames.get(id as number) || `#${id}`),
        ];
        return parts.length ? t('recoDetail.closeToRejects', { parts: parts.join(', ') }) : undefined;
      })(),
      popularity: t('recoDetail.members', { count: (anime.catalog.numListUsers || 0).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US') }),
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
      id: anime.id,
      title: getPrimaryTitle(anime),
      poster: anime.catalog.mainPicture?.medium || anime.catalog.mainPicture?.large,
      mean: anime.catalog.mean,
      mediaType: anime.catalog.mediaType,
      year: anime.catalog.startSeason?.year,
      status,
      seen: !!status && SEEN_STATUSES.has(status),
      score,
      breakdown,
    });
  }

  items.sort((x, y) => y.score - x.score || (y.mean || 0) - (x.mean || 0) || x.id.localeCompare(y.id));
  return items.slice(0, limit);
}
