/**
 * The local record store — the authority.
 *
 * MAL, SIMKL and AniList are interchangeable, absent-tolerant refill pipes;
 * what they refill is the merged local record assembled here. Nothing in this
 * module talks to a remote API: it reads and writes the JSON files under
 * `DATA_PATH` and joins them into `AnimeRecord`.
 *
 * Naming: functions here are about the *local record*, so they carry no source
 * prefix. A `MAL`/`Simkl`/`Anilist` prefix means the function is genuinely
 * about that one source's slice of the data.
 *
 * Server-only (uses `fs` via `jsonStore`). Client components must
 * `import type` from here, never import values.
 */

import { MALAnime, AnimeRecord, SyncMetadata, SimklPersonalEntry, AniListMetaEntry, AniListCastEntry, AniListPersonalEntry, LocalPersonalEntry, SourceIds, ProvenanceSource, MALListStatus, MALPersonalEntry } from '@/models/anime';
import { computeDiscrepancy } from '@/lib/discrepancy';
import { buildProviderStates } from '@/lib/personalState';
import { dataFile, readJsonFile, writeJsonFile } from '@/lib/jsonStore';
import { getSeasonInfos, toAnimeRecord } from '@/lib/animeUtils';
import { getResolvedPersonalPrecedence } from '@/lib/providers';

const ANIME_MAL_FILE = dataFile('animes_mal.json');
const ANIME_MAL_PERSONAL_FILE = dataFile('animes_mal_personal.json');
const ANIME_HIDDEN_FILE = dataFile('animes_hidden.json');
const ANIME_SIMKL_FILE = dataFile('animes_simkl.json');
const ANIME_ANILIST_META_FILE = dataFile('animes_anilist_meta.json');
const ANIME_ANILIST_CAST_FILE = dataFile('animes_anilist_cast.json');
const ANIME_ANILIST_PERSONAL_FILE = dataFile('animes_anilist_personal.json');
const ANIME_LOCAL_PERSONAL_FILE = dataFile('animes_local_personal.json');

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
          'animes_mal.json. Run `node scripts/migrate-mal-personal.js <dataPath>` ' +
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
    cachedAnime = null;
  }
}

export function removeHiddenAnimeId(canonicalId: string): void {
  let hiddenIds = getHiddenAnimeIds();
  hiddenIds = hiddenIds.filter(id => id !== canonicalId);
  writeJsonFile(ANIME_HIDDEN_FILE, hiddenIds);
  cachedAnime = null;
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
  cachedAnime = null;
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

// ============================================================================
// MAL personal-list slice (docs/PROVIDER-PARITY.md H1), keyed by canonical id —
// the peer of the SIMKL / AniList / local personal slices. Split out of
// `animes_mal.json` so a rating write no longer rewrites the 39 MB catalog, and
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
  cachedAnime = null;
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
    cachedAnime = null;
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
  cachedAnime = null;
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
    cachedAnime = null;
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
  cachedAnime = null;
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
  cachedAnime = null;
}

// ============================================================================
// AniList cast slice (characters + Japanese seiyuu), keyed by canonical id.
//
// Deliberately NOT part of the six-slice join in getAnimeForDisplay(): cast is
// display-only detail-page data (it feeds no reco source), and it is the
// bulkiest AniList payload there is. Reading it here would make every cold row
// build parse tens of MB nothing else uses. So these functions do NOT clear
// `cachedAnime` — writing cast cannot change any assembled row.
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
  // No `cachedAnime = null` on purpose — see the block comment above.
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
  cachedAnime = null;
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
 * `animes_local_personal.json` is.
 */
export function upsertAnilistPersonalEntries(entriesByCanonicalId: Record<string, AniListPersonalEntry>): void {
  const keys = Object.keys(entriesByCanonicalId);
  if (keys.length === 0) return;
  const existing = getAllAnilistPersonalEntries();
  for (const key of keys) existing[key] = entriesByCanonicalId[key];
  writeJsonFile(ANIME_ANILIST_PERSONAL_FILE, existing);
  cachedAnime = null;
}

// ============================================================================
// Local personal-state slice (docs/localRating/), keyed DIRECTLY by canonical id
// — unlike the external slices, a local edit has no provider crosswalk to resolve
// from; the write path (phase 2) already holds the canonical id. This is the
// write target that un-conflates local edits from `animes_mal.json`.
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
  cachedAnime = null;
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
    cachedAnime = null;
  }
}

// ============================================================================
// Anchor registry: canonicalId -> SourceIds crosswalk (docs/PROVIDER-FREE.md
// Phase 1, docs/PROVIDER-FREE-CUTOVER.md Phase B). The identity spine: every
// slice file is keyed by the canonical id resolved here. Every write path
// resolves-before-mint (resolveCanonicalIds), so a sync can never recreate a
// mal-id-keyed entry, and durable user data keyed by canonical id can't
// reattach to the wrong title on a rebuild. The canonical id is now also the
// OUTWARD id (URLs, API route params, hidden/feedback keys —
// docs/PROVIDER-FREE-CUTOVER.md Phase D); `anime.id` (the raw MAL id) is kept
// only for MAL API calls and the external MAL link.
// ============================================================================

const ANIME_REGISTRY_FILE = dataFile('animes_registry.json');

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
 * The MAL id for a canonical id, when one is resolvable — the mirror of
 * `resolveByMalId` (mal → canonical) for the outward-id routes (mal-status,
 * rating, refresh, similar) that need the real MAL id for a remote API call.
 * Checks the MAL slice's own id first (authoritative when it exists), falling
 * back to the registry crosswalk — same precedence `assembleDisplayRow` uses,
 * so a refresh/similar call never disagrees with what the detail page shows
 * for the same title. Undefined for a true AniList-only title (no `idMal`).
 */
export function getMalIdForCanonical(canonicalId: string): number | undefined {
  const mal = getAllAnime()[canonicalId];
  if (mal) return mal.id;
  return toNum(getRegistry()[canonicalId]?.mal);
}

/**
 * The identity resolver (docs/PROVIDER-FREE-CUTOVER.md — the Phase A invariant).
 * Mint-or-resolve a canonical id for a batch of provider-id crosswalks:
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


// ============================================================================
// The merged record
// ============================================================================

// The assembled rows are cached against the IDENTITY of the six parsed slices
// (jsonStore's parse cache returns the same object until the file on disk
// changes), so a rebuild happens exactly when some slice actually changed —
// no TTL. This also closes the old cross-bundle staleness hole: an API-route
// write bumps the file's mtime, the page bundle's next read re-parses, the
// slice reference changes, and the page bundle's row cache rebuilds.
let cachedAnime: AnimeRecord[] | null = null;
let cachedAnimeInputs: readonly unknown[] | null = null;

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
 * undefined when no MAL id is resolvable anywhere (true AniList-only, no
 * `idMal` — out of scope per docs/PROVIDER-FREE-CUTOVER.md "Deferred").
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
  // `sources.mal` left undefined (docs/PROVIDER-FREE-CUTOVER.md Phase C).
  const malAnime = getAllAnime();
  const malPersonalByCanonical = getAllMalPersonal();
  const hiddenIdList = getHiddenAnimeIds();
  const simklByCanonical = getAllSimklEntries();
  const anilistMetaByCanonical = getAllAnilistMeta();
  const anilistPersonalByCanonical = getAllAnilistPersonalEntries();
  const localByCanonical = getAllLocalEntries();
  const registry = getRegistry();
  // Resolved once per call (docs/localRating/ 1d): folded into the cache key as a
  // stable string so flipping a settings toggle — or a MAL/SIMKL token appearing
  // or lapsing — rebuilds the rows even though no *slice file* changed.
  const personalPrecedence = getResolvedPersonalPrecedence();

  // Same parsed slices as last time (reference equality — see the parse cache
  // in jsonStore.ts) → the assembled rows are still valid. The precedence join
  // is a value-compared string (see 1d.3), so a mode/token change invalidates.
  const inputs = [malAnime, malPersonalByCanonical, hiddenIdList, simklByCanonical, anilistMetaByCanonical, anilistPersonalByCanonical, localByCanonical, registry, personalPrecedence.join('|')];
  if (cachedAnime && cachedAnimeInputs && inputs.every((v, i) => v === cachedAnimeInputs![i])) {
    return cachedAnime;
  }
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
  cachedAnime = rows;
  cachedAnimeInputs = inputs;
  return cachedAnime;
}

/**
 * Assemble ONE anime record from the source files, bypassing the
 * `getAnimeForDisplay` row cache.
 *
 * Historically this existed because the detail page (page bundle) couldn't see
 * an API-route write invalidating the other bundle's `cachedAnime`. That hole
 * is closed now — both the parse cache and the row cache invalidate off file
 * mtime — but the direct read is kept: it's cheap (six stat calls + one row
 * assembly against cached parses) and stays trivially immune by construction.
 *
 * `canonicalId` is the outward id (docs/PROVIDER-FREE-CUTOVER.md Phase D) —
 * the route param IS the slice key, so no resolve step is needed.
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
// Was a mutation of `animes_mal.json` (39 MB rewrite per call); now targets the
// lean `animes_mal_personal.json`.
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
    cachedAnime = null;
  }

  return stats;
}
