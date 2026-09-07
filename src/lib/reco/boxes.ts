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

import { AnimeRecord, Box, DEFAULT_BOX_EMOJI } from '@/models/anime';
import { getAnimeForDisplay } from '@/lib/store';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { getEffectiveStatus } from '@/lib/domain/animeUtils';
import { getFranchiseIndex } from '@/lib/domain/franchise';
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

/**
 * Slug from the name, deduped against what already exists. Kept readable rather
 * than random because it is the `/boxes/[id]` URL — a bookmarked box should say
 * which one it is.
 */
function mintId(name: string, taken: Set<string>): string {
  const base = name
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || 'boite';
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function createBox(name: string, emoji?: string, description?: string): Box {
  const boxes = getBoxes();
  const desc = description?.trim();
  const box: Box = {
    id: mintId(name, new Set(boxes.map(b => b.id))),
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

/** Every box holding this title — the chip row's state, for one card. */
export function boxesContaining(canonicalId: string, boxes = getBoxes()): string[] {
  return boxes.filter(b => b.members.includes(canonicalId)).map(b => b.id);
}

// ---------------------------------------------------------------------------
// The grow ranker
// ---------------------------------------------------------------------------

/**
 * How a box is ranked, and it is NOT the feed's weighting — measured.
 *
 * The feed's `ANCHORED_WEIGHTS` were the obvious starting point and produced a
 * visibly worse list than the raw tag math the feature was designed on. Probed
 * on the live store with the `exotic-adventure` fixture, the top 12 came back
 * as *Black Bullet*, *Freezing*, *Shield Hero S3* and *Sayonara Lara* — every
 * one of them a Kinema Citrus title, pulled in because Made in Abyss is a
 * Kinema Citrus title. Two compounding causes:
 *
 *  - **`studio` is a near-binary field.** `fieldMatch` divides by the
 *    candidate's value count, and a title has ONE studio, so a studio hit
 *    scores ~1.0 where a tag hit scores ~0.4. At the feed's 0.15 it therefore
 *    outweighed the entire tag profile.
 *  - **`studio` and `anilistStaff` are the same evidence counted twice** — the
 *    same studio means largely the same credited crew, so a studio match drags
 *    its staff match along with it.
 *
 * That is fine for the FEED, where "more from a studio you like" is a real
 * recommendation. It is wrong for a box, which asks "is this the same KIND of
 * thing", and a production house is not a kind of thing. So tags carry the box,
 * genre supports it coarsely, and studio/staff are advisors rather than voters.
 *
 * ⚠️ These weights are box-local on purpose. Do not "unify" them with
 * `ANCHORED_WEIGHTS` — those are backtested against held-out favourites by
 * `scripts/backtest-reco.js`, this set answers a different question and the
 * harness cannot score it (see the module header on `scripts/probe-box.js`).
 */
export const BOX_WEIGHTS: Record<MetaField, number> = {
  genre: 0.25,
  studio: 0.05,
  nsfw: 0,
  rating: 0,
  anilistTags: 1.0,
  anilistStaff: 0.35,
};

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
  const members = box.members.map(id => byId.get(id)).filter((a): a is AnimeRecord => !!a);
  if (members.length === 0) return [];

  const idf = idfFor(all, minRank);
  const extractors = boxExtractors(minRank);
  const profiles = Object.fromEntries(
    BOX_FIELDS.map(f => [f, buildFieldProfile(members, () => 1, extractors[f], idf[f])])
  ) as Record<MetaField, FieldProfile>;

  const franchises = getFranchiseIndex(all, 'direct');

  /** Best-scoring member per franchise component. */
  const best = new Map<string, BoxCandidateGroup>();
  for (const anime of all) {
    if (memberSet.has(anime.id)) continue;
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
