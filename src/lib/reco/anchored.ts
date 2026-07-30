/**
 * The ANCHORED ranker — "what resembles THESE titles", for any number of anchors.
 *
 * One engine, two surfaces. It was `computeSimilarTo`'s body, which had exactly
 * one anchor because the detail page has exactly one title; the "/mix" page asks
 * the same question of a hand-picked SET, so the anchor count became a parameter
 * rather than a second copy of the scoring loop. `similar.ts` is now a thin
 * projection over this (see there for the lean `SimilarItem` shape), and
 * `api/anime/recommendations/mix.ts` is the other one.
 *
 * The model is the feed's, unchanged: `score = Σ weight · normalizedSourceValue`
 * over the pure kernel in `scoring.ts`, with a per-source `RecoContribution[]`
 * breakdown. What differs from `computeFeed`, all deliberate:
 *
 *  - **The positive taste profiles are built from the anchors alone**, so a
 *    source scores "shares a *rare* genre/tag/studio/creator with what you
 *    picked" rather than "fits your whole list". `suggestions` and `feedback`
 *    are user-global and have no per-anchor meaning, so `ANCHORED_WEIGHTS`
 *    forces them to 0; `rejection` and `popularity` stay on (they hold for any
 *    candidate).
 *  - **The candidate set is strictly the anchors' crowd edges** (MAL ∪ AniList,
 *    fetched by the caller). Metadata only RE-RANKS within it, never injects —
 *    that is what keeps this distinct from `byCredits.ts`, a catalog-wide credit
 *    similarity.
 *  - **Overlap is not a source of its own.** A candidate several anchors point
 *    at simply sums their backers into `crowd`, and matches a profile pooled
 *    from all of them, so it rises without a knob attached to nothing. The
 *    per-anchor split rides along in `perAnchor` for the explain.
 *  - **Nothing is fetched to hydrate**: an edge naming a title absent from the
 *    local catalog is skipped (no metadata to rank on).
 *
 * Server-only (reads the store + the feedback slice), but stateless: it never
 * touches the stored `RecommendationsData`.
 */

import { AnimeRecord, RecoSource, RecoContribution, SourceWeights } from '@/models/anime';
import { getAnimeForDisplay, getHiddenAnimeIds } from '@/lib/store';
import { ANCHORED_WEIGHTS } from '@/lib/reco/weights';
import {
  TUNING,
  computeIdfSet,
  buildFieldProfileSet,
  buildRejectionProfiles,
  fieldMatch,
  isPrematureSequel,
  SEEN_STATUSES,
} from '@/lib/reco/scoring';
import { feedbackIds, getFeedback } from '@/lib/reco/feedback';
import { getEffectiveStatus, getPrimaryTitle, catalogNameKey } from '@/lib/domain/animeUtils';
import { buildRelationIndex, resolveRelations } from '@/lib/domain/relations';
import { makeT, DEFAULT_LANG, type Lang } from '@/lib/i18n';

/**
 * One crowd edge, already resolved onto canonical ids by the caller (E9) — both
 * the anchor it came from and the title it points at. The routes are the ingest
 * boundary, so nothing in here speaks a provider id space.
 */
export interface AnchoredEdge {
  /** Canonical id of the anchor whose crowd recommends `id`. */
  anchorId: string;
  /** Canonical id of the recommended title. */
  id: string;
  /** Crowd backers (MAL `num_recommendations` / AniList net `rating`). */
  num: number;
}

/** One ranked candidate, with the anchors that pulled it in. */
export interface AnchoredItem {
  anime: AnimeRecord;
  /** Σ weight · normalizedSourceValue, same additive model as the feed. */
  score: number;
  breakdown: RecoContribution[];
  /** Anchors whose crowd edges backed this candidate, strongest first. */
  perAnchor: { id: string; title: string; backers: number }[];
  /** Effective (SIMKL-first) personal status, when the user already listed it. */
  status?: string;
  /** True when that status means the title has already been watched. */
  seen: boolean;
}

export interface AnchoredOptions {
  /** Full weight set; defaults to `ANCHORED_WEIGHTS`. */
  weights?: SourceWeights;
  /**
   * Drop titles the user has already watched. The detail-page drill-down keeps
   * them (its pool is ~25 edges and a heavy watcher would see it gutted); the
   * "/mix" feed defaults to dropping them, because there the pool is N anchors
   * wide and the question is what to watch NEXT.
   */
  excludeSeen?: boolean;
  /** Language for the server-built "Pourquoi ?" detail strings. */
  lang?: Lang;
}

/**
 * Rank the pooled crowd recommendations of one or more anchors. Pure read +
 * math over edges the caller fetched — no MAL/AniList calls, no writes.
 * Returns every eligible candidate, best first; slicing is the caller's job.
 */
export function computeAnchored(
  anchorIds: string[],
  malEdges: AnchoredEdge[],
  anilistEdges: AnchoredEdge[],
  options: AnchoredOptions = {}
): AnchoredItem[] {
  const lang = options.lang ?? DEFAULT_LANG;
  const t = makeT(lang);
  const weights = options.weights ?? ANCHORED_WEIGHTS;

  const all = getAnimeForDisplay();
  const byId = new Map<string, AnimeRecord>(all.map(a => [a.id, a]));
  // Relation lookups, shared by the franchise exclusion and `isPrematureSequel`.
  const relations = buildRelationIndex(all);

  const anchors = anchorIds.map(id => byId.get(id)).filter((a): a is AnimeRecord => !!a);
  if (anchors.length === 0) return [];

  // The anchors themselves and their franchise entries trivially "resemble"
  // what was picked. Both providers' edges count: MAL's `related_anime` alone
  // covers 48 titles catalog-wide, so this used to be a no-op on nearly every
  // anchor before `domain/relations.ts` unioned AniList's graph in.
  const excluded = new Set<string>();
  for (const anchor of anchors) {
    excluded.add(anchor.id);
    for (const rel of resolveRelations(anchor, relations)) excluded.add(rel.record.id);
  }
  const hiddenCanonical = new Set(getHiddenAnimeIds());
  const downCanonical = feedbackIds(getFeedback(), 'down');
  const anchorIdSet = new Set(anchors.map(a => a.id));

  /** candidate id -> { total backers, per-anchor split } for one crowd source. */
  type CrowdAcc = { total: number; perAnchor: Map<string, number> };
  const accumulate = (edges: AnchoredEdge[]): Map<string, CrowdAcc> => {
    const out = new Map<string, CrowdAcc>();
    for (const e of edges) {
      if (e.num <= 0 || !anchorIdSet.has(e.anchorId)) continue;
      let a = out.get(e.id);
      if (!a) { a = { total: 0, perAnchor: new Map() }; out.set(e.id, a); }
      a.total += e.num;
      a.perAnchor.set(e.anchorId, (a.perAnchor.get(e.anchorId) || 0) + e.num);
    }
    return out;
  };
  const crowd = accumulate(malEdges);
  const anilistCrowd = accumulate(anilistEdges);

  // Pass 1: hard filters + the maxima that normalize the unbounded sources.
  const eligible: { anime: AnimeRecord; candId: string }[] = [];
  let maxCrowd = 0;
  let maxAnilist = 0;
  let maxUsers: number = TUNING.POPULARITY_FLOOR;
  for (const candId of new Set([...crowd.keys(), ...anilistCrowd.keys()])) {
    if (excluded.has(candId)) continue;
    const anime = byId.get(candId);
    if (!anime) continue; // absent from the local catalog — nothing to rank on
    if (hiddenCanonical.has(anime.id) || downCanonical.has(anime.id)) continue;
    if (isPrematureSequel(anime, relations)) continue;
    if (options.excludeSeen) {
      const st = getEffectiveStatus(anime);
      if (st && SEEN_STATUSES.has(st)) continue; // plan_to_watch stays — it isn't seen
    }

    eligible.push({ anime, candId });
    maxCrowd = Math.max(maxCrowd, crowd.get(candId)?.total || 0);
    maxAnilist = Math.max(maxAnilist, anilistCrowd.get(candId)?.total || 0);
    maxUsers = Math.max(maxUsers, anime.catalog.numListUsers || 0);
  }
  if (eligible.length === 0) return [];

  const crowdDenom = Math.log(1 + maxCrowd) || 1;
  const anilistDenom = Math.log(1 + maxAnilist) || 1;
  const popDenom = Math.log10(maxUsers) || 1;

  // IDF over the full corpus (as in the feed), but the positive profiles are
  // built from the anchors alone: "shares a RARE genre/tag/studio/creator with
  // what you picked" scores far above "shares a ubiquitous one". Pooling the
  // anchors is also what makes a candidate matching SEVERAL of them rank high
  // without a dedicated overlap source.
  const idf = computeIdfSet(all);
  const self = buildFieldProfileSet(anchors, () => 1, idf);
  const { negGenre, negStudio } = buildRejectionProfiles(all, downCanonical, idf.genre, idf.studio);

  // Names/roles as the ANCHORS credit them — the explain says what the candidate
  // shares with the titles you picked. ⚠️ The studio map is keyed by
  // `catalogNameKey(name)`, NOT by studio id: that is the key space
  // `FIELD_EXTRACTORS.studio` builds the profile in, so `matched` comes back as
  // normalized names. Keying by id here silently rendered every studio as its
  // raw key (`#manglobe`) — live-caught on `/mix`, and inherited from the
  // one-anchor version this generalizes.
  const anchorStudioNames = new Map(anchors.flatMap(a => (a.catalog.studios || []).map(s => [catalogNameKey(s.name), s.name] as const)));
  const anchorStaffById = new Map(anchors.flatMap(a => (a.sources.anilist?.staff || []).map(s => [s.id, s] as const)));
  const anchorTitle = (id: string) => { const a = byId.get(id); return a ? getPrimaryTitle(a) : id; };
  const multi = anchors.length > 1;

  /** Anchor names behind one crowd source, strongest first. */
  const anchorNames = (acc?: CrowdAcc): string[] =>
    Array.from(acc?.perAnchor.entries() ?? [])
      .sort((x, y) => y[1] - x[1])
      .map(([id]) => anchorTitle(id));

  // Pass 2: score with the same additive weighted sum as the feed.
  const items: AnchoredItem[] = [];
  for (const { anime, candId } of eligible) {
    const crowdAcc = crowd.get(candId);
    const anilistAcc = anilistCrowd.get(candId);
    const crowdNum = crowdAcc?.total || 0;
    const anilistNum = anilistAcc?.total || 0;

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

    // With one anchor the count is the interesting number ("38 fans of this
    // title recommend it"); with several, WHICH of your picks backed it is.
    const details: Partial<Record<RecoSource, string | undefined>> = {
      crowd: crowdNum > 0
        ? (multi
          ? t('recoDetail.mixCrowd', { titles: anchorNames(crowdAcc).join(', ') })
          : t(crowdNum > 1 ? 'recoDetail.similarCrowd' : 'recoDetail.similarCrowdOne', { count: crowdNum }))
        : undefined,
      anilistCrowd: anilistNum > 0
        ? (multi
          ? t('recoDetail.mixAnilistCrowd', { titles: anchorNames(anilistAcc).join(', ') })
          : t(anilistNum > 1 ? 'recoDetail.similarAnilistCrowd' : 'recoDetail.similarAnilistCrowdOne', { count: anilistNum }))
        : undefined,
      genre: genreM.matched.length ? t('recoDetail.inCommon', { parts: (genreM.matched as string[]).join(', ') }) : undefined,
      studio: studioM.matched.length
        ? t('recoDetail.inCommon', { parts: studioM.matched.map(k => anchorStudioNames.get(k as string) || String(k)).join(', ') })
        : undefined,
      nsfw: values.nsfw > 0 && anime.catalog.nsfw ? t('recoDetail.sameNsfw', { value: anime.catalog.nsfw }) : undefined,
      rating: values.rating > 0 && anime.catalog.rating ? t('recoDetail.sameRating', { value: anime.catalog.rating.toUpperCase() }) : undefined,
      anilistTags: tagsM.matched.length ? t('recoDetail.inCommon', { parts: (tagsM.matched as string[]).join(', ') }) : undefined,
      anilistStaff: staffM.matched.length
        ? t('recoDetail.inCommon', { parts: staffM.matched
            .map(id => {
              const s = anchorStaffById.get(id as number);
              if (!s) return `#${id}`;
              return s.role ? `${s.role} : ${s.name}` : s.name;
            })
            .join(', ') })
        : undefined,
      rejection: (() => {
        const candStudioNames = new Map((anime.catalog.studios || []).map(s => [catalogNameKey(s.name), s.name]));
        const parts = [
          ...(negGenreM.matched as string[]),
          ...negStudioM.matched.map(k => candStudioNames.get(k as string) || String(k)),
        ];
        return parts.length ? t('recoDetail.closeToRejects', { parts: parts.join(', ') }) : undefined;
      })(),
      popularity: t('recoDetail.members', { count: (anime.catalog.numListUsers || 0).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US') }),
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

    // Backers summed across both crowd sources, so an anchor that only AniList
    // credits still shows up as one of the reasons this card is here.
    const perAnchorTotals = new Map<string, number>();
    for (const acc of [crowdAcc, anilistAcc]) {
      for (const [id, n] of acc?.perAnchor ?? []) perAnchorTotals.set(id, (perAnchorTotals.get(id) || 0) + n);
    }

    const status = getEffectiveStatus(anime);
    items.push({
      anime,
      score,
      breakdown,
      perAnchor: Array.from(perAnchorTotals.entries())
        .sort((x, y) => y[1] - x[1])
        .map(([id, backers]) => ({ id, title: anchorTitle(id), backers })),
      status,
      seen: !!status && SEEN_STATUSES.has(status),
    });
  }

  items.sort((x, y) => y.score - x.score || (y.anime.catalog.mean || 0) - (x.anime.catalog.mean || 0) || x.anime.id.localeCompare(y.anime.id));
  return items;
}
