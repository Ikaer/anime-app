/**
 * The reco-profile PREVIEW — what a weighting would retrieve for an anchor set,
 * before it is saved or attached (docs/recoProfiles/DESIGN.md §7, §8).
 *
 * A tuning instrument for the profile page, NOT a fourth recommendation
 * surface: a catalog-wide metadata ranker already ships a verdict (`affinity.ts`'
 * « Recommandé » mark), and a second one under another name is the kind of
 * contradicting verdict CLAUDE.md refuses between the mark and `recoMeta`.
 *
 * **Three pools, each the ranker a profile actually drives — never a copy.**
 *
 *  - `catalog` (the default) — `rankBoxCandidates` over the UNSEEN catalog:
 *    `buildUnseenPool`, the mark's own eligibility (unseen, not refused,
 *    scoreable, not a premature sequel). ⚠️ Why this pool leads: on a small box
 *    the fill loop's statused pool is silence — « Absolute cinema »'s director
 *    slider reaches 2 statused titles against 119 catalog ones (DESIGN §7).
 *  - `statused` — `rankBoxCandidates` unchanged: the fill loop the MCP proposes
 *    members through. A profile still applies there; it just moves little.
 *  - `anchored` — `computeAnchored` over the box's crowd edges: the box's recos
 *    tab (`/api/anime/recommendations/mix?box=`), the one surface the owner sees
 *    a profile on. ⚠️ The only pool that REACHES THE NETWORK (MAL per anchor,
 *    AniList once, both cached per anchor for the process's life), which is why
 *    it is opt-in rather than the default. Measured in PLAN.md phase 4: a family
 *    at 1.0 is a nudge there, because `crowd` tops out at 1.0.
 *
 * **The two metadata pools resolve over `BOX_WEIGHTS`, the anchored one over
 * `ANCHORED_WEIGHTS`** — the base each ranker really uses, so a preview
 * predicts the saved profile rather than approximating it. Echoed as `base`,
 * the weights an untouched slider resolves to (what a control encodes against),
 * with `staffZeroed` so the page can say `anilistStaff` moved on its own.
 *
 * Server-only: reads the store, the groups, the 👎 store, and (anchored) calls
 * MAL / AniList through `mixFetch`.
 */

import type { AnimeRecord, Box, RecoContribution } from '@/models/anime';
import { getAnimeForDisplay } from '@/lib/store';
import { rankBoxCandidates } from '@/lib/reco/boxes';
import { getGroups } from '@/lib/reco/groups';
import { feedbackIds, getFeedback } from '@/lib/reco/feedback';
import { computeAnchored } from '@/lib/reco/anchored';
import { boxAnchorIds, boxAnsweredIds, loadMixEdges, MAX_MIX_ANCHORS, type MixSourceOutcome } from '@/lib/reco/mixFetch';
import { buildUnseenPool } from '@/lib/reco/affinity';
import { diagnoseFamilies, type ProfileDiagnostic } from '@/lib/reco/profileDiagnostic';
import { resolveProfile, type ProfileWeights } from '@/lib/reco/profileWeights';
import { BOX_WEIGHTS, ANCHORED_WEIGHTS } from '@/lib/reco/weights';
import type { MatchField, StaffFamily } from '@/lib/reco/staffFields';
import { resolveBoxUnits } from '@/lib/domain/boxUnits';
import { toLeanRow, type LeanAnimeRow } from '@/lib/domain/leanRow';
import type { Lang } from '@/lib/i18n';
import type { TitleLanguage } from '@/lib/url/viewDefaults';

export const PREVIEW_POOLS = ['catalog', 'statused', 'anchored'] as const;
export type PreviewPool = typeof PREVIEW_POOLS[number];

export interface PreviewInput {
  /** The weighting to preview — sparse, already sanitized by the caller. */
  weights: ProfileWeights;
  /** Anchor on a saved box: its members, its declared groups, its écartés. */
  box?: Box;
  /** …or on an ad-hoc set (`/mix`'s `a=` key), each title its own unit. */
  anchorIds?: string[];
  pool: PreviewPool;
  limit: number;
  /** `anchored` only. Defaults ON for a box (the recos tab's default), OFF for an ad-hoc set (`/mix`'s). */
  includeSeen?: boolean;
  lang: Lang;
  titleLang: TitleLanguage;
}

export interface PreviewRow {
  row: LeanAnimeRow;
  score: number;
  /** Metadata pools: how many OTHER entries of the row's direct franchise it stands for. */
  franchise?: number;
  /** Metadata pools: what earned the row, strongest field first — families included. */
  matched?: { field: MatchField; values: string[] }[];
  /** `anchored`: the recos tab's « Pourquoi ? » rows, families included. */
  breakdown?: RecoContribution[];
}

export interface PreviewResult {
  pool: PreviewPool;
  /** Anchors that exist in the store — and, on `anchored`, the representatives actually asked about. */
  anchors: { present: number; asked?: string[] };
  /** The pool's base with the profile applied — what an untouched slider resolves to. */
  base: Record<string, number>;
  families: Record<StaffFamily, number>;
  staffZeroed: boolean;
  /** §8, over the anchor set's DECLARED units. */
  diagnostic: ProfileDiagnostic;
  /**
   * `catalog`: how much of the unseen catalog could be scored at all. A thin
   * answer on a mostly-unscoreable catalog means "no metadata", not "nothing
   * resembles this" — the mark's own coverage posture.
   */
  coverage?: { eligible: number; unseen: number };
  /** `anchored`: per crowd source — a dead pipe is declared, not hidden behind a thin list. */
  sources?: { mal: MixSourceOutcome; anilist: MixSourceOutcome };
  items: PreviewRow[];
}

export async function previewProfile(input: PreviewInput): Promise<PreviewResult> {
  const all = getAnimeForDisplay();
  const byId = new Map(all.map(a => [a.id, a]));
  const groups = getGroups();

  // An ad-hoc set ranks as a box with no declared groups and no écartés, so
  // every anchor is its own unit — the same reading `/mix` gives it.
  const anchorBox: Box = input.box ?? { id: '(preview)', name: '(preview)', members: input.anchorIds ?? [], createdAt: '' };
  const present = [...new Set(anchorBox.members)].filter(id => byId.has(id));

  const units = resolveBoxUnits(anchorBox, groups).units
    .map(unit => unit.members.map(id => byId.get(id)).filter((a): a is AnimeRecord => !!a));
  const diagnostic = diagnoseFamilies(units);

  if (input.pool === 'anchored') {
    const resolved = resolveProfile(ANCHORED_WEIGHTS, input.weights);
    const asked = input.box ? boxAnchorIds(input.box, present, byId, groups) : present.slice(0, MAX_MIX_ANCHORS);
    const head = {
      pool: input.pool,
      anchors: { present: present.length, asked },
      base: resolved.weights,
      families: resolved.families,
      staffZeroed: resolved.staffZeroed,
      diagnostic,
    };
    if (asked.length === 0) return { ...head, items: [] };

    const { sources, malEdges, anilistEdges } = await loadMixEdges(asked);
    const includeSeen = input.includeSeen ?? !!input.box;
    const ranked = computeAnchored(asked, malEdges, anilistEdges, {
      weights: resolved.weights,
      families: resolved.families,
      excludeSeen: !includeSeen,
      excludeIds: input.box ? boxAnsweredIds(input.box) : undefined,
      lang: input.lang,
      titleLang: input.titleLang,
    });
    return {
      ...head,
      sources,
      items: ranked.slice(0, input.limit).map(item => ({
        row: toLeanRow(item.anime, input.titleLang),
        score: item.score,
        breakdown: item.breakdown,
      })),
    };
  }

  const resolved = resolveProfile(BOX_WEIGHTS, input.weights);
  const unseen = input.pool === 'catalog' ? buildUnseenPool(all, feedbackIds(getFeedback(), 'down')) : undefined;
  const ranked = present.length === 0 ? [] : rankBoxCandidates(anchorBox, all, {
    limit: input.limit,
    groups,
    // The RAW profile, resolved inside over `BOX_WEIGHTS` — exactly the call the
    // MCP box tools make, so the preview cannot resolve differently from them.
    profile: input.weights,
    pool: unseen?.eligible,
  });

  return {
    pool: input.pool,
    anchors: { present: present.length },
    base: resolved.weights,
    families: resolved.families,
    staffZeroed: resolved.staffZeroed,
    diagnostic,
    ...(unseen ? { coverage: { eligible: unseen.eligible.size, unseen: unseen.unseen } } : {}),
    items: ranked.map(g => {
      const anchor = g.members.find(a => a.id === g.id) ?? g.members[0];
      return {
        row: toLeanRow(anchor, input.titleLang),
        score: g.score,
        ...(g.members.length > 1 ? { franchise: g.members.length - 1 } : {}),
        matched: g.matched,
      };
    }),
  };
}
