/**
 * The row join: seven slices in, `AnimeRecord[]` out.
 *
 * This is the only place the slices are read *together*. Everything upstream of
 * it (`slices.ts`, `registry.ts`) deals with one file at a time; everything
 * downstream — filtering, the reco engine, every page — deals in assembled
 * records. Hydration itself (precedence merge, provenance) lives in
 * `domain/animeUtils.ts`; this module supplies the inputs and caches the output.
 *
 * Server-only (uses `fs` via the slice readers). Client components must
 * `import type` from here, never import values.
 */

import { MALAnime, AnimeRecord, SimklPersonalEntry, AniListMetaEntry, AniListPersonalEntry, LocalPersonalEntry, SourceIds, ProvenanceSource, MALPersonalEntry } from '@/models/anime';
import { computeDiscrepancy } from '@/lib/providers/discrepancy';
import { buildProviderStates } from '@/lib/providers/personalState';
import { toAnimeRecord } from '@/lib/domain/animeUtils';
import { getResolvedPersonalPrecedence } from '@/lib/providers/registry';
import { getRegistry, resolveByMalId, toNum } from '@/lib/store/registry';
import { getCachedRows, setCachedRows } from '@/lib/store/recordCache';
import {
  getAllAnime,
  getAllAnilistMeta,
  getAllAnilistPersonalEntries,
  getAllLocalEntries,
  getAllMalPersonal,
  getAllSimklEntries,
  getHiddenAnimeIds,
} from '@/lib/store/slices';

/**
 * Assemble the unified cross-source crosswalk from every pipe. The MAL id is
 * the anchor (and current join key); SIMKL contributes its rich `ids` block;
 * AniList contributes its own `idMal`-resolved id (authoritative over SIMKL's
 * `anilist` field, which occasionally mirrors the MAL id). Returns undefined
 * when only the MAL self-id is known (nothing worth carrying yet).
 */
function assembleCrosswalk(
  malId: number,
  simkl?: SimklPersonalEntry,
  anilistMeta?: AniListMetaEntry
): SourceIds | undefined {
  if (!simkl?.ids && !simkl?.simkl_id && !anilistMeta) return undefined;
  const crosswalk: SourceIds = { ...(simkl?.ids || {}), mal: malId };
  if (simkl?.simkl_id) crosswalk.simkl = simkl.simkl_id;
  if (anilistMeta?.anilist_id) crosswalk.anilist = anilistMeta.anilist_id;
  return crosswalk;
}

/**
 * Assemble one `AnimeRecord` row for a canonical id from the already-read
 * slices. Shared by `getAnimeForDisplay` (loops every canonical id) and
 * `getAnimeByCanonicalId` (looks up one, bypassing the cache). Returns
 * undefined when no MAL id is resolvable anywhere (a true AniList-only title
 * with no `idMal`, which is out of scope for the row set).
 */
function assembleDisplayRow(
  canonicalId: string,
  malAnime: Record<string, MALAnime>,
  malPersonalByCanonical: Record<string, MALPersonalEntry>,
  simklByCanonical: Record<string, SimklPersonalEntry>,
  anilistMetaByCanonical: Record<string, AniListMetaEntry>,
  anilistPersonalByCanonical: Record<string, AniListPersonalEntry>,
  localByCanonical: Record<string, LocalPersonalEntry>,
  registry: Record<string, SourceIds>,
  hiddenIds: Set<string>,
  personalPrecedence: ProvenanceSource[]
): AnimeRecord | undefined {
  const mal = malAnime[canonicalId];
  const malPersonal = malPersonalByCanonical[canonicalId];
  const simkl = simklByCanonical[canonicalId];
  const anilistMeta = anilistMetaByCanonical[canonicalId];
  const anilistPersonal = anilistPersonalByCanonical[canonicalId];
  const local = localByCanonical[canonicalId];
  const crosswalk = registry[canonicalId] ?? (mal ? assembleCrosswalk(mal.id, simkl, anilistMeta) : undefined);
  // Outward MAL id (for MAL API calls / the external MAL link): the raw MAL
  // slice's id, falling back to the registry crosswalk's `mal` (populated from
  // AniList's `idMal` for a crawled title with no local MAL slice yet).
  const malId = mal?.id ?? toNum(crosswalk?.mal);
  if (malId === undefined) return undefined;
  const hidden = hiddenIds.has(canonicalId);
  const discrepancy = computeDiscrepancy(
    buildProviderStates({ mal, malPersonal, simkl, anilist: anilistPersonal, local, anilistMeta }, personalPrecedence)
  );
  return toAnimeRecord(
    { mal, malPersonal, simkl, anilistMeta, anilistPersonal, local, hidden, discrepancy, crosswalk: crosswalk ?? { mal: malId } },
    canonicalId,
    undefined,
    personalPrecedence
  );
}

export function getAnimeForDisplay(): AnimeRecord[] {
  // Every slice is keyed by canonical id (the migration + resolve-at-write
  // invariant guarantee it). The row set is the UNION of every slice's keys —
  // not just the MAL slice — so an AniList-only canonical id (no MAL slice,
  // seeded by the AniList catalog crawler) still produces a row, with
  // `sources.mal` left undefined.
  const malAnime = getAllAnime();
  const malPersonalByCanonical = getAllMalPersonal();
  const hiddenIdList = getHiddenAnimeIds();
  const simklByCanonical = getAllSimklEntries();
  const anilistMetaByCanonical = getAllAnilistMeta();
  const anilistPersonalByCanonical = getAllAnilistPersonalEntries();
  const localByCanonical = getAllLocalEntries();
  const registry = getRegistry();
  // Resolved once per call and folded into the cache key as a stable string, so
  // flipping a settings toggle — or a MAL/SIMKL token appearing or lapsing —
  // rebuilds the rows even though no *slice file* changed.
  const personalPrecedence = getResolvedPersonalPrecedence();

  // The assembled rows are cached against the IDENTITY of the parsed slices
  // (jsonStore's parse cache returns the same object until the file on disk
  // changes), so a rebuild happens exactly when some slice actually changed —
  // no TTL. This also closes the old cross-bundle staleness hole: an API-route
  // write bumps the file's mtime, the page bundle's next read re-parses, the
  // slice reference changes, and the page bundle's row cache rebuilds. The
  // precedence join is a value-compared string (see 1d.3), so a mode/token
  // change invalidates too.
  const inputs = [malAnime, malPersonalByCanonical, hiddenIdList, simklByCanonical, anilistMetaByCanonical, anilistPersonalByCanonical, localByCanonical, registry, personalPrecedence.join('|')];
  const cached = getCachedRows(inputs);
  if (cached) return cached;

  const hiddenIds = new Set(hiddenIdList);

  const canonicalIds = new Set<string>([
    ...Object.keys(registry),
    ...Object.keys(malAnime),
    ...Object.keys(malPersonalByCanonical),
    ...Object.keys(simklByCanonical),
    ...Object.keys(anilistMetaByCanonical),
    ...Object.keys(anilistPersonalByCanonical),
    ...Object.keys(localByCanonical),
  ]);

  const rows: AnimeRecord[] = [];
  for (const canonicalId of canonicalIds) {
    const row = assembleDisplayRow(
      canonicalId, malAnime, malPersonalByCanonical, simklByCanonical, anilistMetaByCanonical, anilistPersonalByCanonical, localByCanonical, registry, hiddenIds, personalPrecedence
    );
    if (row) rows.push(row);
  }
  setCachedRows(rows, inputs);
  return rows;
}

/**
 * Assemble ONE anime record from the source files, bypassing the
 * `getAnimeForDisplay` row cache.
 *
 * Historically this existed because the detail page (page bundle) couldn't see
 * an API-route write invalidating the other bundle's row cache. That hole
 * is closed now — both the parse cache and the row cache invalidate off file
 * mtime — but the direct read is kept: it's cheap (six stat calls + one row
 * assembly against cached parses) and stays trivially immune by construction.
 *
 * `canonicalId` is the outward id, so the route param IS the slice key and no
 * resolve step is needed.
 */
export function getAnimeByCanonicalId(canonicalId: string): AnimeRecord | undefined {
  return assembleDisplayRow(
    canonicalId,
    getAllAnime(),
    getAllMalPersonal(),
    getAllSimklEntries(),
    getAllAnilistMeta(),
    getAllAnilistPersonalEntries(),
    getAllLocalEntries(),
    getRegistry(),
    new Set(getHiddenAnimeIds()),
    getResolvedPersonalPrecedence()
  );
}

/**
 * MAL-id-keyed lookup, cache-bypassing like `getAnimeByCanonicalId` above.
 * Kept for the few remaining genuinely-MAL-id-keyed flows (`/rate?id=`) — new
 * call sites should prefer `getAnimeByCanonicalId`.
 */
export function getAnimeByIdForDisplay(malId: number): AnimeRecord | undefined {
  const canonicalId = resolveByMalId(malId);
  return canonicalId ? getAnimeByCanonicalId(canonicalId) : undefined;
}
