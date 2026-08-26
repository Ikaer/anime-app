/**
 * Importance tiers for AniList staff credits, as a **pure function of the role
 * string** (docs/staffRoleTiers.md).
 *
 * `AniListMetaEntry.staff` is AniList's top 50 by RELEVANCE, and that sort is
 * only loosely importance-first (see the CLAUDE.md note), so the detail page's
 * flat list gave `Episode Director (eps 8, 13, 20)` the same weight as
 * `Director`. Measured over the live store: 298,362 credits, **28,812 distinct
 * raw role strings** collapsing to 2,502 once trailing qualifiers are parsed off.
 *
 * Same shape as `genreAxis` and for the same reasons: closed whitelists for T1 /
 * T2 / T4 with an open **fall-through to T3**, so a role AniList adds next year
 * is imprecise but never unclassified and never silently hidden. No new catalog
 * field, no precedence entry, no migration, no re-sweep — a misclassification is
 * fixed by editing an array.
 *
 * Live split: 298,362 credits → 16% / 23% / 32% / 30%.
 */

import type { AniListStaffEntry, AnimeRecord } from '@/models/anime';
import { getEffectiveStatus } from '@/lib/domain/animeUtils';

/** 1 = auteur, 4 = peripheral. T3 is the fall-through. */
export type StaffRoleTier = 1 | 2 | 3 | 4;

export const STAFF_ROLE_TIERS: StaffRoleTier[] = [1, 2, 3, 4];

/**
 * T1 — who the show *is*. Deliberately seven roles: this is the tier that gets
 * real emphasis, and it measures median 2 / p90 5 rows per title. Every addition
 * here costs the tier its meaning.
 */
const TIER_1 = [
  'Director', 'Chief Director', 'Original Creator', 'Original Story',
  'Series Composition', 'Character Design', 'Music',
];

/**
 * T2 — creative department heads. `Animation Producer` is the one producer
 * credit here: it is the production-side creative anchor rather than a committee
 * seat, and the rest of the producer family is consolidated into T3 below.
 */
const TIER_2 = [
  'Script', 'Screenplay', 'Script Composition', 'Storyboard',
  'Art Director', 'Art Design', 'Color Design', 'Director of Photography', 'Editing',
  'Sound Director', 'Sound Design',
  'Chief Animation Director', 'Animation Director', 'Chief Episode Director',
  'Character Animation Director', 'Action Animation Director',
  'Mechanical Animation Director', 'Effects Animation Director', 'Animation Supervisor',
  'Main Animator', 'Assistant Director', 'Unit Director',
  'Original Character Design', 'Mechanical Design', 'Concept Art',
  'Music Composition', 'Music Arrangement', 'Music Lyrics', 'Music Director',
  'Animation Producer', 'Original Plan',
];

/**
 * The producer/planning family, pinned to T3 **as a group**.
 *
 * Without this they scatter across three tiers by accident — `Producer` and
 * `Planning` matched T2, `Executive Producer` / `Chief Producer` / `Associate
 * Producer` fell through to T3, and `Advertising Producer` sat in T4. Measured
 * on JoJo Part 4, consolidating them cut T2 from 18 rows to 11 rows of pure
 * creative crew (T2's p90 12 → 10).
 */
const TIER_3_PRODUCERS = [
  'Producer', 'Executive Producer', 'Chief Producer', 'Associate Producer',
  'Assistant Producer', 'Line Producer', 'Planning', 'Planning Producer',
  'Music Producer', 'CG Producer', 'Advertising Producer', 'Sound Producer',
];

/**
 * T4 — rank-and-file production, promo and admin. Collapsed by default.
 *
 * `Key Animation` alone is 31,223 credits, the single most common role in the
 * store and the least useful one to read on a detail page. Localization reaches
 * T4 through the `ADR *` / language rules below rather than by enumeration.
 */
const TIER_4 = [
  'Key Animation', '2nd Key Animation', 'In-Between Animation', 'In-Between Check',
  'In-Betweens Check', 'Animation', 'Animation Check', 'Finishing', 'Finishing Check',
  'Coloring', 'Paint', 'Digital Paint', 'Layout', 'Photography', 'Digital Photography',
  'Video Editing', 'Online Editing', 'Offline Editing', 'HD Editing',
  'Recording', 'Recording Adjustment', 'Recording Assistant', 'Recording Engineer',
  'Mastering Engineer', 'Mixing Engineer', 'Audio Mixing',
  '2D Works', '3D Works', 'CG Animation', 'CG Modeling',
  'Advertising', 'Title Logo Design', 'Endcard', 'Eyecatch', 'Special Thanks',
  'Production Desk', 'Production Office', 'Production Office Supervisor',
  'Production Manager', 'Assistant Production Manager', 'Production Generalization',
  'Animation Production Generalization', 'Production Committee', 'System Manager',
  'Translator', 'Translation', 'Editing Assistant',
  'Assistance', 'Design Assistance', 'Planning Assistance', 'Production Assistance',
  'Animation Assistance', 'Photography Assistance', 'Background Art Assistance',
  'Script Assistance', 'Original Work Assistance', 'Music Production Assistance',
  'Sound Effects Assistance', 'Key Animation Assistance', 'Color Design Assistance',
  'Literary Arts Assistance',
];

/**
 * Dub-language qualifiers. `Japanese` is deliberately absent: it is the primary
 * language, not a localization marker.
 *
 * These reach ~7% of all credits (5,907 `(English)`, 961 `(Italian)`, 931
 * `(Brazilian Portuguese)`, …) and are irrelevant to an app that already
 * restricts cast to Japanese seiyuu.
 */
const DUB_LANGUAGES = new Set([
  'english', 'italian', 'polish', 'brazilian portuguese', 'german', 'french',
  'latin american spanish', 'spanish', 'swedish', 'hungarian', 'korean',
  'portuguese', 'russian', 'chinese', 'dutch', 'danish', 'norwegian', 'finnish',
  'hebrew', 'greek', 'turkish', 'arabic', 'thai', 'vietnamese', 'indonesian',
  'czech', 'catalan', 'cantonese', 'mandarin', 'tagalog', 'hindi', 'ukrainian',
  'romanian', 'croatian', 'serbian', 'bulgarian', 'slovak', 'slovenian',
  'estonian', 'latvian', 'lithuanian', 'icelandic', 'malay', 'persian',
  'bengali', 'tamil', 'urdu',
]);

/** `(ep 3)`, `(eps 1, 2)`, `(eps 1-3)`, `(OP1, eps 4, 14)` — a per-episode credit. */
const EPISODE_QUALIFIER = /\beps?\b|\bepisodes?\b/i;

/**
 * ⚠️ **This trim is load-bearing on its own, and not for the reason the tier
 * path's other trim is.** It is the only normalization applied to strings this
 * module *manufactures*: `staffRoleTier` splits a qualifier on `;`, so
 * `Theme Song Performance (OP; English)` yields the part `" English"`, whose
 * leading space defeats the `DUB_LANGUAGES` lookup. Measured on the live store,
 * dropping this trim alone moves **37 credits / 16 distinct strings** out of T4
 * — dub theme-song credits stop reading as localization and surface in the
 * fall-through. The existing `(English; ADV)` shape hides this, because there
 * the language is the first part and needs no trimming.
 *
 * ⚠️ Consequently **normalizing once at the entry to `staffRoleTier` cannot
 * replace this**: the `;` split happens *after* any input-level trim and
 * produces fresh untrimmed substrings. Do not "simplify" the pair that way.
 *
 * The bare untrimmed roles the docs cite (`"Producer "`, `"Director "`,
 * `"Music "` — 1,549 credits over 182 strings) are covered here **and** by
 * `parseStaffRole`, so removing either trim alone leaves those working. That
 * redundancy is what makes the two individually-load-bearing cases easy to
 * misread as dead code; each is pinned by its own test.
 */
function key(name: string): string {
  return name.trim().toLowerCase();
}

function buildSet(names: string[]): Set<string> {
  return new Set(names.map(key));
}

const TIER_1_SET = buildSet(TIER_1);
const TIER_2_SET = buildSet(TIER_2);
const TIER_3_PRODUCER_SET = buildSet(TIER_3_PRODUCERS);
const TIER_4_SET = buildSet(TIER_4);

export interface ParsedStaffRole {
  /** The role with every trailing parenthetical stripped, trimmed. */
  base: string;
  /** Those parentheticals, outermost-first: `['OP', 'ep 4']`. */
  qualifiers: string[];
}

/**
 * Split a raw role into its base and trailing qualifiers.
 *
 * ⚠️ **`raw.trim()` is load-bearing, and specifically because the peel regex is
 * `$`-anchored.** Whitespace *after* the closing paren makes the match fail
 * outright, so nothing is peeled at all: `"Episode Director (ep 2) "` keeps its
 * qualifier inside `base`, misses every whitelist, and rule 2 never fires. The
 * live store holds **266 such credits over 203 distinct strings**, and dropping
 * this trim alone moves **141 credits / 108 strings** — rank-and-file work
 * (`Key Animation (ep 3) `, `In-Between Animation (ep 1) `) escaping the
 * collapsed T4 section into the fall-through.
 *
 * ⚠️ It is **not** what saves the bare `"Producer "` / `"Director "` / `"Music "`
 * strings the docs cite — `key()` trims those again on the way into the lookup,
 * so they survive either trim alone. Do not read one trim's removal passing the
 * suite as evidence it was dead; see `key()` above for the other half, and
 * `tests/domain/staffRole.test.ts` for the case that isolates each.
 *
 * Either way the failure is silent: the credit still renders, in the wrong
 * group, on a page nobody diffs — the `GENRE_ALIASES` failure mode.
 *
 * Exported (rather than module-private) only so the peel contract can be pinned
 * directly by the suite; `staffRoleTier` is its sole caller in `src/`.
 */
export function parseStaffRole(raw: string): ParsedStaffRole {
  let base = raw.trim();
  const qualifiers: string[] = [];
  // AniList nests at most one level in practice, but loop rather than assume.
  for (;;) {
    const m = base.match(/^(.*?)\s*\(([^()]*)\)$/);
    if (!m) break;
    qualifiers.unshift(m[2].trim());
    base = m[1].trim();
  }
  return { base, qualifiers };
}

/**
 * The tier a raw role string belongs to. Pure and client-safe.
 *
 * Three qualifier rules, which carry more of the value than the whitelists do:
 *
 * 1. `ADR *` or any dub-language qualifier → **T4 unconditionally**.
 * 2. An `ep`/`eps` qualifier **demotes exactly one tier** — so an anthology's
 *    per-segment directors land in T2 (visible as core crew) rather than being
 *    floored into T3. `Key Animation (ep 1)` reaches T4 the same way.
 * 3. `OP` / `ED` qualifiers are **deliberately ignored** (15,486 instances):
 *    on `Theme Song Performance (ED)` the qualifier says *which song*, not that
 *    the credit matters less.
 */
export function staffRoleTier(raw: string): StaffRoleTier {
  const { base, qualifiers } = parseStaffRole(raw);

  if (/^ADR\b/i.test(base)) return 4;
  for (const qualifier of qualifiers) {
    // `English; ADV` — AniList combines a language with a studio note.
    for (const part of qualifier.split(';')) {
      if (DUB_LANGUAGES.has(key(part))) return 4;
    }
  }

  const k = key(base);
  let tier: StaffRoleTier =
    TIER_1_SET.has(k) ? 1
      : TIER_2_SET.has(k) ? 2
        : TIER_3_PRODUCER_SET.has(k) ? 3
          : TIER_4_SET.has(k) ? 4
            : 3;

  if (tier < 4 && qualifiers.some(q => EPISODE_QUALIFIER.test(q))) {
    tier = (tier + 1) as StaffRoleTier;
  }
  return tier;
}

/**
 * Group a title's staff into the four tiers, preserving AniList's relevance
 * order within each.
 *
 * ⚠️ **T1 can be empty and the caller must tolerate it.** 1,690 titles with
 * staff carry no T1 credit — mostly shorts and music videos, but also
 * anthologies: on *Halo Legends* and *Genius Party Beyond* every `Director`
 * carries an `(ep N)` qualifier, so rule 2 lands all of them in T2. That is the
 * honest reading (an anthology has no single auteur), not a gap to paper over.
 * At the other end, *JAA Meets Yokohama* genuinely credits 36 directors.
 */
export function groupStaffByTier(
  staff: AniListStaffEntry[]
): Record<StaffRoleTier, AniListStaffEntry[]> {
  const out: Record<StaffRoleTier, AniListStaffEntry[]> = { 1: [], 2: [], 3: [], 4: [] };
  for (const credit of staff) out[staffRoleTier(credit.role)].push(credit);
  return out;
}

// ---------------------------------------------------------------------------
// Personal presence — "19 in your list"
// ---------------------------------------------------------------------------

/**
 * How many of the user's statused titles a staff member holds a **T1** credit
 * on, keyed by AniList staff id.
 */
export type StaffAffinityIndex = Map<number, number>;

/**
 * Below this, the mark is not worth printing. At `3` it fires on 15.8% of T1
 * rows on unseen titles (26% of those titles carry at least one) — selective
 * enough to read as emphasis.
 */
export const STAFF_AFFINITY_MIN = 3;

/**
 * Count, per staff id, the user's statused titles where they hold a T1 credit.
 *
 * **The T1 scoping is structural, not a refinement.** Raw prolificacy measures
 * the *role's* throughput rather than the person: a Sound Director at the 95th
 * percentile of their own role holds 77 credits where a Chief Director holds 6,
 * so any count that mixes roles just re-discovers which jobs are high-turnover.
 * Measured over T1+T2, 15 of the top 25 were Sound Directors or Editors — the
 * annotation would have printed "98 in your list" beside Jin Aketagawa and "30"
 * beside Hiroyuki Sawano on the same page. Restricting to T1 excludes those
 * roles by construction, with no second mechanism and no percentile machinery
 * (see docs/staffRoleTiers.md for why within-role percentiles were rejected).
 *
 * Counting **per person** rather than per person×role also keeps a career whole:
 * Keiko Nobumoto would otherwise split into a 1-credit `Series Composition` row
 * and a 12-credit `Script` row.
 *
 * Scoped to the statused list, which is also what makes it immune to the
 * catalog-wide version's worst failure — dub executives and Vocaloids top the
 * raw catalog counts and never enter a personal list.
 */
export function buildStaffAffinity(rows: AnimeRecord[]): StaffAffinityIndex {
  const counts: StaffAffinityIndex = new Map();
  for (const anime of rows) {
    if (!getEffectiveStatus(anime)) continue;
    const staff = anime.sources.anilist?.staff;
    if (!staff) continue;
    // Distinct per title: two T1 credits for one person on one show is one
    // title, same rule /stats follows for every dimension.
    const seen = new Set<number>();
    for (const credit of staff) {
      if (staffRoleTier(credit.role) !== 1 || seen.has(credit.id)) continue;
      seen.add(credit.id);
      counts.set(credit.id, (counts.get(credit.id) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Memoized on the row array's IDENTITY, the same trick `byCredits` and
 * `/api/anime/genres` use: the store hands out the same reference until a slice
 * actually changes on disk, so this walks the statused list once per data change
 * rather than once per detail-page view. WeakMap, so a rebuilt catalog drops the
 * old entry.
 */
const affinityCache = new WeakMap<AnimeRecord[], StaffAffinityIndex>();

export function getStaffAffinity(rows: AnimeRecord[]): StaffAffinityIndex {
  let index = affinityCache.get(rows);
  if (!index) {
    index = buildStaffAffinity(rows);
    affinityCache.set(rows, index);
  }
  return index;
}

/**
 * The marks worth shipping to the page: `{ staffId: count }` for the T1 credits
 * on THIS title that clear the threshold.
 *
 * A plain object because it crosses the `getServerSideProps` JSON boundary, and
 * lean on purpose — a handful of entries rather than the whole index.
 */
export function pickStaffAffinity(
  staff: AniListStaffEntry[],
  index: StaffAffinityIndex,
  min: number = STAFF_AFFINITY_MIN
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const credit of staff) {
    if (staffRoleTier(credit.role) !== 1) continue;
    const count = index.get(credit.id) || 0;
    if (count >= min) out[credit.id] = count;
  }
  return out;
}
