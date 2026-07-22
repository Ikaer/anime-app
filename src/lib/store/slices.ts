/**
 * The slice files: one read/write block per JSON file under `DATA_PATH`.
 *
 * Nothing here joins anything — a slice function reads or writes exactly one
 * file, resolving provider ids to canonical ids through `registry.ts` on the way
 * in. The join that turns these seven slices into an `AnimeRecord` is
 * `record.ts`; the two are separate because almost every caller in the app wants
 * one or the other, never both.
 *
 * Naming: functions here are about the *local record*, so they carry no source
 * prefix unless they genuinely concern one source's slice — hence `getAllAnime`
 * (the record's catalog) but `getAllSimklEntries` (SIMKL's slice).
 *
 * Every write clears the assembled-row cache (`recordCache.ts`), with one
 * documented exception: the cast slice, which no row reads.
 *
 * Server-only (uses `fs` via `jsonStore`). Client components must
 * `import type` from here, never import values.
 */

import { MALAnime, SyncMetadata, SimklPersonalEntry, AniListMetaEntry, AniListCastEntry, AniListPersonalEntry, LocalPersonalEntry, MALListStatus, MALPersonalEntry } from '@/models/anime';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/store/jsonStore';
import { getRegistry, resolveByMalId, resolveCanonicalIds, toNum } from '@/lib/store/registry';
import { invalidateRecordCache } from '@/lib/store/recordCache';
import { getSeasonInfos } from '@/lib/domain/animeUtils';

// Role folders, not filename prefixes (docs/DATA-LAYOUT.md). The same basename
// under catalog/ and personal/ is the point: `catalog/mal.json` is the MAL
// catalog slice, `personal/mal.json` its personal one.
const ANIME_MAL_FILE = dataFile('catalog/mal.json');
const ANIME_MAL_PERSONAL_FILE = dataFile('personal/mal.json');
const ANIME_HIDDEN_FILE = dataFile('user/hidden.json');
const ANIME_SIMKL_FILE = dataFile('personal/simkl.json');
const ANIME_ANILIST_META_FILE = dataFile('catalog/anilist.json');
const ANIME_ANILIST_CAST_FILE = dataFile('catalog/anilist_cast.json');
const ANIME_ANILIST_PERSONAL_FILE = dataFile('personal/anilist.json');
const ANIME_LOCAL_PERSONAL_FILE = dataFile('personal/local.json');

// ============================================================================
// H1 migration boot guard
// ============================================================================
//
// There is no central process-boot hook (no instrumentation.ts), so "refuse to
// start on an un-migrated store" is a one-time lazy guard on the first catalog
// read. Post-H1 code NEVER writes `my_list_status` into the catalog file, so
// finding one embedded is an unambiguous "this store predates the split" signal.
// Runs once per process (the check is cheap but not free on 25k rows).

let malStoreChecked = false;

function assertMigratedMalStore(animes?: Record<string, MALAnime>): void {
  if (malStoreChecked) return;
  const catalog = animes ?? readJsonFile<Record<string, MALAnime>>(ANIME_MAL_FILE, {});
  for (const anime of Object.values(catalog)) {
    if (anime && anime.my_list_status !== undefined) {
      throw new Error(
        'Un-migrated MAL store: `my_list_status` is still embedded in ' +
          'the MAL catalog slice. Run `node scripts/migrate-mal-personal.js <dataPath>` ' +
          'before starting this version (docs/PROVIDER-PARITY.md H1).'
      );
    }
  }
  malStoreChecked = true;
}

// ============================================================================
// Hidden anime ids
// ============================================================================

/** Canonical ids (docs/PROVIDER-FREE-CUTOVER.md Phase D — re-keyed from MAL id). */
export function getHiddenAnimeIds(): string[] {
  return readJsonFile<string[]>(ANIME_HIDDEN_FILE, []);
}

export function addHiddenAnimeId(canonicalId: string): void {
  const hiddenIds = getHiddenAnimeIds();
  if (!hiddenIds.includes(canonicalId)) {
    hiddenIds.push(canonicalId);
    writeJsonFile(ANIME_HIDDEN_FILE, hiddenIds);
    invalidateRecordCache();
  }
}

export function removeHiddenAnimeId(canonicalId: string): void {
  let hiddenIds = getHiddenAnimeIds();
  hiddenIds = hiddenIds.filter(id => id !== canonicalId);
  writeJsonFile(ANIME_HIDDEN_FILE, hiddenIds);
  invalidateRecordCache();
}

// ============================================================================
// The catalog itself — a raw MAL slice, keyed by canonical id (resolved from
// each record's MAL id at write time; see resolveCanonicalIds).
// ============================================================================

export function getAllAnime(): Record<string, MALAnime> {
  const animes = readJsonFile<Record<string, MALAnime>>(ANIME_MAL_FILE, {});
  assertMigratedMalStore(animes);
  return animes;
}

export function saveAnime(animeData: Record<string, MALAnime>): void {
  writeJsonFile(ANIME_MAL_FILE, animeData);
  invalidateRecordCache();
}

/**
 * Ingest incoming MAL API records (docs/PROVIDER-PARITY.md H1: **split on
 * ingest**). MAL ships the viewer's `my_list_status` inline on every fetch; the
 * catalog file must stay pure catalog, so we strip it off each record and route
 * it into the MAL personal slice.
 *
 * Mirrors the previous full-object-replace semantics exactly, scoped to the
 * batch: a record WITH a status upserts the personal entry; a record WITHOUT one
 * clears any existing entry (a title removed from the MAL list stops being
 * statused). Every caller is an authenticated MAL fetch that carries the
 * viewer's status inline, so this never wipes a still-listed title.
 */
export function upsertAnime(newAnime: MALAnime[]): void {
  if (newAnime.length === 0) return;
  const existingAnime = getAllAnime();
  const ids = resolveCanonicalIds(newAnime.map(a => ({ mal: a.id }))).ids;

  const personalUpserts: Record<string, MALPersonalEntry> = {};
  const personalClears: string[] = [];
  newAnime.forEach((anime, i) => {
    const { my_list_status, ...catalog } = anime;
    existingAnime[ids[i]] = catalog as MALAnime;
    if (my_list_status?.status) personalUpserts[ids[i]] = my_list_status;
    else personalClears.push(ids[i]);
  });

  saveAnime(existingAnime);
  upsertMalPersonal(personalUpserts); // no-op on empty
  removeMalPersonal(personalClears);  // no-op unless an entry actually existed
}

/**
 * The MAL id for a canonical id, when one is resolvable — the mirror of
 * `resolveByMalId` (mal → canonical) for the outward-id routes (mal-status,
 * rating, refresh, similar) that need the real MAL id for a remote API call.
 * Checks the MAL slice's own id first (authoritative when it exists), falling
 * back to the registry crosswalk — same precedence `assembleDisplayRow` uses,
 * so a refresh/similar call never disagrees with what the detail page shows
 * for the same title. Undefined for a true AniList-only title (no `idMal`).
 *
 * Lives here rather than in `registry.ts` precisely because of that first step:
 * it consults the MAL catalog slice, and the registry sits *below* the slices in
 * the dependency graph so slice writes can resolve ids without a cycle.
 */
export function getMalIdForCanonical(canonicalId: string): number | undefined {
  const mal = getAllAnime()[canonicalId];
  if (mal) return mal.id;
  return toNum(getRegistry()[canonicalId]?.mal);
}

// ============================================================================
// MAL personal-list slice (docs/PROVIDER-PARITY.md H1), keyed by canonical id —
// the peer of the SIMKL / AniList / local personal slices. Split out of
// `catalog/mal.json` so a rating write no longer rewrites the 39 MB catalog, and
// so `MALAnime` is pure catalog. Filled by `upsertAnime` (split-on-ingest) and
// by the personal-list sync (`updatePersonalStatusBatch`).
// ============================================================================

export function getAllMalPersonal(): Record<string, MALPersonalEntry> {
  const entries = readJsonFile<Record<string, MALPersonalEntry>>(ANIME_MAL_PERSONAL_FILE, {});
  assertMigratedMalStore();
  return entries;
}

/** Merge canonical-id-keyed MAL personal entries onto the store. */
export function upsertMalPersonal(entriesByCanonicalId: Record<string, MALPersonalEntry>): void {
  const keys = Object.keys(entriesByCanonicalId);
  if (keys.length === 0) return;
  const existing = readJsonFile<Record<string, MALPersonalEntry>>(ANIME_MAL_PERSONAL_FILE, {});
  for (const key of keys) existing[key] = entriesByCanonicalId[key];
  writeJsonFile(ANIME_MAL_PERSONAL_FILE, existing);
  invalidateRecordCache();
}

/** Delete MAL personal entries by canonical id. */
export function removeMalPersonal(canonicalIds: string[]): void {
  if (canonicalIds.length === 0) return;
  const existing = readJsonFile<Record<string, MALPersonalEntry>>(ANIME_MAL_PERSONAL_FILE, {});
  let changed = false;
  for (const id of canonicalIds) {
    if (existing[id]) {
      delete existing[id];
      changed = true;
    }
  }
  if (changed) {
    writeJsonFile(ANIME_MAL_PERSONAL_FILE, existing);
    invalidateRecordCache();
  }
}

// ============================================================================
// SIMKL personal-entry slice, keyed by canonical id (resolved from each entry's
// SIMKL `ids` crosswalk — mal / simkl — at write time).
// ============================================================================

export function getAllSimklEntries(): Record<string, SimklPersonalEntry> {
  return readJsonFile<Record<string, SimklPersonalEntry>>(ANIME_SIMKL_FILE, {});
}

export function upsertSimklEntries(entries: SimklPersonalEntry[]): void {
  if (entries.length === 0) return;
  const existing = getAllSimklEntries();
  const ids = resolveCanonicalIds(
    entries.map(e => ({ ...(e.ids || {}), mal: e.mal_id, simkl: e.simkl_id }))
  ).ids;
  entries.forEach((entry, i) => {
    existing[ids[i]] = entry;
  });
  writeJsonFile(ANIME_SIMKL_FILE, existing);
  invalidateRecordCache();
}

/** Delete SIMKL entries by canonical id (the file's key). */
export function removeSimklEntries(canonicalIds: string[]): void {
  const existing = getAllSimklEntries();
  let changed = false;
  canonicalIds.forEach(id => {
    if (existing[id]) {
      delete existing[id];
      changed = true;
    }
  });
  if (changed) {
    writeJsonFile(ANIME_SIMKL_FILE, existing);
    invalidateRecordCache();
  }
}

// ============================================================================
// AniList catalog-metadata slice, keyed by canonical id (resolved from each
// entry's { mal, anilist } crosswalk at write time).
// ============================================================================

export function getAllAnilistMeta(): Record<string, AniListMetaEntry> {
  return readJsonFile<Record<string, AniListMetaEntry>>(ANIME_ANILIST_META_FILE, {});
}

export function getAnilistMetaCount(): number {
  return Object.keys(getAllAnilistMeta()).length;
}

export function upsertAnilistMeta(entries: AniListMetaEntry[]): void {
  if (entries.length === 0) return;
  const existing = getAllAnilistMeta();
  const ids = resolveCanonicalIds(
    entries.map(e => ({ mal: e.mal_id, anilist: e.anilist_id }))
  ).ids;
  entries.forEach((entry, i) => {
    // Merge onto any existing entry rather than overwrite: `entry` here never
    // carries `catalog` (only the tags/staff/banner sync writes through this
    // function), so a plain overwrite would silently erase a `catalog` block
    // the AniList catalog crawler (Phase 3) already wrote for this title.
    existing[ids[i]] = { ...existing[ids[i]], ...entry };
  });
  writeJsonFile(ANIME_ANILIST_META_FILE, existing);
  invalidateRecordCache();
}

/**
 * Merge the AniList catalog crawler's `catalog` block onto each entry, WITHOUT
 * touching `tags`/`staff`/`banner_image` (unlike `upsertAnilistMeta`, which
 * overwrites the whole entry — fine for the tags/staff sync since it always
 * fetches all three together, wrong here since the crawler only ever has
 * `catalog`). Creates a bare entry (empty `tags`) if the tags/staff sync
 * hasn't reached this title yet. `mal_id` is omitted for an AniList-only title
 * (no MAL id) — the entry then carries only `catalog`/`anilist_id`, and the
 * canonical id is resolved/minted off the `anilist` crosswalk alone.
 */
export function upsertAnilistCatalogFields(
  entries: Array<{ mal_id?: number; anilist_id: number; catalog: NonNullable<AniListMetaEntry['catalog']> }>
): void {
  if (entries.length === 0) return;
  const existing = getAllAnilistMeta();
  const now = new Date().toISOString();
  const ids = resolveCanonicalIds(
    entries.map(e => ({ mal: e.mal_id, anilist: e.anilist_id }))
  ).ids;
  entries.forEach(({ mal_id, anilist_id, catalog }, i) => {
    const key = ids[i];
    const current = existing[key];
    existing[key] = current
      ? { ...current, catalog }
      : { mal_id, anilist_id, tags: [], catalog, fetched_at: now };
  });
  writeJsonFile(ANIME_ANILIST_META_FILE, existing);
  invalidateRecordCache();
}

// ============================================================================
// AniList cast slice (characters + Japanese seiyuu), keyed by canonical id.
//
// Deliberately NOT part of the six-slice join in getAnimeForDisplay(): cast is
// display-only detail-page data (it feeds no reco source), and it is the
// bulkiest AniList payload there is. Reading it here would make every cold row
// build parse tens of MB nothing else uses. So these functions do NOT clear
// the record cache — writing cast cannot change any assembled row.
//
// Filled lazily, one title at a time, the first time a detail page is opened.
// ============================================================================

export function getAllAnilistCast(): Record<string, AniListCastEntry> {
  return readJsonFile<Record<string, AniListCastEntry>>(ANIME_ANILIST_CAST_FILE, {});
}

export function getAnilistCastCount(): number {
  return Object.keys(getAllAnilistCast()).length;
}

/**
 * One title's cast, or `undefined` when it was never fetched. Note the
 * distinction the caller depends on: `undefined` = never asked, whereas an
 * entry with `characters: []` = asked, AniList has none (don't re-fetch).
 */
export function getAnilistCast(canonicalId: string): AniListCastEntry | undefined {
  return getAllAnilistCast()[canonicalId];
}

export function upsertAnilistCast(canonicalId: string, entry: AniListCastEntry): void {
  const existing = getAllAnilistCast();
  existing[canonicalId] = entry;
  writeJsonFile(ANIME_ANILIST_CAST_FILE, existing);
  // No `invalidateRecordCache()` on purpose — see the block comment above.
}

// ============================================================================
// AniList personal-list slice (keyed by MAL id, as string) — docs/PROVIDER-FREE.md
// P3b. Anonymously imported from a public AniList username; lowest personal-state
// fallback tier (see getEffective* in animeUtils.ts). A username import is always
// a FULL pull, so the mutator REPLACES the whole file — removals from the AniList
// list drop out for free, no delta/reconcile needed (unlike SIMKL).
// ============================================================================

export function getAllAnilistPersonalEntries(): Record<string, AniListPersonalEntry> {
  return readJsonFile<Record<string, AniListPersonalEntry>>(ANIME_ANILIST_PERSONAL_FILE, {});
}

export function getAnilistPersonalCount(): number {
  return Object.keys(getAllAnilistPersonalEntries()).length;
}

/**
 * Replace the entire AniList personal-list store. The caller (anilistPersonalSync)
 * hands a MAL-id-keyed map (the entry stays the locked 4-field
 * `AniListPersonalEntry` shape, no `mal_id` bolted on); this re-keys it to
 * canonical id at write time via the resolver (using each entry's `{ mal, anilist }`
 * crosswalk), so the file on disk is canonical-keyed like every other slice.
 * Invalidates the merged-record cache like every other write here.
 */
export function replaceAnilistPersonalEntries(entriesByMalId: Record<string, AniListPersonalEntry>): void {
  const pairs = Object.entries(entriesByMalId);
  const ids = resolveCanonicalIds(
    pairs.map(([malId, entry]) => ({ mal: Number(malId), anilist: entry.anilist_id }))
  ).ids;
  const byCanonical: Record<string, AniListPersonalEntry> = {};
  pairs.forEach(([, entry], i) => {
    byCanonical[ids[i]] = entry;
  });
  writeJsonFile(ANIME_ANILIST_PERSONAL_FILE, byCanonical);
  invalidateRecordCache();
}

/**
 * Merge AniList personal entries by canonical id (the write-path counterpart of
 * `replaceAnilistPersonalEntries`, which is the import path's full replace).
 * Used by the AniList personal writer to reflect a push into the local slice.
 *
 * CAVEAT: a subsequent anonymous username import calls the *replace* above and
 * will drop any entry the import doesn't also carry. Harmless in practice — a
 * logged-in user's push lands on AniList, so the next import reads it back — but
 * it does mean this slice is not a durable local-only store the way
 * `personal/local.json` is.
 */
export function upsertAnilistPersonalEntries(entriesByCanonicalId: Record<string, AniListPersonalEntry>): void {
  const keys = Object.keys(entriesByCanonicalId);
  if (keys.length === 0) return;
  const existing = getAllAnilistPersonalEntries();
  for (const key of keys) existing[key] = entriesByCanonicalId[key];
  writeJsonFile(ANIME_ANILIST_PERSONAL_FILE, existing);
  invalidateRecordCache();
}

// ============================================================================
// Local personal-state slice (docs/localRating/), keyed DIRECTLY by canonical id
// — unlike the external slices, a local edit has no provider crosswalk to resolve
// from; the write path (phase 2) already holds the canonical id. This is the
// write target that un-conflates local edits from `catalog/mal.json`.
// ============================================================================

export function getAllLocalEntries(): Record<string, LocalPersonalEntry> {
  return readJsonFile<Record<string, LocalPersonalEntry>>(ANIME_LOCAL_PERSONAL_FILE, {});
}

/** Merge canonical-id-keyed local entries onto the store (phase 2's writer). */
export function upsertLocalEntries(entriesByCanonicalId: Record<string, LocalPersonalEntry>): void {
  const keys = Object.keys(entriesByCanonicalId);
  if (keys.length === 0) return;
  const existing = getAllLocalEntries();
  for (const key of keys) existing[key] = entriesByCanonicalId[key];
  writeJsonFile(ANIME_LOCAL_PERSONAL_FILE, existing);
  invalidateRecordCache();
}

/** Delete local entries by canonical id. */
export function removeLocalEntries(canonicalIds: string[]): void {
  const existing = getAllLocalEntries();
  let changed = false;
  for (const id of canonicalIds) {
    if (existing[id]) {
      delete existing[id];
      changed = true;
    }
  }
  if (changed) {
    writeJsonFile(ANIME_LOCAL_PERSONAL_FILE, existing);
    invalidateRecordCache();
  }
}

// ============================================================================
// Sync metadata
// ============================================================================

export function getSyncMetadata(): SyncMetadata | null {
  const malAnime = getAllAnime();
  const animeList = Object.values(malAnime);

  if (animeList.length === 0) return null;

  // Find the most recent sync by looking at updated_at timestamps
  const mostRecent = animeList.reduce((latest, anime) => {
    if (!anime.updated_at) return latest;
    if (!latest.updated_at) return anime;
    return new Date(anime.updated_at) > new Date(latest.updated_at) ? anime : latest;
  });

  if (!mostRecent.updated_at) return null;

  const { current, previous } = getSeasonInfos();

  return {
    lastSyncDate: mostRecent.updated_at,
    currentSeason: current,
    previousSeason: previous,
    totalAnimeCount: animeList.length
  };
}

// ============================================================================
// Personal status writes — the MAL personal slice (docs/PROVIDER-PARITY.md H1).
// Was a mutation of `catalog/mal.json` (39 MB rewrite per call); now targets the
// lean `personal/mal.json`.
// ============================================================================

interface PersonalStatusUpdateResult {
  updated: boolean;
  changes: string[];
}

/**
 * Update personal status for a single anime if it exists and differs from
 * current state. Does NOT insert — only updates titles the catalog already
 * holds (unchanged "don't insert" contract; the personal-list sync must never
 * add a catalog row).
 *
 * `existing` is the current MAL personal map, mutated in place by the caller
 * (`updatePersonalStatusBatch` reads once and persists once) so a batch is a
 * single ~100 KB write rather than one write per title.
 */
function updatePersonalStatus(
  animeId: number,
  newListStatus: MALListStatus,
  catalog: Record<string, MALAnime>,
  personal: Record<string, MALPersonalEntry>
): PersonalStatusUpdateResult {
  // `animeId` is a MAL id; the slices are canonical-keyed. Resolve read-only —
  // an un-anchored MAL id means the title isn't in the local record, which is
  // exactly the "don't insert" case below.
  const animeKey = resolveByMalId(animeId);

  // Anime doesn't exist locally - don't insert it
  if (!animeKey || !catalog[animeKey]) {
    return { updated: false, changes: [] };
  }

  const current = personal[animeKey];
  const changes: string[] = [];

  // If no personal entry yet, initialize it
  if (!current) {
    personal[animeKey] = {
      status: newListStatus.status,
      score: newListStatus.score,
      num_episodes_watched: newListStatus.num_episodes_watched,
      is_rewatching: newListStatus.is_rewatching,
      updated_at: newListStatus.updated_at,
    };
    changes.push('initialized');
    return { updated: true, changes };
  }

  // Compare each field and track changes
  if (current.status !== newListStatus.status) {
    changes.push(`status: ${current.status} -> ${newListStatus.status}`);
    current.status = newListStatus.status;
  }

  if (current.score !== newListStatus.score) {
    changes.push(`score: ${current.score} -> ${newListStatus.score}`);
    current.score = newListStatus.score;
  }

  if (current.num_episodes_watched !== newListStatus.num_episodes_watched) {
    changes.push(
      `episodes: ${current.num_episodes_watched} -> ${newListStatus.num_episodes_watched}`
    );
    current.num_episodes_watched = newListStatus.num_episodes_watched;
  }

  if (current.is_rewatching !== newListStatus.is_rewatching) {
    changes.push(`rewatching: ${current.is_rewatching} -> ${newListStatus.is_rewatching}`);
    current.is_rewatching = newListStatus.is_rewatching;
  }

  // Refresh updated_at only when something else changed.
  if (changes.length > 0) {
    current.updated_at = newListStatus.updated_at;
  }

  return { updated: changes.length > 0, changes };
}

interface BatchUpdateStats {
  totalProcessed: number;
  updated: number;
  skipped: number;
  failed: number;
  updates: Array<{ animeId: number; changes: string[] }>;
}

/**
 * Apply personal status updates to multiple anime.
 * Only updates existing anime, never inserts new ones.
 */
export function updatePersonalStatusBatch(
  updates: Array<{ animeId: number; listStatus: MALListStatus }>
): BatchUpdateStats {
  const stats: BatchUpdateStats = {
    totalProcessed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    updates: [],
  };

  // Read both slices once; mutate the personal map in place; persist once at the
  // end (a single ~100 KB write for the whole batch).
  const catalog = getAllAnime();
  const personal = getAllMalPersonal();
  let anyChange = false;

  for (const update of updates) {
    try {
      const result = updatePersonalStatus(update.animeId, update.listStatus, catalog, personal);
      stats.totalProcessed++;

      if (result.updated) {
        stats.updated++;
        anyChange = true;
        stats.updates.push({ animeId: update.animeId, changes: result.changes });
      } else {
        stats.skipped++;
      }
    } catch (error) {
      stats.failed++;
      console.error(`Failed to update personal status for anime ${update.animeId}:`, error);
    }
  }

  if (anyChange) {
    writeJsonFile(ANIME_MAL_PERSONAL_FILE, personal);
    invalidateRecordCache();
  }

  return stats;
}
