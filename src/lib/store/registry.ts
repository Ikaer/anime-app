/**
 * The identity spine: `registry.json`, a `Record<canonicalId, SourceIds>`.
 *
 * Every slice file under `DATA_PATH` is keyed by a canonical id (`a_<n>`) minted
 * or resolved here, and the canonical id is also the OUTWARD id (URLs, API route
 * params, hidden/feedback keys). Each provider's own id survives only in the
 * crosswalk, for API calls and links out.
 *
 * The app's central identity invariant lives in this file and nowhere else:
 * **resolve before mint**. A title the registry already anchors under ANY
 * provider id is never re-minted, so durable user data keyed by canonical id
 * cannot silently reattach to the wrong title on a rebuild.
 *
 * Deliberately depends on nothing but `jsonStore` — it is the bottom of the
 * store's dependency graph, so `slices.ts` can resolve ids at write time without
 * a cycle. (`getMalIdForCanonical`, the crosswalk read that consults the MAL
 * catalog slice first, therefore lives in `slices.ts` rather than here.)
 *
 * Server-only (uses `fs` via `jsonStore`).
 */

import { SourceIds } from '@/models/anime';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';

const ANIME_REGISTRY_FILE = dataFile('registry.json');

/** Shape check for the outward canonical id (`a_<n>`) — cheap validation for route params. */
export function isCanonicalId(id: string): boolean {
  return /^a_\d+$/.test(id);
}

export function getRegistry(): Record<string, SourceIds> {
  return readJsonFile<Record<string, SourceIds>>(ANIME_REGISTRY_FILE, {});
}

function saveRegistry(registry: Record<string, SourceIds>): void {
  writeJsonFile(ANIME_REGISTRY_FILE, registry);
}

function buildMalIndex(registry: Record<string, SourceIds>): Map<number, string> {
  const index = new Map<number, string>();
  for (const [canonicalId, ids] of Object.entries(registry)) {
    const mal = typeof ids.mal === 'string' ? parseInt(ids.mal, 10) : ids.mal;
    if (typeof mal === 'number' && !Number.isNaN(mal) && !index.has(mal)) {
      index.set(mal, canonicalId);
    }
  }
  return index;
}

/** Resolves the canonical id already anchored to a MAL id. Read-only — never mints. */
export function resolveByMalId(malId: number): string | undefined {
  return buildMalIndex(getRegistry()).get(malId);
}

/** Same as `buildMalIndex`, keyed by the `anilist` crosswalk field instead. */
function buildAnilistIndex(registry: Record<string, SourceIds>): Map<number, string> {
  const index = new Map<number, string>();
  for (const [canonicalId, ids] of Object.entries(registry)) {
    const anilist = typeof ids.anilist === 'string' ? parseInt(ids.anilist, 10) : ids.anilist;
    if (typeof anilist === 'number' && !Number.isNaN(anilist) && !index.has(anilist)) {
      index.set(anilist, canonicalId);
    }
  }
  return index;
}

/** Same as `buildMalIndex`, keyed by the `simkl` crosswalk field instead. */
function buildSimklIndex(registry: Record<string, SourceIds>): Map<number, string> {
  const index = new Map<number, string>();
  for (const [canonicalId, ids] of Object.entries(registry)) {
    const simkl = typeof ids.simkl === 'string' ? parseInt(ids.simkl, 10) : ids.simkl;
    if (typeof simkl === 'number' && !Number.isNaN(simkl) && !index.has(simkl)) {
      index.set(simkl, canonicalId);
    }
  }
  return index;
}

/** Highest `a_<n>` counter currently minted, so a fresh mint never collides. */
function maxCounter(registry: Record<string, SourceIds>): number {
  let counter = 0;
  for (const id of Object.keys(registry)) {
    const m = /^a_(\d+)$/.exec(id);
    if (m) counter = Math.max(counter, parseInt(m[1], 10));
  }
  return counter;
}

/** Coerce a crosswalk id value (which may be a string from SIMKL) to a number, or undefined. */
export function toNum(v: number | string | undefined): number | undefined {
  if (typeof v === 'number') return Number.isNaN(v) ? undefined : v;
  if (typeof v === 'string') {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}

/**
 * The identity resolver. Mint-or-resolve a canonical id for a batch of
 * provider-id crosswalks:
 *
 *   1. look up the registry by mal → anilist → simkl (first hit wins)
 *   2. found   → merge any new provider ids into that entry's crosswalk
 *   3. missing → MINT a new canonical id, seed its crosswalk
 *
 * Resolve-before-mint is mandatory: a title the registry already anchors under
 * ANY provider id is never re-minted, so durable user data keyed by canonical id
 * (feedback/hidden) can't silently reattach to the wrong title on a rebuild.
 * Returns the resolved canonical ids parallel to the input, plus mint/resolve
 * counts for the caller to log. One registry read + at most one write.
 */
export function resolveCanonicalIds(
  crosswalks: SourceIds[]
): { ids: string[]; minted: number; resolved: number } {
  const registry = getRegistry();
  const malIndex = buildMalIndex(registry);
  const anilistIndex = buildAnilistIndex(registry);
  const simklIndex = buildSimklIndex(registry);
  let counter = maxCounter(registry);
  let changed = false;
  let minted = 0;
  let resolved = 0;
  const ids: string[] = [];

  for (const crosswalk of crosswalks) {
    const malId = toNum(crosswalk.mal);
    const anilistId = toNum(crosswalk.anilist);
    const simklId = toNum(crosswalk.simkl);

    let canonicalId =
      (malId !== undefined ? malIndex.get(malId) : undefined) ??
      (anilistId !== undefined ? anilistIndex.get(anilistId) : undefined) ??
      (simklId !== undefined ? simklIndex.get(simklId) : undefined);

    if (!canonicalId) {
      counter += 1;
      canonicalId = `a_${counter}`;
      registry[canonicalId] = {};
      minted++;
      changed = true;
    } else {
      resolved++;
    }

    const entry = registry[canonicalId];
    for (const [key, value] of Object.entries(crosswalk)) {
      if (value === undefined || entry[key] === value) continue;
      entry[key] = value;
      changed = true;
    }
    // Keep the in-memory indices consistent so a later crosswalk in the same
    // batch resolves against ids just minted/merged in this pass.
    if (malId !== undefined && !malIndex.has(malId)) malIndex.set(malId, canonicalId);
    if (anilistId !== undefined && !anilistIndex.has(anilistId)) anilistIndex.set(anilistId, canonicalId);
    if (simklId !== undefined && !simklIndex.has(simklId)) simklIndex.set(simklId, canonicalId);
    ids.push(canonicalId);
  }

  if (changed) saveRegistry(registry);
  return { ids, minted, resolved };
}

/** Single-crosswalk convenience over `resolveCanonicalIds`. */
export function resolveCanonicalId(crosswalk: SourceIds): string {
  return resolveCanonicalIds([crosswalk]).ids[0];
}
