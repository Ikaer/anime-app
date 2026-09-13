/**
 * Reco profiles — a named, hand-tuned weighting a box can point at
 * (docs/recoProfiles/DESIGN.md §6, §8).
 *
 * This is the PURE half: the shape, the sanitizer and the resolver that turns
 * a stored profile into the weights a ranker actually runs with. The store is
 * `reco/profiles.ts` (`fs`); this module is client-safe because the profile
 * page renders what every slider resolves to — the `weights.ts` reason.
 *
 * **A profile serves two rankers with different vocabularies**, which is why
 * its key is the wide union `RecoSource | StaffFamily`:
 *
 *  - `rankBoxCandidates` (the fill loop, `BOX_WEIGHTS`) reads metadata only;
 *  - `computeAnchored` (the box's recos tab, `ANCHORED_WEIGHTS`) additionally
 *    reads `crowd`, `anilistCrowd`, `rejection`, `popularity`.
 *
 * `MetaField ⊂ RecoSource`, so the union is a strict superset of both and each
 * ranker resolves the subset it understands over its OWN base. Picking either
 * narrow vocabulary would force a translation layer on the other.
 */

import type { Box, RecoSource } from '@/models/anime';
import { STAFF_FAMILIES, isStaffFamily, type StaffFamily } from '@/lib/reco/staffFields';
import { SOURCE_META } from '@/lib/reco/weights';
import { mintSlugId } from '@/lib/domain/slug';

export type ProfileField = RecoSource | StaffFamily;

/**
 * A profile's weights — SPARSE, and sparse by INTENT: a key is present because
 * the owner moved that slider, and absent means "this surface's shipped default".
 *
 * ⚠️ Deliberately NOT sparse-by-equality the way `sparseViewDefaults` is. There
 * are two bases (`BOX_WEIGHTS.genre` is 0.25, `ANCHORED_WEIGHTS.genre` 0.2), so
 * dropping a value because it equals one base would silently change what the
 * other surface ranks with. "Reset this slider" deletes the key instead.
 */
export type ProfileWeights = Partial<Record<ProfileField, number>>;

export interface RecoProfile {
  /** Slug minted from the name and deduped — `Box`'s mint. */
  id: string;
  name: string;
  emoji?: string;
  /** What axis this weighting is FOR, in the owner's words. Nothing ranks on it. */
  description?: string;
  weights: ProfileWeights;
  /** ISO 8601. */
  createdAt: string;
}

/** Just enough of a box to name it — the delete confirmation and the list both say WHICH. */
export interface ProfileBoxRef {
  id: string;
  name: string;
  emoji?: string;
}

/** A profile as the routes ship it: with the boxes pointing at it. */
export interface ProfileSummary extends RecoProfile {
  usedBy: ProfileBoxRef[];
}

/**
 * Here rather than in `api/anime/profiles`, because both profile routes need it
 * and nothing in this repo imports a value out of another API route —
 * `domain/leanRow.ts`' reason.
 */
export const profileBoxRef = (b: Box): ProfileBoxRef =>
  ({ id: b.id, name: b.name, ...(b.emoji ? { emoji: b.emoji } : {}) });

/**
 * The id a new profile gets: a slug of its name, deduped.
 *
 * ⚠️ **Dead ids are taken too.** A deleted profile leaves every box's
 * `profileId` in place, inert (`deleteProfile` does not sweep `boxes.json`).
 * `mintSlugId` alone would hand that freed slug to the next profile of the same
 * name, silently re-binding those boxes to a weighting nobody attached. So
 * every id a box still names is reserved. Pure, so the rule is pinned without a
 * store on disk.
 *
 * ⚠️ **So are the ids a static route under `api/anime/profiles/` owns.** Next
 * resolves a static route before a dynamic one, so a profile minted `preview` —
 * from a profile named « Preview » — would be unreachable through
 * `profiles/[id]`: every GET, PATCH and DELETE would land on the preview route
 * and answer 405. Nothing would error at creation.
 */
export const RESERVED_PROFILE_IDS: readonly string[] = ['preview'];

export function mintProfileId(name: string, profiles: { id: string }[], boxes: Pick<Box, 'profileId'>[]): string {
  const taken = new Set([
    ...RESERVED_PROFILE_IDS,
    ...profiles.map(p => p.id),
    ...boxes.map(b => b.profileId).filter((id): id is string => !!id),
  ]);
  return mintSlugId(name, taken, 'profil');
}

/**
 * Bounds per field. Families are 0-1 — they only ever add, and `PROFILE_DENOM`
 * already put them on tags' scale, which is the precondition for one shared
 * range meaning anything (DESIGN §4, "Rejected: per-field slider ranges"). The
 * `RecoSource` fields keep the bounds the feed's sliders already use, so a
 * profile cannot store a value no other surface could express.
 */
export function profileFieldBounds(field: ProfileField): { min: number; max: number } {
  if (isStaffFamily(field)) return { min: 0, max: 1 };
  const meta = SOURCE_META.find(m => m.source === field);
  return meta ? { min: meta.min, max: meta.max } : { min: 0, max: 1 };
}

const KNOWN_FIELDS = new Set<string>([...SOURCE_META.map(m => m.source), ...STAFF_FAMILIES]);

export function isProfileField(key: string): key is ProfileField {
  return KNOWN_FIELDS.has(key);
}

/**
 * What a stored profile may hold: known fields, finite numbers, clamped to the
 * field's bounds. Unknown keys are DROPPED rather than rejected — a field
 * retired from the vocabulary must not make an old profile unreadable.
 */
export function sanitizeProfileWeights(raw: unknown): ProfileWeights {
  const out: ProfileWeights = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isProfileField(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const { min, max } = profileFieldBounds(key);
    out[key] = Math.min(max, Math.max(min, value));
  }
  return out;
}

/** A ranker's view of a profile: its own base, overridden, plus the families. */
export interface ResolvedProfile<K extends string> {
  weights: Record<K, number>;
  families: Record<StaffFamily, number>;
  /**
   * True when `anilistStaff` was forced to 0 because a family is on. Surfaced
   * so the page can SAY so — a knob that moves on its own must announce it.
   */
  staffZeroed: boolean;
}

export const NO_FAMILIES: Readonly<Record<StaffFamily, number>> = Object.freeze(
  Object.fromEntries(STAFF_FAMILIES.map(f => [f, 0])) as Record<StaffFamily, number>
);

/**
 * Resolve a profile over one ranker's base.
 *
 * Only keys the base carries are overridden — that is how each ranker takes the
 * subset of the union it understands and ignores the rest.
 *
 * ⚠️ **`anilistStaff` is forced to 0 whenever any family is non-zero** (DESIGN
 * §6). The families are SUBSETS of `anilistStaff`'s top-50 list, so leaving it
 * on counts a shared director twice, at scales ~18× apart (0.020 raw against
 * 0.358, re-measured 2026-09-13). `RECO_WEIGHT_PRESETS` documents the same trap
 * in prose ("explicit zeros are required"); here it is made unrepresentable —
 * including when a profile explicitly sets both, because a double count at an
 * 18× scale gap produces a plausible ranking and no error.
 */
export function resolveProfile<K extends string>(
  base: Record<K, number>,
  profile: ProfileWeights | undefined
): ResolvedProfile<K> {
  const weights = { ...base };
  const families: Record<StaffFamily, number> = { ...NO_FAMILIES };
  if (!profile) return { weights, families, staffZeroed: false };

  for (const key of Object.keys(base) as K[]) {
    const value = (profile as Record<string, number | undefined>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) weights[key] = value;
  }
  for (const family of STAFF_FAMILIES) {
    const value = profile[family];
    if (typeof value === 'number' && Number.isFinite(value)) families[family] = value;
  }

  const anyFamily = STAFF_FAMILIES.some(f => families[f] !== 0);
  const staffKey = 'anilistStaff' as K;
  const staffZeroed = anyFamily && staffKey in weights && weights[staffKey] !== 0;
  if (anyFamily && staffKey in weights) weights[staffKey] = 0;
  return { weights, families, staffZeroed };
}

/**
 * A profile resolved over a base, with a surface's own URL overrides ON TOP —
 * the precedence `/api/anime/recommendations/mix?box=` ranks with.
 *
 * Base < profile < URL, and the two edges of that ordering are each a silent
 * failure if got wrong:
 *
 *  - **URL over profile.** `encodeSourceWeights` drops a value equal to the base
 *    it is handed, so the client must encode against the PROFILE-resolved
 *    weights (the route returns them), and the server must let whatever the URL
 *    does carry win. Resolved the other way, a slider dragged to exactly the
 *    anchored default falls out of the URL and the profile silently re-applies —
 *    the control snaps back.
 *  - ⚠️ **The `anilistStaff` zeroing still holds AFTER the URL.** `w` accepts
 *    `anilistStaff` (it is a `RecoSource`), so merging the URL onto an already
 *    resolved profile would let a hand-typed `?w=anilistStaff:1` reinstate the
 *    ~18× double count `resolveProfile` exists to make unrepresentable. So the
 *    URL is merged INTO the profile first and the whole thing resolved once.
 *
 * Families never come from the URL — `parseSourceWeights` only knows
 * `RecoSource` keys — so the profile is their only source.
 */
export function resolveProfileOver<K extends string>(
  base: Record<K, number>,
  profile: ProfileWeights | undefined,
  overrides: Partial<Record<K, number>>
): ResolvedProfile<K> {
  return resolveProfile(base, { ...profile, ...overrides } as ProfileWeights);
}

/** A shipped starting point — sparse, merged like `RECO_WEIGHT_PRESETS`. */
export interface ProfilePreset {
  /** i18n: `profiles.preset.<key>` / `profiles.presetHint.<key>`. */
  key: 'realisation' | 'animation' | 'charaDesign' | 'adaptation' | 'defaut';
  weights: ProfileWeights;
}

/**
 * The four starting points DESIGN §8 maps onto what the owner asked for, plus
 * `defaut` — the shipped weighting, unchanged.
 *
 * Each names its lead family at 1.0, which after `PROFILE_DENOM` means "counts
 * as much as the tags" (tags sit at 1.0 in `BOX_WEIGHTS`), and a supporting
 * field at roughly half. These are starting points for a slider, not measured
 * optima — there is no ground truth for "the right chara-design weight", and
 * `backtest-reco.js` cannot referee a box (DESIGN §11).
 *
 * ⚠️ Every preset that turns a family on states `anilistStaff: 0` explicitly,
 * even though `resolveProfile` would force it anyway: a preset is also read as
 * documentation of what it does, and `RECO_WEIGHT_PRESETS`' "explicit zeros are
 * required" is the house rule. Pinned.
 */
export const PROFILE_PRESETS: ProfilePreset[] = [
  { key: 'realisation', weights: { staffDirector: 1, staffWriting: 0.5, anilistStaff: 0 } },
  { key: 'animation', weights: { staffAnimation: 1, staffArt: 0.5, studio: 0.3, anilistStaff: 0 } },
  { key: 'charaDesign', weights: { staffCharaDesign: 1, staffAnimation: 0.5, anilistStaff: 0 } },
  { key: 'adaptation', weights: { staffOriginal: 1, staffWriting: 0.5, anilistStaff: 0 } },
  { key: 'defaut', weights: {} },
];
