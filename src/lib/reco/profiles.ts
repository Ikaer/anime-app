/**
 * Reco profiles — the durable store for `user/reco_profiles.json`
 * (docs/recoProfiles/DESIGN.md §6).
 *
 * A profile is a named, hand-tuned weighting — « Absolute cinema » leaning on
 * the director, « Puni pour l'animation » on the animation directors — that a
 * box points at through `Box.profileId`. The shape, the sanitizer and the
 * resolver are the client-safe `reco/profileWeights.ts`; this is the file half.
 *
 * **Why it lives in `reco/` rather than `store/`**, `boxes.ts`' and
 * `groups.ts`' reason: durable `user/` data deliberately NOT joined into
 * `AnimeRecord`. A write here cannot change an assembled row, so it must not
 * invalidate the row cache.
 *
 * ⚠️ **Durable user data.** No provider can re-supply a hand-tuned weighting.
 * It is in CLAUDE.md's "costs that are real" list, not the reprocess-freely one.
 *
 * ⚠️ **Readable from the MCP surface, never writable** — every writer here is
 * blocked by name in `eslint.config.mjs`. A profile silently changes every
 * ranking that follows, so a model able to set one would be tuning the answer
 * it is about to give (DESIGN §9).
 *
 * Server-only (uses `fs` via `jsonStore`), and listed as such in the eslint
 * client-safety block.
 */

import type { Box } from '@/models/anime';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { getBoxes } from '@/lib/reco/boxes';
import { sanitizeProfileWeights, mintProfileId, type RecoProfile } from '@/lib/reco/profileWeights';

const PROFILES_FILE = dataFile('user/reco_profiles.json');

/** A bare array, beside `boxes.json` / `groups.json` / `seed_mutes.json`. */
export function getProfiles(): RecoProfile[] {
  return readJsonFile<RecoProfile[]>(PROFILES_FILE, []);
}

export function getProfile(id: string): RecoProfile | undefined {
  return getProfiles().find(p => p.id === id);
}

/**
 * The profile a box ranks with, or `undefined` — which includes a `profileId`
 * that no longer resolves. That id is inert by design (see `deleteProfile`).
 */
export function getBoxProfile(box: Box, profiles: RecoProfile[] = getProfiles()): RecoProfile | undefined {
  return box.profileId ? profiles.find(p => p.id === box.profileId) : undefined;
}

/** Every box pointing at this profile — the delete confirmation's content. */
export function boxesUsingProfile(id: string, boxes: Box[] = getBoxes()): Box[] {
  return boxes.filter(b => b.profileId === id);
}

export function createProfile(
  name: string,
  opts: { emoji?: string; description?: string; weights?: unknown } = {}
): RecoProfile {
  const profiles = getProfiles();
  const emoji = opts.emoji?.trim();
  const desc = opts.description?.trim();
  const profile: RecoProfile = {
    // Reserves the dead ids boxes still name — see `mintProfileId`.
    id: mintProfileId(name, profiles, getBoxes()),
    name: name.trim() || 'Sans nom',
    // Absent rather than empty, `Box`'s convention.
    ...(emoji ? { emoji } : {}),
    ...(desc ? { description: desc } : {}),
    weights: sanitizeProfileWeights(opts.weights),
    createdAt: new Date().toISOString(),
  };
  profiles.push(profile);
  writeJsonFile(PROFILES_FILE, profiles);
  return profile;
}

/**
 * Rename / re-emoji / re-describe / re-weight. The id never moves.
 *
 * `weights` REPLACES the whole sparse map: the page holds the complete set and
 * a slider reset is a key deletion, which an incremental merge could not
 * express. `boxes.ts`' incremental-write race argument does not transfer — it
 * exists because many chips fire against many boxes at once, while a profile is
 * edited from one page, one slider release at a time.
 */
export function updateProfile(
  id: string,
  patch: { name?: string; emoji?: string | null; description?: string | null; weights?: unknown }
): RecoProfile | undefined {
  const profiles = getProfiles();
  const profile = profiles.find(p => p.id === id);
  if (!profile) return undefined;
  if (patch.name !== undefined) profile.name = patch.name.trim() || profile.name;
  if (patch.emoji !== undefined) {
    const emoji = patch.emoji?.trim();
    if (emoji) profile.emoji = emoji;
    else delete profile.emoji;
  }
  if (patch.description !== undefined) {
    const desc = patch.description?.trim();
    if (desc) profile.description = desc;
    else delete profile.description;
  }
  if (patch.weights !== undefined) profile.weights = sanitizeProfileWeights(patch.weights);
  writeJsonFile(PROFILES_FILE, profiles);
  return profile;
}

/**
 * Drop a profile.
 *
 * ⚠️ **Does NOT sweep `Box.profileId`**, `deleteGroup`'s reason: a dangling id
 * is inert by construction (`getBoxProfile` reads it as "no profile"), and
 * `user/boxes.json` is the one file here no provider can re-supply, so the
 * fewer things that rewrite it wholesale the better. The re-binding hazard a
 * dangling id would otherwise carry is closed at the mint (`mintProfileId`).
 *
 * The confirmation naming the boxes that point at it is the ROUTE's job
 * (`boxesUsingProfile`) — this stays a dumb delete, like `deleteBox`.
 */
export function deleteProfile(id: string): boolean {
  const profiles = getProfiles();
  const next = profiles.filter(p => p.id !== id);
  if (next.length === profiles.length) return false;
  writeJsonFile(PROFILES_FILE, next);
  return true;
}
