# Simkl API Rules

Sources: Simkl API dashboard rules (screenshot) + the official [sync guide](https://api.simkl.org/guides/sync). The guide is the more authoritative/detailed source — where the two disagree (endpoint paths in particular), the guide wins. Confirmed empirically: the bare `/sync/anime` endpoint always returns `200 null`; the real endpoint is `/sync/all-items/anime`.

## Two-phase sync model

Simkl's model: **one-time initial pull, then incremental deltas via `/sync/activities` + `date_from`.**

### Phase 1 — Initial sync (no saved timestamp yet)

Call these **sequentially, not in parallel** (avoids CPU spikes client- and server-side):

```
GET /sync/all-items/shows
GET /sync/all-items/movies
GET /sync/all-items/anime
```

No `date_from` on these first calls. Once done, call `/sync/activities` once and save the `activities.all` timestamp as your sync watermark.

### Phase 2 — Continuous sync loop

1. **Check activities:**
   ```
   GET /sync/activities?client_id=...&app-name=...&app-version=...
   ```
   Response shape:
   ```json
   {
     "all": "2026-05-08T14:23:11Z",
     "settings": { "all": "..." },
     "tv_shows": { "all": "...", "watching": "...", "plantowatch": "...", "hold": "...", "completed": "...", "dropped": "...", "rated_at": "...", "playback": "...", "removed_from_list": "..." },
     "movies": { "...": "..." },
     "anime": { "all": "...", "watching": "...", "plantowatch": "...", "hold": "...", "completed": "...", "dropped": "...", "rated_at": "...", "playback": "...", "removed_from_list": "..." }
   }
   ```
2. **Compare timestamps.** If `activities.all` (or, for a single-type/anime-only app, `activities.anime.all`) matches your last saved value, stop — nothing changed, no further calls needed.
3. **Fetch the delta**, passing the saved timestamp back **exactly as received** (ISO 8601 UTC, never reformatted):
   - Multi-type apps: `GET /sync/all-items?date_from=...`
   - Single-type apps (this app is anime-only): `GET /sync/all-items/anime?date_from=...`

`date_from` is cumulative — even after weeks/months offline, one call with the old saved timestamp returns everything that changed since. No max age.

**With `date_from`, the response is summary-only** (status, counters, `last_watched`/`next_to_watch`) — no per-episode `seasons[].episodes[]` unless you add `extended=full` (see below).

## `/sync/all-items` path segments

```
/sync/all-items                  → all types, all statuses
/sync/all-items/{type}           → one type (shows | movies | anime), all statuses
/sync/all-items/{type}/{status}  → one type, one status
```

Both segments are optional; narrow the request to cut payload size. Status values: shows/anime → `watching, plantowatch, hold, completed, dropped`; movies → `plantowatch, completed, dropped` (no `watching`/`hold`).

## Useful query parameters on `/sync/all-items`

| Parameter | Effect |
|---|---|
| `extended=simkl_ids_only` | Only `ids.simkl` per item — for deletion reconciliation |
| `extended=ids_only` | Adds external IDs (imdb, tmdb, tvdb, **mal**, etc.) |
| `extended=full` | Full metadata (posters, overview, ratings) — always pair with `date_from` |
| `extended=full_anime_seasons` | Anime: TVDB season mappings at show + episode level |
| `episode_watched_at=yes` | Per-episode watched timestamps — response gets significantly larger |
| `include_all_episodes=yes` | Loads episodes for completed/dropped items (normally skipped) |
| `next_watch_info=yes` | For `watching` items, adds `next_to_watch_info` |
| `episode_tvdb_id=yes` | Adds `ids.tvdb_id` per episode |
| `memos=yes` | User's per-item memo (≤140 chars) + `is_private` |
| `anime_type=…` | Filter: tv, movie, ova, ona, special, music video |
| `language=en` | Force English titles over the user's profile language |

## Detecting deletions / removals

`date_from` only surfaces additions and modifications, **never removals**.

1. Watch `/sync/activities`'s `removed_from_list` timestamp per type.
2. When it changes, refetch the full library with `extended=simkl_ids_only` (or `ids_only`).
3. Diff against the local cache — any previously-known `ids.simkl` missing from the response has been removed.
4. Clear any locally stored rating for it — Simkl wipes the rating when an item leaves the list.

## Write endpoints (not yet used by this app)

All write endpoints accept **arrays** — batch items into one call instead of N calls.

```
POST /sync/history            # mark watched: { movies: [...], shows: [{ ids, seasons: [{ number, episodes: [{number}] }] }] }
POST /sync/history/remove     # same payload shape, removes instead
POST /sync/add-to-list        # { to: "plantowatch", movies: [{ ids }] }
POST /sync/ratings            # { movies: [{ rating, ids }] }
```

`ids` accepts (in fallback order, then falls back to title/year matching): `simkl, imdb, tmdb, tvdb, mal, anidb, anilist, kitsu, livechart, anisearch, animeplanet, netflix, letterboxd, traktslug, crunchyroll, hulu`.

**Rewatch tracking** (`allow_rewatch=yes` on `POST /sync/history`) is Simkl Pro/VIP only, requires checking `account.type` from `/users/settings` first, enforces a 48h minimum gap between watches, caps at 50 rewatches/item — do not enable until fully read up on it.

## Rate limits

- **Per-user write lock:** Simkl serializes sync writes with a **20-second per-user lock**. Concurrent writes get `400 { "error": "rate_limit", "error_description": "Another sync is in progress for this user, please retry later." }` — on this, wait and retry once; don't hammer it.
- **POST requests generally:** capped at **1 request/second** per client; exceeding it triggers temporary throttling.
- Repeated rule violations (skipping `date_from`, polling without checking activities first) can get a `client_id` suspended. High-volume plans should DM Simkl on Discord first to get the implementation checked.

## Polling triggers (client-side, not yet relevant until we build continuous sync)

- App launch, wake from background — throttle to once per 15–30 min on mobile/TV.
- Media servers: hook into library-scan-complete or post-playback events.
- Manual pull-to-refresh always allowed.
- **Never** run an unconditional background polling timer without active user interaction.

## Required on every authenticated request

Confirmed empirically — this applies even to undocumented endpoints like `/users/settings`, not just the sync endpoints. Omitting `client_id` gives `412 { "error": "client_id_failed" }` even with a valid token.

**Query parameters:** `client_id`, `app-name`, `app-version`
**Headers:** `Authorization: Bearer ACCESS_TOKEN`, `User-Agent: app-name/version`

## Misc gotchas

- `watched_at` near `1970-01-01T00:00:01Z` is Simkl's "a very long time ago" placeholder, not a corrupt date.
- Single-type (anime-only) apps can poll `activities.anime.all` instead of the top-level `activities.all` to skip irrelevant show/movie changes.
