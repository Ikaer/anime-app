# SIMKL Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only SIMKL personal-library sync that merges into the existing MAL anime records at display time and surfaces MAL↔SIMKL discrepancies (status / score / progress) on the main page.

**Architecture:** A lean side-file `animes_SIMKL.json` (keyed by MAL id) stores only SIMKL-unique personal data, joined onto MAL records inside `getAnimeForDisplay()` exactly the way `animes_hidden.json` already is. A pure, client-safe `simklCompare.ts` computes discrepancies (used by both the API filter and the UI badge). A new `simklSync.ts` orchestrates SIMKL's two-phase sync (initial full pull, then `/sync/activities` + `date_from` deltas). MAL remains authoritative for existing filters/reco. A new sidebar section drives SIMKL connect + sync; a new `discrepanciesOnly` URL filter + per-card badge surface the diffs.

**Tech Stack:** Next.js 14 (Pages Router), TypeScript, React 18, CSS Modules with `typed-css-modules`, JSON-file storage. No test framework in this repo.

## Global Constraints

- **No writes to SIMKL, ever.** Read-only integration.
- **No test framework exists.** Verification per task = `npx tsc --noEmit` (type-check), `npm run lint`, and — for UI/integration tasks — manual dev-server checks via the preview tools. Full `npm run build` at the end. There are NO `*.test.ts` files to write.
- **Run `npm run css:types` after adding/modifying any `.module.css`** (regenerates `.module.css.d.ts`; the build will fail otherwise). Classes are camelCase.
- **`@/lib/anime`, `@/lib/simkl`, `@/lib/simklSync` are server-only** (`fs`/`path`). Client components must import types from them with `import type { ... }`. `@/lib/simklCompare` and `@/models/anime` are client-safe (no `fs`).
- **Cache invalidation invariant:** every function that writes an anime-related JSON file MUST set `cachedAnime = null` (the 10-min display cache in `anime.ts`). Do not rely on TTL.
- **MAL vocabulary is canonical.** SIMKL status is normalized to `UserAnimeStatus` (`watching | completed | on_hold | dropped | plan_to_watch`) at write time.
- **SIMKL API auth requirement:** every authenticated request MUST include query params `client_id`, `app-name`, `app-version` AND headers `Authorization: Bearer <token>`, `User-Agent: <app-name>/<version>`. Omitting `client_id` returns `412 client_id_failed`.
- **Watermark discipline:** store the `/sync/activities` `anime.all` timestamp **exactly as received** (ISO 8601 UTC, never reformatted). Advance it only after a successful merge.
- Env vars already present in `.env.example`: `SIMKL_CLIENT_ID`, `SIMKL_CLIENT_SECRET`, `SIMKL_APP_NAME`, `SIMKL_REDIRECT_URI`.

**Reference:** Spec at `docs/superpowers/specs/2026-07-04-simkl-integration-design.md`; SIMKL API rules at `docs/simkl/apirules.md`. Existing spike: `src/lib/simkl.ts` (auth/state — KEEP), `src/pages/api/anime/simkl/auth.ts` (KEEP, retarget redirect), `src/pages/api/anime/simkl/library.ts` + `src/pages/simkl-test.tsx` (spike — DELETE in Task 4).

---

## File Structure

**Create:**
- `src/lib/simklSync.ts` — SIMKL API client + two-phase sync orchestration (server-only)
- `src/lib/simklCompare.ts` — pure status-normalization + discrepancy computation (client-safe)
- `src/pages/api/anime/simkl/sync.ts` — `POST` endpoint running the sync
- `src/components/anime/SimklDiscrepancyBadge.tsx` (+ `.module.css`) — the per-card diff badge
- `src/components/anime/sidebar/SimklSection.tsx` (+ `.module.css`) — SIMKL connect/disconnect + sync UI

**Modify:**
- `src/models/anime/index.ts` — add `SimklPersonalEntry`, `Discrepancy`; extend `AnimeForDisplay`; add `discrepanciesOnly` to `AnimeListResponse.filters`
- `src/lib/anime.ts` — SIMKL file I/O + join in `getAnimeForDisplay()`
- `src/lib/simkl.ts` — SIMKL sync-checkpoint (watermark) read/write + shared `simklFetch` helper
- `src/pages/api/anime/simkl/auth.ts` — retarget OAuth callback redirect from `/simkl-test` to `/`
- `src/lib/animeUrlParams.ts` — `discrepanciesOnly` filter state/default/param-key/encode/decode + `simkl` sidebar key
- `src/hooks/useAnimeUrlState.ts` — `discrepanciesOnly` in the `filters` memo
- `src/pages/api/anime/animes/index.ts` — apply `discrepanciesOnly`; echo it back
- `src/pages/index.tsx` — request param, SIMKL auth/sync state + handlers, callback handling, prop wiring
- `src/components/anime/AnimeSidebar.tsx` — render `SimklSection`; thread SIMKL + `discrepanciesOnly` props
- `src/components/anime/sidebar/FiltersSection.tsx` — "Discrepancies only" toggle
- `src/components/anime/AnimeCardView.tsx` + `src/components/anime/AnimeTable.tsx` — render the badge
- `CLAUDE.md` — SIMKL architecture section + env table row

**Delete (Task 4):** `src/pages/api/anime/simkl/library.ts`, `src/pages/simkl-test.tsx`

---

## Task 1: Data model + pure discrepancy module

Foundation types + the client-safe compare logic. No behavior wired yet.

**Files:**
- Modify: `src/models/anime/index.ts`
- Create: `src/lib/simklCompare.ts`

**Interfaces:**
- Produces: `SimklPersonalEntry`, `Discrepancy` (in models); `mapSimklStatus(raw: string): UserAnimeStatus | null`, `computeDiscrepancy(anime: MALAnime, simkl?: SimklPersonalEntry): Discrepancy | null` (in `simklCompare`).

- [ ] **Step 1: Add model types.** In `src/models/anime/index.ts`, after the `AnimeForDisplay` interface (currently lines ~90-93), add the SIMKL types and extend `AnimeForDisplay`:

```ts
// SIMKL personal data (read-only, one-way sync). Keyed by MAL id in animes_SIMKL.json.
export interface SimklPersonalEntry {
  simkl_id: number;          // kept for deletion reconciliation (diff on ids.simkl)
  mal_id: number;
  status: UserAnimeStatus;   // normalized to MAL vocabulary at write time
  score: number | null;      // SIMKL user rating, 1-10; null if unrated
  num_episodes_watched: number | null;
  total_episodes: number | null;
  watched_at?: string;       // SIMKL last_watched
  updated_at?: string;       // SIMKL item timestamp
}

// A detected MAL vs SIMKL mismatch for one title. `null` fields = that dimension agrees.
export interface Discrepancy {
  status?: { mal: UserAnimeStatus | null; simkl: UserAnimeStatus };
  score?: { mal: number | null; simkl: number | null };
  progress?: { mal: number | null; simkl: number | null };
  presence?: 'simkl_only'; // soft: synced from SIMKL but absent from your MAL list
}
```

Then change the existing `AnimeForDisplay` interface to:

```ts
// Combined data for display
export interface AnimeForDisplay extends MALAnime {
  hidden?: boolean;
  simkl?: SimklPersonalEntry;       // joined at display time by MAL id
  discrepancy?: Discrepancy | null; // computed at display / filter time
}
```

- [ ] **Step 2: Create `src/lib/simklCompare.ts`.** Pure, client-safe (no `fs`). Full contents:

```ts
/**
 * Pure MAL<->SIMKL comparison helpers. Client-safe: no fs/path imports, so this
 * module is importable from both API handlers and React components.
 */
import { MALAnime, SimklPersonalEntry, Discrepancy, UserAnimeStatus } from '@/models/anime';

// SIMKL status vocabulary -> MAL vocabulary. Returns null for unknown values.
const SIMKL_STATUS_MAP: Record<string, UserAnimeStatus> = {
  watching: 'watching',
  completed: 'completed',
  hold: 'on_hold',
  plantowatch: 'plan_to_watch',
  dropped: 'dropped',
  // tolerate already-normalized / alternate spellings
  on_hold: 'on_hold',
  plan_to_watch: 'plan_to_watch',
  notinteresting: 'dropped',
};

export function mapSimklStatus(raw: string | undefined | null): UserAnimeStatus | null {
  if (!raw) return null;
  return SIMKL_STATUS_MAP[raw.toLowerCase().trim()] ?? null;
}

/**
 * Compute the MAL vs SIMKL discrepancy for a single anime.
 * Returns null when there is no SIMKL entry, or when every comparable
 * dimension agrees. Missing/null values are treated leniently: a value only
 * counts as a mismatch when BOTH sides are present and differ. `presence`
 * flags the soft case where exactly one side carries a status.
 */
export function computeDiscrepancy(
  anime: MALAnime,
  simkl?: SimklPersonalEntry
): Discrepancy | null {
  if (!simkl) return null;

  const malStatus = anime.my_list_status?.status
    ? (anime.my_list_status.status as UserAnimeStatus)
    : null;
  const malScore = anime.my_list_status?.score ? anime.my_list_status.score : null;
  const malProgress =
    anime.my_list_status?.num_episodes_watched != null
      ? anime.my_list_status.num_episodes_watched
      : null;

  const result: Discrepancy = {};

  // Status
  if (malStatus && simkl.status && malStatus !== simkl.status) {
    result.status = { mal: malStatus, simkl: simkl.status };
  }

  // Score (both present and differing)
  if (malScore != null && simkl.score != null && malScore !== simkl.score) {
    result.score = { mal: malScore, simkl: simkl.score };
  }

  // Progress (both present and differing)
  if (
    malProgress != null &&
    simkl.num_episodes_watched != null &&
    malProgress !== simkl.num_episodes_watched
  ) {
    result.progress = { mal: malProgress, simkl: simkl.num_episodes_watched };
  }

  // Presence (soft): synced from SIMKL but not statused on MAL. The inverse
  // (on MAL, not on SIMKL) is intentionally NOT computed here — this function
  // only runs when a SIMKL entry exists, and every stored entry has a status.
  if (!malStatus) {
    result.presence = 'simkl_only';
  }

  const hasAny =
    result.status || result.score || result.progress || result.presence;
  return hasAny ? result : null;
}
```

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit`
Expected: no errors (the new types compile; `AnimeForDisplay` still satisfies existing consumers because the new fields are optional).

- [ ] **Step 4: Commit.**

```bash
git add src/models/anime/index.ts src/lib/simklCompare.ts
git commit -m "Add SIMKL personal-entry types and pure discrepancy module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: SIMKL persistence + display join in anime.ts

Store/read `animes_SIMKL.json` and join it (with computed discrepancy) inside `getAnimeForDisplay()`.

**Files:**
- Modify: `src/lib/anime.ts`

**Interfaces:**
- Consumes: `SimklPersonalEntry` (models), `computeDiscrepancy` (simklCompare).
- Produces: `getAllSimklEntries(): Record<string, SimklPersonalEntry>`, `upsertSimklEntries(entries: SimklPersonalEntry[]): void`, `removeSimklEntries(malIds: number[]): void`, `getSimklEntryCount(): number`. `getAnimeForDisplay()` now attaches `.simkl` + `.discrepancy`.

- [ ] **Step 1: Add imports + file constant.** In `src/lib/anime.ts`, extend the model import on line 3 to include `SimklPersonalEntry`, and add a `computeDiscrepancy` import + the file path constant (after `ANIME_MAL_FILE`, line ~10):

```ts
import { MALAnime, AnimeForDisplay, MALAuthData, MALUser, SyncMetadata, UserAnimeStatus, SimklPersonalEntry } from '@/models/anime';
import { computeDiscrepancy } from '@/lib/simklCompare';
// ...
const ANIME_SIMKL_FILE = path.join(DATA_PATH, 'animes_SIMKL.json');
```

- [ ] **Step 2: Add SIMKL file operations.** After the MAL anime operations block (after `upsertMALAnime`, line ~85), add:

```ts
// SIMKL personal-entry operations (keyed by MAL id, as string)
export function getAllSimklEntries(): Record<string, SimklPersonalEntry> {
  return readJsonFile<Record<string, SimklPersonalEntry>>(ANIME_SIMKL_FILE, {});
}

export function getSimklEntryCount(): number {
  return Object.keys(getAllSimklEntries()).length;
}

export function upsertSimklEntries(entries: SimklPersonalEntry[]): void {
  const existing = getAllSimklEntries();
  entries.forEach(entry => {
    existing[entry.mal_id.toString()] = entry;
  });
  writeJsonFile(ANIME_SIMKL_FILE, existing);
  cachedAnime = null;
}

export function removeSimklEntries(malIds: number[]): void {
  const existing = getAllSimklEntries();
  let changed = false;
  malIds.forEach(id => {
    if (existing[id.toString()]) {
      delete existing[id.toString()];
      changed = true;
    }
  });
  if (changed) {
    writeJsonFile(ANIME_SIMKL_FILE, existing);
    cachedAnime = null;
  }
}
```

- [ ] **Step 3: Join SIMKL in `getAnimeForDisplay()`.** Replace the body of `getAnimeForDisplay()` (currently lines ~92-105) with the version that also joins SIMKL + computes discrepancy:

```ts
export function getAnimeForDisplay(): AnimeForDisplay[] {
  const now = Date.now();
  if (cachedAnime && (now - lastCacheTime) < CACHE_TTL_MS) {
    return cachedAnime;
  }
  const malAnime = getAllMALAnime();
  const hiddenIds = getHiddenAnimeIds();
  const simklByMalId = getAllSimklEntries();
  cachedAnime = Object.values(malAnime).map(anime => {
    const simkl = simklByMalId[anime.id.toString()];
    return {
      ...anime,
      hidden: hiddenIds.includes(anime.id),
      simkl,
      discrepancy: computeDiscrepancy(anime, simkl),
    };
  });
  lastCacheTime = now;
  return cachedAnime;
}
```

- [ ] **Step 4: Type-check.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/anime.ts
git commit -m "Persist and join SIMKL entries into getAnimeForDisplay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: SIMKL sync orchestration (simklSync.ts) + watermark helpers

The two-phase read-only sync. Watermark helpers live in `simkl.ts` (owns SIMKL files); orchestration + normalization live in a new `simklSync.ts`.

**Files:**
- Modify: `src/lib/simkl.ts`
- Create: `src/lib/simklSync.ts`

**Interfaces:**
- Consumes: `getSimklAuthData`, `isSimklTokenValid` (simkl.ts); `upsertSimklEntries`, `removeSimklEntries`, `getAllSimklEntries` (anime.ts); `mapSimklStatus` (simklCompare); `SimklPersonalEntry` (models).
- Produces: `getSimklCheckpoint()`, `saveSimklCheckpoint(cp)`, `simklFetch(pathAndQuery, token)` (simkl.ts); `performSimklSync(): Promise<SimklSyncResult>` (simklSync.ts).

- [ ] **Step 1: Add checkpoint + fetch helper to `simkl.ts`.** Append to `src/lib/simkl.ts`:

```ts
const SIMKL_CHECKPOINT_FILE = path.join(DATA_PATH, 'simkl_sync_checkpoint.json');
const SIMKL_APP_NAME = process.env.SIMKL_APP_NAME || 'my-app-name';
const SIMKL_APP_VERSION = '1.0';
const SIMKL_CLIENT_ID = process.env.SIMKL_CLIENT_ID || '';

export interface SimklCheckpoint {
  // The activities.anime.all timestamp, stored EXACTLY as received (ISO 8601 UTC).
  lastActivityAll: string | null;
  // The activities.anime.removed_from_list timestamp, for deletion reconciliation.
  lastRemovedFromList: string | null;
}

export function getSimklCheckpoint(): SimklCheckpoint {
  return readJsonFile<SimklCheckpoint>(SIMKL_CHECKPOINT_FILE, {
    lastActivityAll: null,
    lastRemovedFromList: null,
  });
}

export function saveSimklCheckpoint(cp: SimklCheckpoint): void {
  writeJsonFile(SIMKL_CHECKPOINT_FILE, cp);
}

/**
 * Authenticated SIMKL GET. Injects the required client_id/app-name/app-version
 * query params and Authorization/User-Agent headers on every call.
 * `pathAndQuery` starts with '/' (e.g. '/sync/all-items/anime?extended=ids_only').
 */
export async function simklFetch(pathAndQuery: string, accessToken: string): Promise<Response> {
  const url = new URL(`https://api.simkl.com${pathAndQuery}`);
  url.searchParams.set('client_id', SIMKL_CLIENT_ID);
  url.searchParams.set('app-name', SIMKL_APP_NAME);
  url.searchParams.set('app-version', SIMKL_APP_VERSION);
  return fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': `${SIMKL_APP_NAME}/${SIMKL_APP_VERSION}`,
    },
  });
}
```

- [ ] **Step 2: Create `src/lib/simklSync.ts`.** Full contents. **⚠️ VERIFY-STEP baked in:** the exact field names in the `/sync/all-items/anime` payload are documented but not confirmed against a live response. The `normalizeItem` function below uses the documented shape and is fully defensive (optional chaining, skip-on-missing). Before marking this task reviewed, hit the endpoint once (via a quick `curl` with a valid token, or a throwaway log in the sync endpoint from Task 4) and confirm the field names (`show`, `ids.mal`, `ids.simkl`, `status`, `user_rating`, `watched_episodes_count`, `total_episodes_count`, `last_watched_at`). Adjust `normalizeItem` if they differ; the rest of the flow is shape-independent.

```ts
/**
 * SIMKL two-phase, read-only sync orchestration. Pulls the user's personal
 * anime library, normalizes it to MAL-keyed SimklPersonalEntry records, and
 * persists via anime.ts. See docs/simkl/apirules.md for the protocol.
 */
import { getSimklAuthData, isSimklTokenValid, getSimklCheckpoint, saveSimklCheckpoint, simklFetch, SimklCheckpoint } from '@/lib/simkl';
import { upsertSimklEntries, removeSimklEntries, getAllSimklEntries } from '@/lib/anime';
import { mapSimklStatus } from '@/lib/simklCompare';
import { SimklPersonalEntry } from '@/models/anime';

export interface SimklSyncResult {
  ok: boolean;
  phase: 'initial' | 'delta' | 'noop';
  added: number;
  removed: number;
  orphansSkipped: number;
  error?: string;
}

// ---- Raw SIMKL response shapes (defensive; see VERIFY-STEP) ----
interface RawSimklAnimeItem {
  status?: string;
  user_rating?: number | null;
  watched_episodes_count?: number | null;
  total_episodes_count?: number | null;
  last_watched_at?: string;
  anime_type?: string;
  show?: {
    title?: string;
    ids?: { simkl?: number; mal?: number | string };
  };
}
interface RawAllItems { anime?: RawSimklAnimeItem[]; }
interface RawActivities { anime?: { all?: string; removed_from_list?: string }; }

/** Normalize one raw item -> entry, or null if it has no usable MAL id (orphan). */
function normalizeItem(item: RawSimklAnimeItem): SimklPersonalEntry | null {
  const malRaw = item.show?.ids?.mal;
  const simklId = item.show?.ids?.simkl;
  const malId = typeof malRaw === 'string' ? parseInt(malRaw, 10) : malRaw;
  if (!malId || Number.isNaN(malId) || !simklId) return null; // orphan

  const status = mapSimklStatus(item.status);
  if (!status) return null; // unknown status -> treat as orphan/skip

  return {
    simkl_id: simklId,
    mal_id: malId,
    status,
    score: item.user_rating != null ? item.user_rating : null,
    num_episodes_watched: item.watched_episodes_count != null ? item.watched_episodes_count : null,
    total_episodes: item.total_episodes_count != null ? item.total_episodes_count : null,
    watched_at: item.last_watched_at,
  };
}

function normalizeAll(raw: RawAllItems): { entries: SimklPersonalEntry[]; orphansSkipped: number } {
  const items = raw.anime ?? [];
  const entries: SimklPersonalEntry[] = [];
  let orphansSkipped = 0;
  for (const item of items) {
    const entry = normalizeItem(item);
    if (entry) entries.push(entry);
    else orphansSkipped++;
  }
  return { entries, orphansSkipped };
}

async function fetchAllItems(token: string, dateFrom?: string): Promise<RawAllItems> {
  let path = '/sync/all-items/anime?extended=ids_only';
  if (dateFrom) path += `&date_from=${encodeURIComponent(dateFrom)}`;
  const res = await simklFetch(path, token);
  if (!res.ok) throw new Error(`all-items ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? (JSON.parse(text) as RawAllItems) : {};
}

async function fetchActivities(token: string): Promise<RawActivities> {
  const res = await simklFetch('/sync/activities', token);
  if (!res.ok) throw new Error(`activities ${res.status}: ${await res.text()}`);
  return (await res.json()) as RawActivities;
}

/** Reconcile deletions: diff local simkl ids against a simkl_ids_only pull. */
async function reconcileDeletions(token: string): Promise<number> {
  const res = await simklFetch('/sync/all-items/anime?extended=simkl_ids_only', token);
  if (!res.ok) throw new Error(`simkl_ids_only ${res.status}: ${await res.text()}`);
  const raw = (await res.json()) as RawAllItems;
  const liveSimklIds = new Set(
    (raw.anime ?? []).map(i => i.show?.ids?.simkl).filter((n): n is number => typeof n === 'number')
  );
  const local = getAllSimklEntries();
  const toRemove: number[] = [];
  for (const key of Object.keys(local)) {
    if (!liveSimklIds.has(local[key].simkl_id)) toRemove.push(local[key].mal_id);
  }
  if (toRemove.length) removeSimklEntries(toRemove);
  return toRemove.length;
}

export async function performSimklSync(): Promise<SimklSyncResult> {
  const { token } = getSimklAuthData();
  if (!token || !isSimklTokenValid(token)) {
    return { ok: false, phase: 'noop', added: 0, removed: 0, orphansSkipped: 0, error: 'Not authenticated with SIMKL' };
  }

  try {
    const checkpoint = getSimklCheckpoint();
    const activities = await fetchActivities(token);
    const remoteAll = activities.anime?.all ?? null;
    const remoteRemoved = activities.anime?.removed_from_list ?? null;

    // Phase 1: initial (no watermark yet)
    if (!checkpoint.lastActivityAll) {
      const raw = await fetchAllItems(token);
      const { entries, orphansSkipped } = normalizeAll(raw);
      upsertSimklEntries(entries);
      saveSimklCheckpoint({ lastActivityAll: remoteAll, lastRemovedFromList: remoteRemoved });
      return { ok: true, phase: 'initial', added: entries.length, removed: 0, orphansSkipped };
    }

    // Phase 2: nothing changed -> short-circuit
    if (remoteAll && remoteAll === checkpoint.lastActivityAll) {
      return { ok: true, phase: 'noop', added: 0, removed: 0, orphansSkipped: 0 };
    }

    // Phase 2: delta pull since saved watermark
    const raw = await fetchAllItems(token, checkpoint.lastActivityAll);
    const { entries, orphansSkipped } = normalizeAll(raw);
    upsertSimklEntries(entries);

    // Deletion reconciliation only when the removed_from_list timestamp moved
    let removed = 0;
    if (remoteRemoved && remoteRemoved !== checkpoint.lastRemovedFromList) {
      removed = await reconcileDeletions(token);
    }

    const next: SimklCheckpoint = { lastActivityAll: remoteAll, lastRemovedFromList: remoteRemoved };
    saveSimklCheckpoint(next);
    return { ok: true, phase: 'delta', added: entries.length, removed, orphansSkipped };
  } catch (error) {
    console.error('SIMKL sync error:', error);
    return {
      ok: false, phase: 'noop', added: 0, removed: 0, orphansSkipped: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
```

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/simkl.ts src/lib/simklSync.ts
git commit -m "Add SIMKL two-phase sync orchestration and watermark helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Sync endpoint, retarget auth callback, remove spike

Expose the sync, fix the OAuth callback landing page, and delete the disposable spike.

**Files:**
- Create: `src/pages/api/anime/simkl/sync.ts`
- Modify: `src/pages/api/anime/simkl/auth.ts`
- Delete: `src/pages/api/anime/simkl/library.ts`, `src/pages/simkl-test.tsx`

**Interfaces:**
- Consumes: `performSimklSync` (simklSync.ts).
- Produces: `POST /api/anime/simkl/sync` → `SimklSyncResult` JSON; `GET /api/anime/simkl/auth?action=status` unchanged; callback now redirects to `/?simkl_auth=success|error`.

- [ ] **Step 1: Create `src/pages/api/anime/simkl/sync.ts`.**

```ts
import { NextApiRequest, NextApiResponse } from 'next';
import { performSimklSync } from '@/lib/simklSync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    return;
  }
  const result = await performSimklSync();
  res.status(result.ok ? 200 : 500).json(result);
}
```

- [ ] **Step 2: Retarget the OAuth callback redirects.** In `src/pages/api/anime/simkl/auth.ts`, change the two redirects inside `handleOAuthCallback` (currently `res.redirect('/simkl-test?auth=success')` line ~151 and `res.redirect('/simkl-test?auth=error')` line ~154) to land on the main page with a SIMKL-specific query key:

```ts
    res.redirect('/?simkl_auth=success');
```
and
```ts
    res.redirect('/?simkl_auth=error');
```

- [ ] **Step 3: Delete the spike files.**

```bash
git rm src/pages/api/anime/simkl/library.ts src/pages/simkl-test.tsx
```

- [ ] **Step 4: Type-check + lint.**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors; lint clean (no references to the deleted files remain — `library.ts` and `simkl-test.tsx` were self-contained spike files).

- [ ] **Step 5: Commit.**

```bash
git add src/pages/api/anime/simkl/sync.ts src/pages/api/anime/simkl/auth.ts
git commit -m "Add SIMKL sync endpoint, retarget auth callback, remove spike

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `discrepanciesOnly` filter end-to-end

Thread a new boolean narrowing filter through the documented ~6 spots plus its sidebar toggle.

**Files:**
- Modify: `src/lib/animeUrlParams.ts`, `src/hooks/useAnimeUrlState.ts`, `src/pages/api/anime/animes/index.ts`, `src/models/anime/index.ts`, `src/pages/index.tsx`, `src/components/anime/AnimeSidebar.tsx`, `src/components/anime/sidebar/FiltersSection.tsx`, `src/lib/animeUtils.ts`, `src/lib/recommendations.ts`

**Interfaces:**
- Produces: `AnimeFiltersState.discrepanciesOnly: boolean`; URL param key `disc=1`; API query `discrepancies=true`; `AnimeListResponse.filters.discrepancies`; `getEffectiveStatus(anime): string | undefined` (animeUtils).

- [ ] **Step 1: Add to filter state + default + param key + encode/decode.** In `src/lib/animeUrlParams.ts`:

  (a) Add to `AnimeFiltersState` (after `hiddenOnly: boolean;`, line ~32):
```ts
  discrepanciesOnly: boolean;
```
  (b) Add to `DEFAULT_FILTERS` (after `hiddenOnly: false,`, line ~161):
```ts
  discrepanciesOnly: false,
```
  (c) Add a param key in `PARAM_KEYS` (after `hidden: 'h',`, line ~195):
```ts
  discrepancies: 'disc',
```
  (d) Add to `encodeFiltersToParams` (after the `filters.hiddenOnly` block, line ~279-281):
```ts
  if (filters.discrepanciesOnly) {
    params.set(PARAM_KEYS.discrepancies, '1');
  }
```
  (e) Add to `decodeUrlToFilters` (after the `hiddenOnly:` line ~434):
```ts
    discrepanciesOnly: params.get(PARAM_KEYS.discrepancies) === '1',
```
  (f) Add `'simkl'` to the sidebar section maps so the new section's collapse state persists — in `SIDEBAR_TO_CODE` (line ~117) add `simkl: 'sk',`; in `DEFAULT_SIDEBAR_EXPANDED` (line ~146) add `simkl: true,`; and in the `result` object inside `decodeSidebarExpanded` (line ~408) add `simkl: false,`.

- [ ] **Step 2: Add to the `filters` memo.** In `src/hooks/useAnimeUrlState.ts`, the `filters` memo (lines ~139-150) lists each field explicitly. Add, after the `hiddenOnly:` line:
```ts
    discrepanciesOnly: currentState.discrepanciesOnly,
```

- [ ] **Step 3: Send the request param.** In `src/pages/index.tsx` `loadAnimes` (after the Hidden param, line ~79):
```ts
      // Discrepancies only (MAL vs SIMKL mismatch)
      if (filters.discrepanciesOnly) params.set('discrepancies', 'true');
```

- [ ] **Step 4: Apply the filter + echo it in the API handler.** In `src/pages/api/anime/animes/index.ts`:

  (a) Add `discrepancies` to the destructured query (line ~14-29), after `unrated,`:
```ts
      discrepancies,
```
  (b) After the unrated filter block (line ~104), add:
```ts
    // Apply discrepancies-only filter (MAL vs SIMKL mismatch present)
    if (discrepancies !== undefined && typeof discrepancies === 'string' && discrepancies.toLowerCase() === 'true') {
      animeList = animeList.filter(anime => anime.discrepancy != null);
    }
```
  (c) In the response `filters` echo object (line ~192-202), add:
```ts
        discrepancies: (typeof discrepancies === 'string' ? discrepancies : null),
```

- [ ] **Step 5: Add the echo field to the response type.** In `src/models/anime/index.ts`, `AnimeListResponse.filters` (line ~311-321), add after `hidden: string | null;`:
```ts
    discrepancies: string | null;
```

- [ ] **Step 6: Add the sidebar toggle.** In `src/components/anime/sidebar/FiltersSection.tsx`:

  (a) Extend the props interface (after `onHiddenOnlyChange`, line ~23):
```ts
  discrepanciesOnly: boolean;
  onDiscrepanciesOnlyChange: (v: boolean) => void;
```
  (b) Destructure them in the component signature (after `onHiddenOnlyChange,`, line ~38).
  (c) Add the checkbox inside the "Hidden only" `filterGroup` (after the hidden-only label, line ~89), reusing existing classes:
```tsx
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={discrepanciesOnly}
            onChange={(e) => onDiscrepanciesOnlyChange(e.target.checked)}
          /> MAL/SIMKL discrepancies only
        </label>
```

- [ ] **Step 7: Thread the toggle through `AnimeSidebar` + `index.tsx`.**

  (a) In `src/components/anime/AnimeSidebar.tsx`: add to the props interface (after `onHiddenOnlyChange`, line ~49) `discrepanciesOnly: boolean;` and `onDiscrepanciesOnlyChange: (v: boolean) => void;`; destructure them (line ~83); pass them into `<FiltersSection ... />` (line ~183-196):
```tsx
          discrepanciesOnly={discrepanciesOnly}
          onDiscrepanciesOnlyChange={onDiscrepanciesOnlyChange}
```
  (b) In `src/pages/index.tsx`: add a handler near `handleHiddenOnlyChange` (line ~238):
```ts
  const handleDiscrepanciesOnlyChange = (discrepanciesOnly: boolean) => {
    updateFilters({ discrepanciesOnly });
  };
```
  and pass to `<AnimeSidebar>` (near `hiddenOnly={filters.hiddenOnly}`, line ~338):
```tsx
      discrepanciesOnly={filters.discrepanciesOnly}
      onDiscrepanciesOnlyChange={handleDiscrepanciesOnlyChange}
```

- [ ] **Step 8: Add the effective-status seam helper.** Spec §5: centralize status reads so a future flip to SIMKL is a one-line change. In `src/lib/animeUtils.ts`, add (near the top-level exports; import `AnimeForDisplay` if not already imported):
```ts
/**
 * Single source of truth for an anime's "effective" personal status.
 * Returns MAL's status today (MAL is authoritative). A future switch to
 * SIMKL — or a MAL-then-SIMKL fallback — changes only this function.
 */
export function getEffectiveStatus(anime: AnimeForDisplay): string | undefined {
  return anime.my_list_status?.status;
}
```

- [ ] **Step 9: Route the two existing status-reads through the seam.**

  (a) In `src/pages/api/anime/animes/index.ts`, import `getEffectiveStatus` from `@/lib/animeUtils` (extend the existing `applyNarrowingFilters` import on line 3). In the status-filter block (line ~115-124), replace `const userStatus = anime.my_list_status?.status;` with:
```ts
        const userStatus = getEffectiveStatus(anime);
```
  (b) In `src/lib/recommendations.ts`, import `getEffectiveStatus` from `@/lib/animeUtils`. In the candidate hard-filter (line ~457), replace `const st = anime.my_list_status?.status;` with:
```ts
    const st = getEffectiveStatus(anime);
```
  (Leave the other `my_list_status` reads in `recommendations.ts` — seeds, rejection profile — unchanged; only the unseen-exclusion routes through the seam per spec §5.)

- [ ] **Step 10: Type-check + build.**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds. Behavior is unchanged — `getEffectiveStatus` returns MAL status, identical to the previous direct reads.

- [ ] **Step 11: Commit.**

```bash
git add src/lib/animeUrlParams.ts src/hooks/useAnimeUrlState.ts src/pages/api/anime/animes/index.ts src/models/anime/index.ts src/pages/index.tsx src/components/anime/AnimeSidebar.tsx src/components/anime/sidebar/FiltersSection.tsx src/lib/animeUtils.ts src/lib/recommendations.ts
git commit -m "Add discrepanciesOnly filter and effective-status seam

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Discrepancy badge component + render in card/table

**Files:**
- Create: `src/components/anime/SimklDiscrepancyBadge.tsx`, `src/components/anime/SimklDiscrepancyBadge.module.css`
- Modify: `src/components/anime/AnimeCardView.tsx`, `src/components/anime/AnimeTable.tsx`

**Interfaces:**
- Consumes: `AnimeForDisplay` (models).
- Produces: `<SimklDiscrepancyBadge anime={AnimeForDisplay} />` (renders nothing when `anime.discrepancy` is null).

- [ ] **Step 1: Create `SimklDiscrepancyBadge.module.css`.**

```css
.badge {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
  font-size: 0.72rem;
  line-height: 1.2;
}
.chip {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 0.1rem 0.35rem;
  color: var(--text-secondary);
  white-space: nowrap;
}
.mismatch {
  border-color: #b45309;
  color: #f59e0b;
}
.presence {
  border-color: var(--border-color);
  color: var(--text-secondary);
  opacity: 0.85;
}
.info {
  border-color: var(--border-color);
  color: var(--text-secondary);
  opacity: 0.7;
}
```

- [ ] **Step 2: Run css:types.**

Run: `npm run css:types`
Expected: creates `SimklDiscrepancyBadge.module.css.d.ts`.

- [ ] **Step 3: Create `SimklDiscrepancyBadge.tsx`.**

```tsx
import React from 'react';
import styles from './SimklDiscrepancyBadge.module.css';
import type { AnimeForDisplay, UserAnimeStatus } from '@/models/anime';

const STATUS_LABEL: Record<UserAnimeStatus, string> = {
  watching: 'Watching',
  completed: 'Completed',
  on_hold: 'On Hold',
  dropped: 'Dropped',
  plan_to_watch: 'Plan',
};

const fmtStatus = (s: UserAnimeStatus | null): string => (s ? STATUS_LABEL[s] : '—');

interface Props {
  anime: AnimeForDisplay;
}

const SimklDiscrepancyBadge: React.FC<Props> = ({ anime }) => {
  const d = anime.discrepancy;

  // No mismatch, but the title IS synced from SIMKL -> subtle "merge is visible"
  // chip so the user can see SIMKL's own status/score even when it agrees.
  if (!d) {
    if (!anime.simkl) return null;
    const parts = [fmtStatus(anime.simkl.status)];
    if (anime.simkl.score != null) parts.push(`★${anime.simkl.score}`);
    return (
      <span className={styles.badge} title="Synced from SIMKL">
        <span className={`${styles.chip} ${styles.info}`}>SIMKL: {parts.join(' ')}</span>
      </span>
    );
  }

  return (
    <span className={styles.badge} title="MAL vs SIMKL mismatch">
      {d.status && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          {fmtStatus(d.status.mal)} / {fmtStatus(d.status.simkl)}
        </span>
      )}
      {d.score && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          ★{d.score.mal ?? '—'} / ★{d.score.simkl ?? '—'}
        </span>
      )}
      {d.progress && (
        <span className={`${styles.chip} ${styles.mismatch}`}>
          {d.progress.mal ?? '—'} / {d.progress.simkl ?? '—'} ep
        </span>
      )}
      {d.presence && (
        <span className={`${styles.chip} ${styles.presence}`}>SIMKL only</span>
      )}
    </span>
  );
};

export default SimklDiscrepancyBadge;
```

- [ ] **Step 4: Render in card + table.** Read `src/components/anime/AnimeCardView.tsx` and `src/components/anime/AnimeTable.tsx` first to find the per-item render (each maps `animes` to a card/row and already reads `anime.my_list_status` for the status display). Import the badge at the top of each:
```tsx
import SimklDiscrepancyBadge from './SimklDiscrepancyBadge';
```
and render it next to where each item's personal status is shown (card: within the card's info/status area; table: in the status cell, after the existing status content):
```tsx
<SimklDiscrepancyBadge anime={anime} />
```
It self-hides when the title has neither SIMKL data nor a discrepancy, so unconditional placement is fine.

- [ ] **Step 5: Type-check.**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual dev-server verification.**

Start the dev server via the preview tool (config name from `.claude/launch.json`, or create one running `npm run dev` on port 3000). Load `/`. Since real SIMKL data requires an authenticated sync (Task 7 wires the button), verify here only that (a) the page renders with no console errors and (b) cards/table render normally with the badge absent (no `anime.discrepancy` yet). Take a screenshot to confirm no regression. Full data-path verification happens at the end of Task 7.

- [ ] **Step 7: Commit.**

```bash
git add src/components/anime/SimklDiscrepancyBadge.tsx src/components/anime/SimklDiscrepancyBadge.module.css src/components/anime/SimklDiscrepancyBadge.module.css.d.ts src/components/anime/AnimeCardView.tsx src/components/anime/AnimeTable.tsx
git commit -m "Render SIMKL discrepancy badge on cards and table rows

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: SIMKL account + sync sidebar section, wired end-to-end

The user-facing connect + sync. New sidebar section + all prop/state wiring + OAuth callback handling.

**Files:**
- Create: `src/components/anime/sidebar/SimklSection.tsx`, `src/components/anime/sidebar/SimklSection.module.css`
- Modify: `src/components/anime/sidebar/index.ts`, `src/components/anime/AnimeSidebar.tsx`, `src/pages/index.tsx`, `src/hooks/useAnimeUrlState.ts`

**Interfaces:**
- Consumes: SIMKL auth endpoints (`/api/anime/simkl/auth`), sync endpoint (`/api/anime/simkl/sync`).
- Produces: `<SimklSection>` with props `{ isConnected, userName, isAuthLoading, authError, isSyncing, syncMessage, onConnect, onDisconnect, onSync }`.

- [ ] **Step 1: Create `SimklSection.module.css`.**

```css
.simklSection { display: flex; flex-direction: column; gap: 0.5rem; }
.connectedAccount { display: flex; flex-direction: column; gap: 0.5rem; }
.buttonGroup { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.status { font-size: 0.8rem; color: var(--text-secondary); }
.error { color: #dc2626; font-size: 0.8rem; }
```

- [ ] **Step 2: Run css:types.**

Run: `npm run css:types`
Expected: creates `SimklSection.module.css.d.ts`.

- [ ] **Step 3: Create `SimklSection.tsx`.**

```tsx
import React from 'react';
import styles from './SimklSection.module.css';
import { Button } from '@/components/shared';

interface SimklSectionProps {
  isConnected: boolean;
  userName?: string;
  isAuthLoading: boolean;
  authError: string;
  isSyncing: boolean;
  syncMessage: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
}

const SimklSection: React.FC<SimklSectionProps> = ({
  isConnected, userName, isAuthLoading, authError, isSyncing, syncMessage,
  onConnect, onDisconnect, onSync,
}) => {
  return (
    <div className={styles.simklSection}>
      {isAuthLoading ? (
        <Button variant="secondary" disabled>Loading...</Button>
      ) : isConnected ? (
        <div className={styles.connectedAccount}>
          <span>Connected as <strong>{userName || 'SIMKL user'}</strong></span>
          <div className={styles.buttonGroup}>
            <Button onClick={onSync} disabled={isSyncing}>
              {isSyncing ? 'Syncing...' : 'Sync SIMKL'}
            </Button>
            <Button variant="primary-negative" onClick={onDisconnect}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={onConnect}>Connect to SIMKL</Button>
      )}
      {syncMessage && <div className={styles.status}>{syncMessage}</div>}
      {authError && <div className={styles.error}>{authError}</div>}
    </div>
  );
};

export default SimklSection;
```

- [ ] **Step 4: Export from the sidebar barrel.** In `src/components/anime/sidebar/index.ts`, add:
```ts
export { default as SimklSection } from './SimklSection';
```
(Match the existing export style in that file — read it first; if it uses `export { default as X }` per line, follow suit.)

- [ ] **Step 5: Add SIMKL state + handlers in `index.tsx`.** In `src/pages/index.tsx`, after the MAL sync state (line ~23), add SIMKL state:

```ts
  // SIMKL auth + sync state (not URL-controlled)
  const [simklConnected, setSimklConnected] = useState(false);
  const [simklUser, setSimklUser] = useState<string | undefined>(undefined);
  const [isSimklAuthLoading, setIsSimklAuthLoading] = useState(true);
  const [simklAuthError, setSimklAuthError] = useState('');
  const [isSimklSyncing, setIsSimklSyncing] = useState(false);
  const [simklSyncMessage, setSimklSyncMessage] = useState('');
```

Add a status checker (near `checkAuthStatus`, line ~39):

```ts
  const checkSimklStatus = async () => {
    try {
      setIsSimklAuthLoading(true);
      const response = await fetch('/api/anime/simkl/auth?action=status');
      const data = await response.json();
      setSimklConnected(!!data.isAuthenticated);
      setSimklUser(data.user?.user?.name);
    } catch (error) {
      console.error('Error checking SIMKL status:', error);
    } finally {
      setIsSimklAuthLoading(false);
    }
  };
```

Call it on mount — extend the mount effect (line ~109-112) to also call `checkSimklStatus();`.

Add handlers near the MAL auth handlers (line ~168):

```ts
  const handleSimklConnect = async () => {
    try {
      setIsSimklAuthLoading(true);
      setSimklAuthError('');
      const response = await fetch('/api/anime/simkl/auth?action=login');
      const data = await response.json();
      if (data.authUrl) window.location.href = data.authUrl;
      else { setSimklAuthError('Failed to initiate SIMKL authentication'); setIsSimklAuthLoading(false); }
    } catch (error) {
      console.error('Error connecting to SIMKL:', error);
      setSimklAuthError('Failed to connect to SIMKL');
      setIsSimklAuthLoading(false);
    }
  };

  const handleSimklDisconnect = async () => {
    try {
      setIsSimklAuthLoading(true);
      setSimklAuthError('');
      await fetch('/api/anime/simkl/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
      setSimklConnected(false);
      setSimklUser(undefined);
    } catch (error) {
      console.error('Error disconnecting from SIMKL:', error);
      setSimklAuthError('Failed to disconnect from SIMKL');
    } finally {
      setIsSimklAuthLoading(false);
    }
  };

  const handleSimklSync = async () => {
    if (!simklConnected) return;
    setIsSimklSyncing(true);
    setSimklSyncMessage('');
    try {
      const response = await fetch('/api/anime/simkl/sync', { method: 'POST' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Sync failed');
      setSimklSyncMessage(
        `${data.phase}: +${data.added} updated, ${data.removed} removed${data.orphansSkipped ? `, ${data.orphansSkipped} skipped (no MAL id)` : ''}`
      );
      loadAnimes();
    } catch (error) {
      setSimklSyncMessage(error instanceof Error ? error.message : 'Failed to sync SIMKL.');
    } finally {
      setIsSimklSyncing(false);
    }
  };
```

- [ ] **Step 6: Handle the SIMKL OAuth callback query.** In `index.tsx`, extend the OAuth-callback effect (line ~115-129) to also handle `simkl_auth`. Add, inside that effect, a parallel block:

```ts
    const simklAuthParam = router.query.simkl_auth;
    if (simklAuthParam) {
      if (simklAuthParam === 'success') checkSimklStatus();
      else setSimklAuthError('SIMKL authentication failed. Please try again.');
      const { simkl_auth, ...rest } = router.query;
      router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    }
```

  **Also fix the empty-URL redirect guard** so the callback param isn't wiped before this effect runs. In `src/hooks/useAnimeUrlState.ts` (line ~73), the redirect that sends param-less `/` to the default preset is whitelisted only for MAL's `auth` key; `simkl_auth` is neither in `PARAM_KEYS` (so `hasAnyParams` is false) nor whitelisted, so `/?simkl_auth=...` would bounce to the preset and drop the param (silently losing the `error` path). Extend the guard:
```ts
      if (!params.has('auth') && !params.has('simkl_auth') && !hasRedirected) {
```

- [ ] **Step 7: Thread SIMKL props into `AnimeSidebar`.** In `src/components/anime/AnimeSidebar.tsx`:

  (a) Add to the props interface (after the MAL Sync block, line ~33):
```ts
  // SIMKL
  simklConnected: boolean;
  simklUser?: string;
  isSimklAuthLoading: boolean;
  simklAuthError: string;
  isSimklSyncing: boolean;
  simklSyncMessage: string;
  onSimklConnect: () => void;
  onSimklDisconnect: () => void;
  onSimklSync: () => void;
```
  (b) Destructure them in the component signature (line ~76-90).
  (c) Import `SimklSection` from `./sidebar` (line ~7-15 import block).
  (d) Render a new `CollapsibleSection` immediately after the "Data Sync" section (line ~157):
```tsx
      <CollapsibleSection
        title="SIMKL"
        isExpanded={sidebarExpanded.simkl}
        onToggle={() => toggle('simkl')}
      >
        <SimklSection
          isConnected={simklConnected}
          userName={simklUser}
          isAuthLoading={isSimklAuthLoading}
          authError={simklAuthError}
          isSyncing={isSimklSyncing}
          syncMessage={simklSyncMessage}
          onConnect={onSimklConnect}
          onDisconnect={onSimklDisconnect}
          onSync={onSimklSync}
        />
      </CollapsibleSection>
```

- [ ] **Step 8: Pass SIMKL props from `index.tsx` into `<AnimeSidebar>`.** In the `sidebar` JSX (line ~316-357), add:
```tsx
      simklConnected={simklConnected}
      simklUser={simklUser}
      isSimklAuthLoading={isSimklAuthLoading}
      simklAuthError={simklAuthError}
      isSimklSyncing={isSimklSyncing}
      simklSyncMessage={simklSyncMessage}
      onSimklConnect={handleSimklConnect}
      onSimklDisconnect={handleSimklDisconnect}
      onSimklSync={handleSimklSync}
```

- [ ] **Step 9: Type-check + build.**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds.

- [ ] **Step 10: Manual dev-server verification (full data path).**

Start/refresh the dev server. On `/`:
- Confirm the new **SIMKL** sidebar section renders with a "Connect to SIMKL" button and no console errors.
- If SIMKL creds + a test account are available: connect, confirm redirect back to `/` shows "Connected as …"; click **Sync SIMKL**, confirm the status line reports `initial: +N updated …` and no console/network errors on `POST /api/anime/simkl/sync`.
- Toggle **"MAL/SIMKL discrepancies only"** in Filters; confirm the list narrows to titles whose merged record has a discrepancy, and that the badge renders on those cards/rows.
- Re-run **Sync SIMKL**; confirm the status line reports `noop` (watermark short-circuit) when nothing changed on SIMKL.

Take a screenshot of the connected sidebar + a discrepancy badge as proof. If no test account is available, verify at minimum that the section renders, the connect flow initiates (network shows `GET /api/anime/simkl/auth?action=login` returning an `authUrl`), and note that live-data steps are unverified.

- [ ] **Step 11: Commit.**

```bash
git add src/components/anime/sidebar/SimklSection.tsx src/components/anime/sidebar/SimklSection.module.css src/components/anime/sidebar/SimklSection.module.css.d.ts src/components/anime/sidebar/index.ts src/components/anime/AnimeSidebar.tsx src/pages/index.tsx src/hooks/useAnimeUrlState.ts
git commit -m "Wire SIMKL connect + sync sidebar section end-to-end

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Documentation

Record the integration in project memory so future work follows the pattern.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the env var row.** In `CLAUDE.md`'s "Environment variables" table, add rows:
```markdown
| `SIMKL_CLIENT_ID` | SIMKL OAuth app client ID (required query param on every SIMKL request) |
| `SIMKL_CLIENT_SECRET` | SIMKL OAuth token exchange (confidential client) |
| `SIMKL_APP_NAME` | Sent as `app-name` query param + `User-Agent` on SIMKL requests |
| `SIMKL_REDIRECT_URI` | SIMKL OAuth redirect URI |
```

- [ ] **Step 2: Add a SIMKL architecture section.** After the "MAL sync" section in `CLAUDE.md`, add:

```markdown
### SIMKL integration (read-only)

A second, read-only personal-data source alongside MAL. SIMKL data lives in a lean side-file `animes_SIMKL.json` (env `DATA_PATH`), **keyed by MAL id**, storing only SIMKL-unique personal fields (`SimklPersonalEntry`: status normalized to MAL vocabulary, score, progress, watched date, the `simkl` id). It is **joined onto MAL records in `getAnimeForDisplay()`** exactly like `animes_hidden.json` — MAL stays the catalog + authority; SIMKL never drives the existing status filters or reco unseen-exclusion (a deliberate seam for a future switch).

- Sync is **one-way (SIMKL → app), personal library only** (statused anime), following SIMKL's two-phase model (`docs/simkl/apirules.md`): initial `/sync/all-items/anime?extended=ids_only`, then `/sync/activities` + `date_from` deltas, with `simkl_sync_checkpoint.json` holding the `anime.all` watermark. Deletion reconciliation diffs `extended=simkl_ids_only` against the local store. Orchestration in [src/lib/simklSync.ts](src/lib/simklSync.ts); auth/state/watermark in [src/lib/simkl.ts](src/lib/simkl.ts); endpoints under `src/pages/api/anime/simkl/` (`auth`, `sync`). **No writes to SIMKL, ever.**
- **Discrepancy detection** ([src/lib/simklCompare.ts](src/lib/simklCompare.ts), client-safe/pure) compares MAL vs SIMKL status/score/progress and flags presence-on-one-side. Surfaced on the main page as a per-card `SimklDiscrepancyBadge` + a `discrepanciesOnly` (`disc`) URL filter. No dedicated SIMKL page.
- Deferred: SIMKL "big-sync" for catalog-wide **tags** (→ future `simklTags` reco source), MAL-internal discrepancies, flipping effective-status to SIMKL, and wiring SIMKL delta into cron-sync.
```

- [ ] **Step 3: Final full build + lint.**

Run: `npm run build && npm run lint`
Expected: build succeeds, lint clean.

- [ ] **Step 4: Commit.**

```bash
git add CLAUDE.md
git commit -m "Document SIMKL integration in CLAUDE.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Post-implementation notes

- **`animes_SIMKL.json` / `simkl_sync_checkpoint.json`** are new runtime data files under `DATA_PATH` (Docker volume). No migration needed — they're created on first sync.
- **The one live-API unknown** (SIMKL `/sync/all-items/anime` field names) is handled defensively in `normalizeItem` and must be confirmed against a real payload during Task 3/Task 7 (see the VERIFY-STEP callout in Task 3). If `user_rating` is NOT present inline, add a second `/sync/ratings/anime` call in `simklSync.ts` and merge ratings by SIMKL id before `upsertSimklEntries` — the spec anticipates this.
- **Presence-noise dial (known, not a bug):** every title watched on SIMKL but never added to MAL becomes a `presence: 'simkl_only'` discrepancy. If that set is large, "discrepancies only" may be dominated by presence entries, drowning the status/score/progress mismatches. Approved as-is for v1; if it proves noisy, a cheap refinement is to let the filter (or a sub-toggle) distinguish hard value-mismatches from soft presence — the `Discrepancy` shape already separates them.
- Memory update (do after merge): mark the SIMKL spike memory as shipped and point it at this plan.
