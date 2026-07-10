# Codebase cleanup — progress tracker

> **This is NOT a changelog.** It is a progress-tracking document, and nothing else.
>
> Do not append summaries of work you did, notes about what you learned, dated
> entries, or "✅ also fixed X while I was in there". The only edit this file
> should ever receive is a **status cell moving from `Todo` → `WIP` → `Done`** (and,
> rarely, a new row when a genuinely new cleanup item is discovered).
>
> If an item turns out to be wrong, unnecessary, or superseded, set its status to
> `Dropped` and put the one-line reason in the Notes cell. Keep it terse.
> Everything else belongs in the git history, not here.

Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`

---

## Context

The app started MAL-only. SIMKL and AniList were added later as suffixed variants
(`/x` vs `/xSimkl` vs `/xAniList`) without ever renaming the original to `/xMal`.
The result is that "no prefix" silently means "MAL", across types, modules, API
routes, log channels, hook return values and data files. Most items below are
that one problem, seen from different angles.

Items are grouped by **blast radius**, not by importance. Sections 4 and 5 are
mechanical and carry no design risk — they are the sensible place to start.
Section 1 is the only one that stops the problem from recurring.

---

## 1. Structural root — high effort, high risk

Do not treat these as quick wins. Each is a design decision.

| # | Status | Item | Notes |
|---|--------|------|-------|
| 1.1 | Todo | Split `lib/anime.ts` (876 lines) into `lib/store.ts` + `lib/mal.ts` + `lib/malSync.ts` | It is currently three modules in one: JSON store, MAL HTTP client, sync orchestration. SIMKL already has this split (`simkl.ts` / `simklSync.ts` / `simklWrite.ts`). **This is the cheapest fix for most of the naming smell** — functions that land in `store.ts` are about the *local record* and drop the `MAL` prefix (`saveMALAnime` → `saveAnime`); functions in `mal.ts` genuinely are about MAL and keep it. |
| 1.2 | Todo | `AnimeForDisplay extends MALAnime` — decouple the local record from the MAL API shape | [models/anime/index.ts:157](../src/models/anime/index.ts). The local cache record literally inherits a MAL response (`my_list_status`, `main_picture`, `num_list_users`), with SIMKL/AniList bolted on as optional side-objects. Contradicts the "local cache authority / sources are interchangeable refill pipes" model in CLAUDE.md. Target shape ≈ `AnimeRecord { id, crosswalk, catalog, personal, sources: { mal, simkl, anilist } }`. Touches nearly every file — decide before starting. |

---

## 2. Renames that are free (all callers in-repo)

| # | Status | Item | Notes |
|---|--------|------|-------|
| 2.1 | Todo | Nest `useConnections` return value as `{ mal, simkl, anilist }` | Currently a flat bag of ~28 values where `authState` / `isSyncing` / `isBigSyncing` / `onConnect` / `onSync` mean MAL, sitting next to `simklConnected` / `onSimklSync` / `onAnilistTagsSync`. Nesting removes the prefixes and shrinks every consumer. |
| 2.2 | Todo | `LogSource` channel names | [connectionLog.ts:9](../src/lib/connectionLog.ts). `mal-auth`/`simkl-auth` are symmetric; then `sync`, `big-sync`, `historical-crawl`, `refresh` (MAL implied) vs `simkl-sync`, `anilist-tags-sync`. |
| 2.3 | Todo | Move MAL API routes under `/api/anime/mal/` | `auth`, `sync`, `big-sync`, `historical-crawl` → `mal/*`, matching `simkl/*` and `anilist/*`. |
| 2.4 | Blocked | ⚠️ Do **not** rename `/api/anime/cron-sync` | Called by an external cron job on the NAS with `CRON_SECRET`. Renaming breaks configuration that lives outside this repo. Left here so nobody "fixes" it as part of 2.3. |
| 2.5 | Todo | AniList "tags" is now a lie — rename to `anilistMeta` | `animes_anilist_tags.json`, `AniListTagsEntry`, `getAllAnilistTags`, `getAnilistTagsCount`, `performAnilistTagsSync`, `/anilist/tags-sync`, `anilistTagStats` all carry tags **+ staff + `banner_image`**. Note the data-file rename is gated by §3. |
| 2.6 | Todo | Fix AniList casing drift | `AniList*` types vs `Anilist*` functions vs `anilist*` variables. Pick one. |
| 2.7 | Todo | `recommendations_MAL.json` stale suffix | Now also stores `anilistSeeds`. Data-file rename gated by §3. |
| 2.8 | Done | `SeasonInfo` declared three times | [models/anime/index.ts:224](../src/models/anime/index.ts) (unused), [animeUtils.ts:107](../src/lib/animeUtils.ts) (local, shadows it), [SeasonSelector.tsx:7](../src/components/anime/SeasonSelector.tsx) (the one actually imported). Keep one. |

---

## 3. Renames that need a data migration

These are files on the NAS volume. Renaming without a dual-read fallback
**silently destroys state on the next deploy**.

| # | Status | Item | What breaks if renamed blind |
|---|--------|------|------------------------------|
| 3.0 | Todo | Decide: migrate, or leave filenames alone and only fix code names | Recommendation: **leave the filenames**. The code-level names are what hurt daily. If you do migrate, add `readJsonFile(newPath, oldPath, default)` that rewrites to the new name on first read, then land 3.1–3.4 behind it. |
| 3.1 | Todo | `mal_auth.json` | You get logged out. |
| 3.2 | Todo | `recommendations_feedback.json` | All 👍/👎 verdicts vanish. |
| 3.3 | Todo | `sync_checkpoint.json` → e.g. `mal_season_checkpoint.json` | Historical crawl restarts from 1960. It is the *seasonal crawl* checkpoint, not a sync checkpoint — and it sits next to `simkl_sync_checkpoint.json`, which genuinely is one. |
| 3.4 | Todo | `animes_MAL.json`, `recommendations_MAL.json`, `animes_anilist_tags.json` | Full re-sync / re-fetch. |

---

## 4. Straight duplication — safe, mechanical, no design decision

| # | Status | Item | Notes |
|---|--------|------|-------|
| 4.1 | Todo | `fetchSeasonalAnime` exists twice, near-verbatim | [lib/anime.ts:640](../src/lib/anime.ts) and [api/anime/sync.ts:138](../src/pages/api/anime/sync.ts). |
| 4.2 | Todo | The 27-entry MAL `fields` array is copy-pasted **five** times | [anime.ts:592](../src/lib/anime.ts), [anime.ts:650](../src/lib/anime.ts), [recommendations.ts:160](../src/lib/recommendations.ts), [refresh.ts:27](../src/pages/api/anime/animes/[id]/refresh.ts), [sync.ts:144](../src/pages/api/anime/sync.ts). Adding one MAL field today means remembering all five. |
| 4.3 | Done | Extract `lib/jsonStore.ts` | `DATA_PATH` redeclared in 5 files; `readJsonFile`/`writeJsonFile` in 3; `ensureDataDirectory` in 4. |
| 4.4 | Todo | Extract a `requireMalToken(res)` guard | The preamble `const { token } = getMALAuthData(); if (!token \|\| !isMALTokenValid(token)) return res.status(401)…` appears verbatim in **seven** routes. |
| 4.5 | WIP | Season arithmetic implemented three times | [anime.ts:254](../src/lib/anime.ts), [api/anime/sync.ts:31](../src/pages/api/anime/sync.ts), and [animeUtils.ts:110](../src/lib/animeUtils.ts) (`getSeasonInfos` — the good one the other two should call). |

---

## 5. Dead code — verified unreferenced, safe to delete

| # | Status | Item | Notes |
|---|--------|------|-------|
| 5.1 | Done | Delete `AnimeUserPreferences`, `AnimeFilters`, `AnimeSortOptions`, `MediaType`, `AnimeView`, `CalendarAnimeView`, `AnimeViewHelper` + `animeViewsHelper` | [models/anime/index.ts](../src/models/anime/index.ts). ~40 lines of exhaustiveness scaffolding for a view system that no longer exists. |
| 5.2 | Done | Delete `models/shared/` entirely | Once `CalendarAnimeView` (5.1) is gone, `LiteralSubset` — the folder's only export — is unused. |
| 5.3 | Done | Remove stale comments describing removals that already happened | [anime.ts:6-7](../src/lib/anime.ts) and [anime.ts:213](../src/lib/anime.ts). |
| 5.4 | Done | `LOGS_PATH` is documented in CLAUDE.md and set in `docker-compose.yml`, but **never read in `src/`** | Wired up: `connectionLog.ts` now writes to `LOGS_PATH`, falling back to `DATA_PATH`. The existing `connection_log.json` under `DATA_PATH` is orphaned on next deploy (rolling 500-entry UI log, not durable state). |
| 5.5 | Todo | Retire `recommendations_dismissed.json` + `getDismissedIds` | Legacy read-only pre-👎 store. At some point it stops being worth carrying. Deleting it resurrects every dismissed title into the feed, so this is a data decision, not a code one. |
| 5.6 | Done | `docs/TODO.md` is entirely checked off | Delete or archive. |
| 5.7 | Done | Drop `export` from symbols only referenced inside their own file | Not dead, just leaking a wider API than intended: `getSeeds`, `seedWeight`, `getFeedback`, `saveRecommendationsData`, `TUNING` (`recommendations.ts`); `encodeFiltersToParams`, `decodeUrlToFilters`, `encodeDisplayToParams`, `decodeUrlToDisplay` (`animeUrlParams.ts`); `updatePersonalStatus`, `getSyncCheckpoint` (`anime.ts`). |

---

## 6. Convention drift

| # | Status | Item | Notes |
|---|--------|------|-------|
| 6.1 | Todo | CLAUDE.md says "all component styles use CSS Modules", but there are **nine `<style jsx>` blocks** | All of them in pages: `anime/[id].tsx`, `tier.tsx`, `recommendations.tsx`, `connections.tsx`. The real rule seems to be "components use modules, pages use styled-jsx". Either enforce the stated rule or write down the actual one. |
| 6.2 | Todo | Two routes log to stdout instead of the connection log panel | [api/anime/sync.ts](../src/pages/api/anime/sync.ts) has 13 `console.log` and [auth.ts](../src/pages/api/anime/auth.ts) has 9, while every other sync path reports through `appendLog`. Those two are invisible in the UI log. |

---

## Audited and found clean — do not re-audit

- **Every `my_list_status` read outside the `getEffectiveStatus`/`getEffectiveScore`/`getEffectiveProgress` seam is intentional**: card/table display (deliberately not flipped), `computeDiscrepancy`'s raw-MAL-vs-raw-SIMKL compare, and the MAL write paths. Zero real violations.
- The `MoreLikeThis.module.css` copy of the translucent-panel style is deliberate (documented in CLAUDE.md).
- No orphaned `.module.css` files; no unused components.
