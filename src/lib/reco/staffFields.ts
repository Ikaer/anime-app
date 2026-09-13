/**
 * Staff credits split by CRAFT — the fields a reco profile weights
 * (docs/recoProfiles/DESIGN.md §3-§5).
 *
 * `anilistStaff` is ONE field over the whole top-50 credit list, so "the
 * director matters more in this box" is not expressible: there is no knob that
 * separates a director from a key animator. `staffRole.ts` tiers credits by
 * IMPORTANCE, which is the wrong axis here — T1 mixes the director, the
 * character designer and the composer precisely because it answers "how
 * important", not "which department". This module answers "which department".
 *
 * Same shape as `genreAxis` and `staffRoleTier`: **a pure function of the role
 * string**, closed whitelists over `parseStaffRole(role).base`. No new catalog
 * field, no precedence entry, no migration, no AniList re-sweep — a
 * misclassification is fixed by editing an array. Unlike the tiers there is no
 * fall-through: a role in no family is in no family (`Key Animation`,
 * `Episode Director`, the whole producer block), which is the point.
 *
 * ⚠️ **Deliberately NOT `MetaField`s.** That union is `computeIdfSet`'s and
 * `buildFieldProfileSet`'s — the feed's shared builders — so adding eight
 * members would put eight catalog-wide IDF passes and eight profile builds on a
 * hot path that reads none of them. `staffT1Extractor` refuses the same thing
 * for the same reason; `staffFamilyIdf` below is this module's own pass, paid
 * only by the rankers that read it.
 *
 * Client-safe (no `fs`): the profile page renders the field metadata, the
 * `weights.ts` / `scoring.ts` reason.
 */

import type { AnimeRecord } from '@/models/anime';
import { parseStaffRole, isLocalizationCredit } from '@/lib/domain/staffRole';
import { computeIdf, MATCH_DENOM_FLOOR, type MetaField, type FieldValue } from '@/lib/reco/scoring';

/**
 * The eight craft families. Order is display order: `staffOriginal` last in the
 * staff group, because it is the tightest field in the set (p90 one credit) and
 * reads as inert on most boxes — DESIGN §3.
 */
export const STAFF_FAMILIES = [
  'staffDirector',
  'staffWriting',
  'staffCharaDesign',
  'staffAnimation',
  'staffArt',
  'staffMusic',
  'staffSound',
  'staffOriginal',
] as const;

export type StaffFamily = typeof STAFF_FAMILIES[number];

/**
 * Each family's roles, matched against the parsed BASE (qualifiers peeled).
 *
 * ⚠️ Every boundary below was measured, and the rejected ones are the ones a
 * tidy-minded edit would add back (DESIGN §3, "Rejected family boundaries"):
 *
 *  - **`Key Animation` is NOT in `staffAnimation`.** 31k credits over 7.8k
 *    people, the most common role in the store — including it halves the
 *    family's match signal (median 0.076 → 0.036). It is exactly the mass that
 *    buries a series composer inside `anilistStaff`; re-importing it into the
 *    family named after animation would recreate the problem the split solves.
 *  - **`Storyboard` is NOT in `staffDirector`.** Credited per episode, so it
 *    moves the one clean near-binary field from p90 2 to p90 6.
 *  - **`Episode Director` is in no family.** An episode roster, not a craft.
 *  - **`Theme Song *` is NOT in `staffMusic`.** The band that sang the OP is not
 *    the show's composer: sharing Yoasobi is not sharing Kensuke Ushio.
 *  - **`Chief Animation Director` is in `staffAnimation`, not
 *    `staffCharaDesign`** — folding it into chara design dilutes the one field
 *    whose purpose is to name a single person (statused people 627 → 1,019).
 *  - **`Original Creator` is `staffOriginal`, not `staffWriting`.** It is the
 *    mangaka — a SOURCE credit. Merging the two produces a safe-looking 0.137
 *    match median that is the average of two unsafe ones (0.324 and 0.575), and
 *    conflates "same series composer" with "adapted from the same author".
 *
 * Exported for the profile page (a slider's hint names the roles it covers) and
 * for the suite. ⚠️ The lists must stay DISJOINT: `FAMILY_BY_ROLE` is built by
 * insertion, so a role listed twice silently lands in whichever family comes
 * last — pinned.
 */
export const STAFF_FAMILY_ROLES: Record<StaffFamily, readonly string[]> = {
  staffDirector: ['Director', 'Chief Director', 'Assistant Director', 'Unit Director', 'Series Director'],
  staffWriting: ['Series Composition', 'Script', 'Screenplay', 'Script Composition'],
  staffCharaDesign: ['Character Design', 'Original Character Design'],
  staffAnimation: [
    'Animation Director', 'Chief Animation Director', 'Character Animation Director',
    'Action Animation Director', 'Mechanical Animation Director', 'Effects Animation Director',
    'Assistant Animation Director', 'Animation Supervisor', 'Main Animator',
  ],
  staffArt: ['Art Director', 'Art Design', 'Color Design', 'Director of Photography', 'Concept Art', 'Background Art'],
  staffMusic: ['Music', 'Music Composition', 'Music Arrangement', 'Music Director'],
  staffSound: ['Sound Director', 'Sound Design', 'Sound Effects'],
  staffOriginal: ['Original Creator', 'Original Story', 'Original Plan', 'Original Work'],
};

/** Lower-cased base role → family. Built once; the whitelists are disjoint. */
const FAMILY_BY_ROLE = new Map<string, StaffFamily>(
  STAFF_FAMILIES.flatMap(family => STAFF_FAMILY_ROLES[family].map(role => [role.toLowerCase(), family] as const))
);

/**
 * Raw role string → family, memoized. The store holds ~29k distinct raw role
 * strings over ~300k credits and a family IDF pass touches every credit, so
 * this turns eight parses per credit into one lookup.
 */
const familyMemo = new Map<string, StaffFamily | null>();

/**
 * The craft family a raw AniList role belongs to, or `null` for none.
 *
 * Two rules on top of the whitelist:
 *
 *  - **A localization credit is in no family** (`isLocalizationCredit`, the
 *    rule `staffRoleTier` sends to T4). `Director (English)` is a dub director,
 *    and filing him as the show's director would retrieve dubbing studios'
 *    filmographies on a director slider.
 *  - **An episode qualifier does NOT exclude.** `Director (ep 3)` is how an
 *    anthology credits its directors; the tier demotes it for DISPLAY, which is
 *    a different question from "is this person a director of this show".
 */
export function staffFamilyOf(raw: string): StaffFamily | null {
  const hit = familyMemo.get(raw);
  if (hit !== undefined) return hit;
  const parsed = parseStaffRole(raw);
  const family = isLocalizationCredit(parsed) ? null : FAMILY_BY_ROLE.get(parsed.base.toLowerCase()) ?? null;
  familyMemo.set(raw, family);
  return family;
}

/**
 * One family's staff ids on a title — each person ONCE.
 *
 * Deduped because `fieldMatch` sums over the extracted values and divides by
 * their count: a person credited both `Director` and `Series Director` on one
 * show would otherwise weigh twice in the numerator and inflate the
 * denominator, so the same shared director would match a double-credited title
 * differently from a single-credited one.
 */
function extractFamily(a: AnimeRecord, family: StaffFamily): FieldValue[] {
  const staff = a.sources.anilist?.staff;
  if (!staff) return [];
  const ids = new Set<number>();
  for (const credit of staff) {
    if (staffFamilyOf(credit.role) === family) ids.add(credit.id);
  }
  return [...ids];
}

export const STAFF_FAMILY_EXTRACTORS = Object.fromEntries(
  STAFF_FAMILIES.map(family => [family, (a: AnimeRecord) => extractFamily(a, family)])
) as Record<StaffFamily, (a: AnimeRecord) => FieldValue[]>;

export function isStaffFamily(field: string): field is StaffFamily {
  return (STAFF_FAMILIES as readonly string[]).includes(field);
}

/**
 * Scale normalizers — ⚠️ NOT `MATCH_DENOM_FLOOR`'s evidence floors (DESIGN §4).
 *
 * The family split fixes `anilistStaff`'s ~11× dilution and then overshoots it:
 * a family matches at 0.076-0.575 against tags' 0.169, a factor of 7.6 between
 * the families themselves. On an eleven-slider page, 1.0 on the director slider
 * and 1.0 on the tags slider must contribute comparably or no slider means
 * anything, and that is this table's ONLY job.
 *
 * It reuses `flooredFieldMatch`'s `max(count, floor)`, but on the five
 * near-binary families the "floor" binds on ~97-100% of titles, so it is
 * arithmetically `score /= floor` — a uniform rescale, not a discount on thin
 * evidence. Writing it up as "stops a one-credit title riding to the top" would
 * be false: where 97% of titles have exactly one credit there is no spread to
 * protect against. Reusing the floored form rather than folding the divisor into
 * the default weight keeps the true tail honest (*JAA Meets Yokohama* credits
 * 36 directors and must not match as strongly as a one-director film) and keeps
 * the value the user drags comparable across fields.
 *
 * ⚠️ **The inversion is the thing to preserve.** The two families with NO
 * correction (`staffAnimation`, `staffArt`) are the only two with real
 * within-field spread, and `staffAnimation` is UNDER-scaled at 0.076 rather than
 * over. A table of eight numbers reads like one mechanism applied evenly; it is
 * not. `staffWriting`'s 2 is the one intermediate case — it binds on ~85%, so it
 * is mostly a rescale and partly a floor.
 */
export const PROFILE_DENOM: Record<StaffFamily, number> = {
  staffDirector: 3,
  staffWriting: 2,
  staffCharaDesign: 3,
  staffAnimation: 1,
  staffArt: 1,
  staffMusic: 3,
  staffSound: 4,
  staffOriginal: 3,
};

/** Every field a profile can MATCH on — the metadata fields plus the families. */
export type MatchField = MetaField | StaffFamily;

/**
 * The `flooredFieldMatch` denominator for a field.
 *
 * ⚠️ **One function, so a ranker never guesses between the two tables.** A
 * profile weights staff families (`PROFILE_DENOM`, a rescale) AND tags / genre
 * / studio (`MATCH_DENOM_FLOOR`, an evidence floor), and the two rankers that
 * read a profile would otherwise each carry their own branch. Routed backwards
 * it divides tags by 3 and directors by 10: every slider still moves and every
 * number is wrong, which is why it is pinned.
 */
export function denomFor(field: MatchField): number {
  return isStaffFamily(field) ? PROFILE_DENOM[field] : MATCH_DENOM_FLOOR[field];
}

/**
 * Per-family IDF over the corpus: `log(N / (1 + df))`, `computeIdf`'s formula.
 *
 * ⚠️ **Family-scoped, overturning `staffT1Extractor`'s reuse of the shared
 * `idf.anilistStaff` — and measured, not assumed** (DESIGN §5). "How rare is
 * this person as a DIRECTOR" is a different question from "how rare as a
 * credit-holder": a prolific person accrues credits in roles that are not the
 * one being asked about. 71% of the director family's people diverge from the
 * shared IDF by more than 0.25 nats (Shinichirou Watanabe 7.36 as director vs
 * 6.64 overall). That argument does not reach `staffT1Extractor`, whose T1 set
 * spans six unrelated crafts and so has no single role to be rare in — it keeps
 * the shared map.
 */
export type StaffFamilyIdf = Record<StaffFamily, Map<FieldValue, number>>;

export function computeStaffFamilyIdf(all: AnimeRecord[]): StaffFamilyIdf {
  return Object.fromEntries(
    STAFF_FAMILIES.map(family => [family, computeIdf(all, STAFF_FAMILY_EXTRACTORS[family])])
  ) as StaffFamilyIdf;
}

/**
 * `computeStaffFamilyIdf`, memoized on the row array's IDENTITY — the WeakMap
 * trick `byCredits`, `getFranchiseIndex` and `boxes.ts`' `idfFor` use. The store
 * hands out the same array until a slice's mtime moves, so this is paid once
 * per data change and self-invalidates.
 */
const familyIdfCache = new WeakMap<AnimeRecord[], StaffFamilyIdf>();

export function staffFamilyIdf(all: AnimeRecord[]): StaffFamilyIdf {
  let idf = familyIdfCache.get(all);
  if (!idf) {
    idf = computeStaffFamilyIdf(all);
    familyIdfCache.set(all, idf);
  }
  return idf;
}
