/**
 * « Mes boîtes » — hand-drawn taste axes, stored in `user/boxes.json`.
 *
 * This module is two things that happen to share a file: the durable store, and
 * the ranker that makes filling a box cheap.
 *
 * **Why a box exists at all.** The feed's positive signal is derived entirely
 * from scores — every seed is a `completed` title scored >= 8 — so nothing in the
 * store records *why* one was liked. The 👍/👎 store was the earlier attempt and
 * goes unused for a good reason: it asks a PREDICTIVE question ("will you like
 * this unwatched title?"), which is the one thing the owner can't answer. A box
 * asks a retrospective one ("what was that, for you?") against 712 titles that
 * can answer it.
 *
 * **Why it lives beside `feedback.ts` rather than in `store/`.** Same shape and
 * same reason: durable `user/` data that is deliberately NOT joined into
 * `AnimeRecord`. Joining it would tax every row build and change the row-cache
 * key for data two pages read — the same argument that keeps the cast slice off
 * the seven-slice join.
 *
 * Server-only (uses `fs` via `jsonStore`), and listed as such in the eslint
 * client-safety block.
 */

import { AnimeRecord, Box, UserGroup, DEFAULT_BOX_EMOJI } from '@/models/anime';
import { getAnimeForDisplay } from '@/lib/store';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { getEffectiveStatus } from '@/lib/domain/animeUtils';
import { getFranchiseIndex } from '@/lib/domain/franchise';
import { mintSlugId } from '@/lib/domain/slug';
import { resolveBoxUnits, unitWeightFn } from '@/lib/domain/boxUnits';
import { nextExcluded, nextGroups, nextMembers } from '@/lib/domain/boxWrites';
import { getGroups } from '@/lib/reco/groups';
import { BOX_WEIGHTS } from '@/lib/reco/weights';
import {
  type MetaField,
  type FieldValue,
  type FieldProfile,
  FIELD_EXTRACTORS,
  computeIdf,
  buildFieldProfile,
  flooredFieldMatch,
  MATCH_DENOM_FLOOR,
} from '@/lib/reco/scoring';

const BOXES_FILE = dataFile('user/boxes.json');

/** A bare array, like `user/hidden.json` — there is no file-level state to carry. */
export function getBoxes(): Box[] {
  return readJsonFile<Box[]>(BOXES_FILE, []);
}

export function getBox(id: string): Box | undefined {
  return getBoxes().find(b => b.id === id);
}

export function createBox(name: string, emoji?: string, description?: string): Box {
  const boxes = getBoxes();
  const desc = description?.trim();
  const box: Box = {
    id: mintSlugId(name, new Set(boxes.map(b => b.id))),
    name: name.trim() || 'Sans nom',
    emoji: emoji?.trim() || DEFAULT_BOX_EMOJI,
    // Absent rather than empty: `description` is optional on the model, and an
    // empty string would make every "has one?" check read as true.
    ...(desc ? { description: desc } : {}),
    members: [],
    createdAt: new Date().toISOString(),
  };
  boxes.push(box);
  writeJsonFile(BOXES_FILE, boxes);
  return box;
}

/**
 * Rename / re-emoji / re-describe. The id is the URL and never changes.
 *
 * An empty or blank `description` CLEARS it, unlike `name`, which falls back to
 * the current one: a box must always have a name (it is the chip's label), and
 * must be allowed to have no description.
 */
export function updateBox(
  id: string,
  patch: { name?: string; emoji?: string | null; description?: string | null }
): Box | undefined {
  const boxes = getBoxes();
  const box = boxes.find(b => b.id === id);
  if (!box) return undefined;
  if (patch.name !== undefined) box.name = patch.name.trim() || box.name;
  if (patch.emoji !== undefined) {
    if (patch.emoji) box.emoji = patch.emoji;
    else delete box.emoji;
  }
  if (patch.description !== undefined) {
    const desc = patch.description?.trim();
    if (desc) box.description = desc;
    else delete box.description;
  }
  writeJsonFile(BOXES_FILE, boxes);
  return box;
}

export function deleteBox(id: string): boolean {
  const boxes = getBoxes();
  const next = boxes.filter(b => b.id !== id);
  if (next.length === boxes.length) return false;
  writeJsonFile(BOXES_FILE, next);
  return true;
}

/**
 * Replace a box's membership wholesale. The UI computes the new set (it is the
 * side that knows whether a click meant "the whole franchise" or "this entry"),
 * so this stays a dumb setter — deduped and order-preserving.
 */
export function setBoxMembers(id: string, memberIds: string[]): Box | undefined {
  const boxes = getBoxes();
  const box = boxes.find(b => b.id === id);
  if (!box) return undefined;
  box.members = [...new Set(memberIds)];
  writeJsonFile(BOXES_FILE, boxes);
  return box;
}

/**
 * Persist an incremental membership edit.
 *
 * `add`/`remove` rather than a full replacement, for the API route's race
 * argument: many chips against many boxes means many in-flight writes, and a
 * client-side read-modify-write would let the second clobber the first.
 *
 * The DECISION is `domain/boxWrites.ts`'; this is the file half.
 */
export function editBoxMembers(id: string, add: string[] = [], remove: string[] = []): Box | undefined {
  return applyToBox(id, box => nextMembers(box, add, remove));
}

/** Persist an « écartés » edit. See `nextExcluded` for the two rules. */
export function editBoxExcluded(id: string, add: string[] = [], remove: string[] = []): Box | undefined {
  return applyToBox(id, box => nextExcluded(box, add, remove));
}

/** Persist a group-declaration edit. See `nextGroups` for the lens rule. */
export function editBoxGroups(id: string, declare: string[] = [], undeclare: string[] = []): Box | undefined {
  return applyToBox(id, box => nextGroups(box, declare, undeclare));
}

/**
 * Attach a reco profile to a box, or detach it with `null`.
 *
 * Its own function rather than a field on `updateBox`, and that is load-bearing:
 * `updateBox` is what the MCP `edit_box` tool renames and re-describes through,
 * while attaching a profile re-weights every ranking the box produces — so it is
 * blocked BY NAME on the MCP surface (DESIGN §9), which only works if it has a
 * name of its own. Existence of the profile is the route's check; this module
 * cannot import `profiles.ts`, which imports it.
 */
export function setBoxProfile(id: string, profileId: string | null): Box | undefined {
  return applyToBox(id, box => {
    const next = { ...box };
    if (profileId) next.profileId = profileId;
    else delete next.profileId;
    return next;
  });
}

/**
 * Read, apply a pure reducer, write back.
 *
 * The one seam every incremental box write goes through, so the rules in
 * `domain/boxWrites.ts` cannot be bypassed by a caller that reaches for the file
 * directly — and so those rules stay testable without a store on disk.
 */
function applyToBox(id: string, reduce: (box: Box) => Box): Box | undefined {
  const boxes = getBoxes();
  const index = boxes.findIndex(b => b.id === id);
  if (index === -1) return undefined;
  const next = reduce(boxes[index]);
  boxes[index] = next;
  writeJsonFile(BOXES_FILE, boxes);
  return next;
}

/** Every box holding this title — the chip row's state, for one card. */
export function boxesContaining(canonicalId: string, boxes = getBoxes()): string[] {
  return boxes.filter(b => b.members.includes(canonicalId)).map(b => b.id);
}

// ---------------------------------------------------------------------------
// The grow ranker
// ---------------------------------------------------------------------------

// How a box is weighted is `BOX_WEIGHTS` in `reco/weights.ts` — measured, and
// NOT the feed's weighting; the reasons are recorded there. It lives in the
// client-safe module because the profile page shows what an untouched slider
// resolves to, which is `ANCHORED_WEIGHTS`' reason for living there too.

const BOX_FIELDS: MetaField[] = ['genre', 'studio', 'anilistTags', 'anilistStaff'];

/**
 * Minimum AniList tag relevance a box counts, 0-100.
 *
 * The shared `FIELD_EXTRACTORS.anilistTags` takes every tag, which is right for
 * the feed (IDF sorts the wheat from the chaff across a ~25k corpus). Over a
 * box's handful of members there is no such corpus effect, so the long tail of
 * rank-20 descriptors — `Male Protagonist`, `Heterosexual`, `Primarily Teen
 * Cast` — enters the profile with the same standing as `Lost Civilization`.
 * The design probe that justified this whole feature filtered at 60, and that
 * filter is a large part of why its neighbours were coherent.
 */
export const BOX_TAG_MIN_RANK = 60;

/** Field extractors for a box: the shared set, with tags cut at the rank floor. */
function boxExtractors(minRank: number): Record<MetaField, (a: AnimeRecord) => FieldValue[]> {
  return {
    ...FIELD_EXTRACTORS,
    anilistTags: a => (a.sources.anilist?.tags || [])
      .filter(t => (t.rank ?? 0) >= minRank)
      .map(t => t.name),
  };
}

export interface RankBoxOptions {
  limit?: number;
  /** Override for tuning probes; defaults to `BOX_WEIGHTS`. */
  weights?: Record<MetaField, number>;
  /** Override for tuning probes; defaults to `BOX_TAG_MIN_RANK`. */
  tagMinRank?: number;
  /**
   * The global « Mes regroupements » definitions; defaults to `getGroups()`.
   *
   * A parameter so `scripts/probe-box.js` can sweep a hand-written fixture —
   * ⚠️ which is how a collapse is measured at all, since the weighting has NO
   * effect until a group is DECLARED on the box (`Box.groups`), and a live store
   * whose boxes declare nothing ranks exactly as it did before.
   */
  groups?: UserGroup[];
}

/** Matched values shown per field. Enough to justify a row, not enough to read as a list. */
const MATCH_LIMIT = 4;

/** One franchise group proposed for the box, with the values that earned it. */
export interface BoxCandidateGroup {
  /** The best-scoring member's canonical id — the group's key and its display anchor. */
  id: string;
  score: number;
  /** Every member of the direct-relation component; adding the group adds them all. */
  members: AnimeRecord[];
  /** Why it is here, strongest field first. This is what makes a decision cheap. */
  matched: { field: MetaField; values: string[] }[];
}

/**
 * Per-field IDF over the whole catalog, memoized on the row array's identity
 * (the WeakMap trick `byCredits` and `api/anime/genres` use) — the row array is
 * replaced whenever a slice's mtime moves, so this self-invalidates.
 *
 * Not `computeIdfSet`: that one hardcodes `FIELD_EXTRACTORS`, and a box counts
 * only tags above the rank floor, which changes their document frequencies.
 * Keyed by the floor so a tuning probe can sweep it without poisoning the cache.
 */
const idfCache = new WeakMap<AnimeRecord[], Map<number, Record<MetaField, Map<FieldValue, number>>>>();

function idfFor(all: AnimeRecord[], minRank: number): Record<MetaField, Map<FieldValue, number>> {
  let byRank = idfCache.get(all);
  if (!byRank) { byRank = new Map(); idfCache.set(all, byRank); }
  const hit = byRank.get(minRank);
  if (hit) return hit;

  const extractors = boxExtractors(minRank);
  const built = Object.fromEntries(
    BOX_FIELDS.map(f => [f, computeIdf(all, extractors[f])])
  ) as Record<MetaField, Map<FieldValue, number>>;
  byRank.set(minRank, built);
  return built;
}

/**
 * Rank the owner's OWN watched list by resemblance to a box, grouped by direct
 * franchise. Pure local read + math: no provider call, so the grow loop is
 * instant and re-ranks on every accept.
 *
 * Scope is the statused list, not the catalog, because a box member has to be
 * something the owner watched and can judge. Grouping is `direct`
 * (sequel/prequel) rather than `franchise`: measured on the live store, the
 * wider scope chains Gundam SEED, 00, Iron-Blooded Orphans and Witch from
 * Mercury into ONE 129-entry component, so a single click would file four
 * unrelated shows.
 */
export function rankBoxCandidates(
  box: Box,
  all: AnimeRecord[] = getAnimeForDisplay(),
  options: RankBoxOptions = {}
): BoxCandidateGroup[] {
  const limit = options.limit ?? 60;
  const weights = options.weights ?? BOX_WEIGHTS;
  const minRank = options.tagMinRank ?? BOX_TAG_MIN_RANK;

  const byId = new Map(all.map(a => [a.id, a]));
  const memberSet = new Set(box.members);
  /**
   * ⚠️ « Écartés » are candidates the owner has already said NO to, so
   * re-proposing them is the one thing the field exists to prevent. Skipping
   * them here rather than filtering afterwards keeps the `limit` honest: a
   * post-filter would silently return fewer than asked for.
   *
   * It is box-local, like the set itself — a title set aside from
   * `Absolute cinema` says nothing about any other box, and nothing about the
   * global feed.
   */
  const excludedSet = new Set(box.excluded ?? []);
  const members = box.members.map(id => byId.get(id)).filter((a): a is AnimeRecord => !!a);
  if (members.length === 0) return [];

  const idf = idfFor(all, minRank);
  const extractors = boxExtractors(minRank);

  // ⚠️ **One vote per UNIT, not per entry.** `() => 1` here was a ranking bug,
  // not a simplification: N filed cours of one show cast N votes, which on the
  // live store handed the biggest show 50% of the profile in three of the 13
  // non-empty boxes (Demon Slayer 7 + Bleach 5 + Chainsaw Man 2 = `Shonen I
  // dig`). What it drowned is the giveaway — holding the exclusion set fixed,
  // collapsing changed 11 of the top 15 proposals for `Absolute cinema` and
  // surfaced the box's own third show from under its Bleach and Link Click blocs.
  //
  // The collapse is `domain/boxUnits.ts`' and reads only the box's DECLARED
  // groups, so a box that declares none is weighted exactly as before — the
  // fix is inert until the owner says two entries are one thing.
  const weightOf = unitWeightFn(resolveBoxUnits(box, options.groups ?? getGroups()));
  const profiles = Object.fromEntries(
    BOX_FIELDS.map(f => [f, buildFieldProfile(members, weightOf, extractors[f], idf[f])])
  ) as Record<MetaField, FieldProfile>;

  const franchises = getFranchiseIndex(all, 'direct');

  /** Best-scoring member per franchise component. */
  const best = new Map<string, BoxCandidateGroup>();
  for (const anime of all) {
    if (memberSet.has(anime.id)) continue;
    if (excludedSet.has(anime.id)) continue;
    if (!getEffectiveStatus(anime)) continue;

    let score = 0;
    const matched: { field: MetaField; values: string[]; weight: number }[] = [];
    for (const field of BOX_FIELDS) {
      if (weights[field] <= 0) continue;
      const profile = profiles[field];
      const hit = flooredFieldMatch(anime, profile, MATCH_DENOM_FLOOR[field]);
      if (hit.score <= 0) continue;
      const weighted = weights[field] * hit.score;
      score += weighted;
      matched.push({
        field,
        weight: weighted,
        // Strongest profile values first, so a row leads with `Lost Civilization`
        // rather than with whichever tag happened to be extracted first.
        values: hit.matched
          .sort((a, b) => (profile.weights.get(b) || 0) - (profile.weights.get(a) || 0))
          .slice(0, MATCH_LIMIT)
          .map(String),
      });
    }
    if (score <= 0) continue;

    const group = franchises.get(anime.id) ?? [anime];
    // The component's key is stable whichever member we reach it by: every
    // member maps to the same group array, so its first id will do.
    const key = group[0].id;
    const existing = best.get(key);
    if (existing && existing.score >= score) continue;
    best.set(key, {
      id: anime.id,
      score,
      members: group,
      matched: matched.sort((a, b) => b.weight - a.weight).map(({ field, values }) => ({ field, values })),
    });
  }

  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
