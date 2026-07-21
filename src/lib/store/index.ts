/**
 * The local record store — the authority.
 *
 * MAL, SIMKL and AniList are interchangeable, absent-tolerant refill pipes;
 * what they refill is the merged local record assembled here. Nothing under this
 * folder talks to a remote API: it reads and writes the JSON files under
 * `DATA_PATH` and joins them into `AnimeRecord`.
 *
 * This file is a barrel, kept because ~25 modules import `@/lib/store` and the
 * split below is an internal concern. Three modules, bottom-up:
 *
 *   registry.ts   the identity spine — mint-or-resolve canonical ids
 *   slices.ts     one read/write block per JSON file, ids resolved on the way in
 *   record.ts     the join: seven slices → `AnimeRecord[]`, plus the row cache
 *
 * (`recordCache.ts` holds the row cache's two variables so `slices.ts` can
 * invalidate it without importing `record.ts`, which imports every slice reader.
 * `jsonStore.ts` is the raw file I/O below all of it.)
 *
 * Naming: functions here are about the *local record*, so they carry no source
 * prefix. A `MAL`/`Simkl`/`Anilist` prefix means the function is genuinely
 * about that one source's slice of the data.
 *
 * Server-only (uses `fs` via `jsonStore`). Client components must
 * `import type` from here, never import values.
 */

export {
  isCanonicalId,
  getRegistry,
  resolveByMalId,
  resolveCanonicalId,
  resolveCanonicalIds,
  toNum,
} from '@/lib/store/registry';

export {
  getHiddenAnimeIds,
  addHiddenAnimeId,
  removeHiddenAnimeId,
  getAllAnime,
  saveAnime,
  upsertAnime,
  getMalIdForCanonical,
  getAllMalPersonal,
  upsertMalPersonal,
  removeMalPersonal,
  getAllSimklEntries,
  upsertSimklEntries,
  removeSimklEntries,
  getAllAnilistMeta,
  getAnilistMetaCount,
  upsertAnilistMeta,
  upsertAnilistCatalogFields,
  getAllAnilistCast,
  getAnilistCastCount,
  getAnilistCast,
  upsertAnilistCast,
  getAllAnilistPersonalEntries,
  getAnilistPersonalCount,
  replaceAnilistPersonalEntries,
  upsertAnilistPersonalEntries,
  getAllLocalEntries,
  upsertLocalEntries,
  removeLocalEntries,
  getSyncMetadata,
  updatePersonalStatusBatch,
} from '@/lib/store/slices';

export {
  getAnimeForDisplay,
  getAnimeByCanonicalId,
  getAnimeByIdForDisplay,
} from '@/lib/store/record';
