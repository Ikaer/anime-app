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
 *  - **A box's reco profile can add staff craft families** (`options.families`,
 *    docs/recoProfiles/). ⚠️ Those score through `denomFor` — the metadata
 *    fields above use the unfloored `fieldMatch`, which on a near-binary family
 *    would be the uncorrected scale `PROFILE_DENOM` exists to fix — and they
 *    ride in the same breakdown as the sources.
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
  popularityScale,
  buildDiscriminativeProfiles,
  fieldMatch,
  isPrematureSequel,
  scoreWithBreakdown,
  SEEN_STATUSES,
} from '@/lib/reco/scoring';
import { buildFamilyTerms, matchFamilyTerms, familyCredits, type StaffFamily } from '@/lib/reco/staffFields';
import { feedbackIds, getFeedback } from '@/lib/reco/feedback';
import { getEffectiveStatus, getPrimaryTitle, getRatingIntent, catalogNameKey } from '@/lib/domain/animeUtils';
import { buildRelationIndex, resolveRelations } from '@/lib/domain/relations';
import { staffRoleTier } from '@/lib/domain/staffRole';
import { makeT, DEFAULT_LANG, type Lang } from '@/lib/i18n';
import type { TitleLanguage } from '@/lib/url/viewDefaults';

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
   * Staff craft-family weights, from the box's reco profile — the `families`
   * half of `resolveProfile`/`resolveProfileOver`, whose `weights` half is the
   * option above (with `anilistStaff` already zeroed when any family is on).
   * Absent or all-zero = no family is built or scored, which is every surface
   * but a box with a profile attached.
   */
  families?: Partial<Record<StaffFamily, number>>;
  /**
   * Drop titles the user has already watched. The detail-page drill-down keeps
   * them (its pool is ~25 edges and a heavy watcher would see it gutted); the
   * "/mix" feed defaults to dropping them, because there the pool is N anchors
   * wide and the question is what to watch NEXT.
   */
  excludeSeen?: boolean;
  /**
   * Ids the caller has already answered for, dropped before scoring. The box
   * recos tab passes its `members` and `excluded`: both are verdicts on this
   * box, and without this a « Non » came back on every reload — the tab only
   * hid answered cards client-side. Dropped in pass 1 rather than off the
   * result so they do not set the maxima that normalize everyone else.
   */
  excludeIds?: ReadonlySet<string>;
  /** Language for the server-built "Pourquoi ?" detail strings. */
  lang?: Lang;
  /** Which of a title's three names `anchorTitle`/card titles are built from. */
  titleLang: TitleLanguage;
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
  options: AnchoredOptions
): AnchoredItem[] {
  const lang = options.lang ?? DEFAULT_LANG;
  const t = makeT(lang);
  const weights = options.weights ?? ANCHORED_WEIGHTS;
  const titleLang = options.titleLang;

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
  let minUsers: number = Infinity;
  for (const candId of new Set([...crowd.keys(), ...anilistCrowd.keys()])) {
    if (excluded.has(candId) || options.excludeIds?.has(candId)) continue;
    const anime = byId.get(candId);
    if (!anime) continue; // absent from the local catalog — nothing to rank on
    if (hiddenCanonical.has(anime.id) || downCanonical.has(anime.id)) continue;
    // ⚠️ NOT behind `excludeSeen`. "Plus comme ça" deliberately keeps seen
    // titles (marked « Déjà vu ») because its pool is ~25 edges wide and
    // dropping them would gut the block — but a rating intent is not the same
    // claim as a watch status: it is the owner saying "stop putting this in
    // front of me", which holds however small the pool is. Same tier as
    // `hidden` and 👎, and unconditional for the same reason.
    if (getRatingIntent(anime)) continue;
    if (isPrematureSequel(anime, relations)) continue;
    if (options.excludeSeen) {
      const st = getEffectiveStatus(anime);
      if (st && SEEN_STATUSES.has(st)) continue; // plan_to_watch stays — it isn't seen
    }

    eligible.push({ anime, candId });
    maxCrowd = Math.max(maxCrowd, crowd.get(candId)?.total || 0);
    maxAnilist = Math.max(maxAnilist, anilistCrowd.get(candId)?.total || 0);
    const users = Math.max(anime.catalog.numListUsers || 0, TUNING.POPULARITY_FLOOR);
    maxUsers = Math.max(maxUsers, users);
    minUsers = Math.min(minUsers, users);
  }
  if (eligible.length === 0) return [];

  const crowdDenom = Math.log(1 + maxCrowd) || 1;
  const anilistDenom = Math.log(1 + maxAnilist) || 1;
  // Min-max, NOT a bare ratio — see `popularityScale`.
  const popValue = popularityScale(minUsers, maxUsers);

  // IDF over the full corpus (as in the feed), but the positive profiles are
  // built from the anchors alone: "shares a RARE genre/tag/studio/creator with
  // what you picked" scores far above "shares a ubiquitous one". Pooling the
  // anchors is also what makes a candidate matching SEVERAL of them rank high
  // without a dedicated overlap source.
  const idf = computeIdfSet(all);
  const self = buildFieldProfileSet(anchors, () => 1, idf);
  // No `liked` argument: the netting reference must be the user's global likes,
  // not the anchors. Subtracting a one-title profile from the dislike rates
  // would say "this anchor's genres aren't rejections", which is not a claim
  // about the user at all. `self` above is therefore left un-netted — the
  // positive side here means "shares a rare value with what you picked".
  const { negGenre, negStudio, negStaffT1 } = buildDiscriminativeProfiles(all, downCanonical, idf);

  // The staff craft families a box's reco profile turns on (docs/recoProfiles/).
  // One vote per anchor: on the box recos tab the anchors are already one
  // representative per unit. Empty — no IDF pass, no profile — unless a family
  // is non-zero, so every other caller ranks exactly as before.
  const familyTerms = buildFamilyTerms(anchors, () => 1, options.families ?? {}, all);
  const familyNames = new Map(familyTerms.map(term => [term.family, familyCredits(anchors, term.family)] as const));

  // Names/roles as the ANCHORS credit them — the explain says what the candidate
  // shares with the titles you picked. ⚠️ The studio map is keyed by
  // `catalogNameKey(name)`, NOT by studio id: that is the key space
  // `FIELD_EXTRACTORS.studio` builds the profile in, so `matched` comes back as
  // normalized names. Keying by id here silently rendered every studio as its
  // raw key (`#manglobe`) — live-caught on `/mix`, and inherited from the
  // one-anchor version this generalizes.
  const anchorStudioNames = new Map(anchors.flatMap(a => (a.catalog.studios || []).map(s => [catalogNameKey(s.name), s.name] as const)));
  const anchorStaffById = new Map(anchors.flatMap(a => (a.sources.anilist?.staff || []).map(s => [s.id, s] as const)));
  const anchorTitle = (id: string) => { const a = byId.get(id); return a ? getPrimaryTitle(a, titleLang) : id; };
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
    const negStaffM = fieldMatch(anime, negStaffT1);
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
      rejection: TUNING.REJECTION_MIX.genre * negGenreM.score
        + TUNING.REJECTION_MIX.studio * negStudioM.score
        + TUNING.REJECTION_MIX.staffT1 * negStaffM.score,
      popularity: popValue(users),
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
        // Candidate-side names throughout: `fieldMatch` extracts from the
        // candidate, so `anchorStudioNames` / `anchorStaffById` would miss every
        // value the anchors don't happen to share.
        const candStudioNames = new Map((anime.catalog.studios || []).map(s => [catalogNameKey(s.name), s.name]));
        const candT1ById = new Map(
          (anime.sources.anilist?.staff || [])
            .filter(s => staffRoleTier(s.role) === 1)
            .map(s => [s.id, s])
        );
        const parts = [
          ...(negGenreM.matched as string[]),
          ...negStudioM.matched.map(k => candStudioNames.get(k as string) || String(k)),
          ...negStaffM.matched.map(id => {
            const s = candT1ById.get(id as number);
            if (!s) return `#${id}`;
            return s.role ? `${s.role} : ${s.name}` : s.name;
          }),
        ];
        return parts.length ? t('recoDetail.closeToRejects', { parts: parts.join(', ') }) : undefined;
      })(),
      popularity: t('recoDetail.members', { count: (anime.catalog.numListUsers || 0).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US') }),
    };

    // ⚠️ Family rows go through the SAME pass as the sources, so a family that
    // moves the score is always a line in « Pourquoi ? » — see
    // `scoreWithBreakdown`. Named with the credit that puts the person in THIS
    // family (`familyCredits`), as the anchors credit them.
    const familyRows: RecoContribution[] = matchFamilyTerms(anime, familyTerms).map(hit => ({
      source: hit.family,
      value: hit.value,
      weight: hit.weight,
      contribution: hit.contribution,
      detail: t('recoDetail.inCommon', {
        parts: hit.matched
          .map(id => {
            const credit = familyNames.get(hit.family)?.get(id as number);
            return credit ? `${credit.role} : ${credit.name}` : `#${id}`;
          })
          .join(', '),
      }),
    }));
    const { score, breakdown } = scoreWithBreakdown(values, weights, details, familyRows);

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
