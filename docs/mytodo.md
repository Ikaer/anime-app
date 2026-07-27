# Open items

Everything shipped has been removed — git has it. Closed *rulings* (things
deliberately not done) live in [DECISIONS.md](DECISIONS.md), not here.

## Features

- **Entry deletion across providers.** Removing a status is a distinct *Delete*
  action on the list entry in both AniList and MAL, not a status value, so every
  remote writer currently refuses `status: null` with a reason. The fix belongs in
  the registry, not per provider: add an optional `deleteEntry(ctx)` to
  `PersonalWriter`, route `status: null` to it in `writePersonal`, then implement
  `DeleteMediaListEntry(id:)` for AniList — it takes the **list entry** id, not the
  media id — and `DELETE /v2/anime/{id}/my_list_status` for MAL. Until then the UI
  correctly offers "clear" only to a local-only user.

  **Investigated 2026-07-27 against the live account** (AniList media 21450,
  JoJo Part 4 / `a_10130`; deleted and restored in one run). What the design
  now has to account for:

  - **The list-entry id is free, so it is not the obstacle the item assumed.**
    `MediaListCollection` returns `entries { id }` for all 680 entries on the
    query `importAnilistPersonalList` **already runs** — one extra field in
    `LIST_SELECTION` plus an `entry_id` on `AniListPersonalEntry`, no second call.
  - **…but a stored entry id goes stale.** Delete-then-recreate mints a NEW one
    (576959147 → 583805092 on the same media). And `reflectLocally` in `push.ts`
    writes entries with no `entry_id` at all. So `deleteEntry` needs the shape
    `resolveAnilistMediaId` already has: use the slice value, fall back to a live
    `MediaList(userId:, mediaId:)` lookup, which returns the id directly.
  - **Delete is NOT idempotent.** A second `DeleteMediaListEntry` on a gone id is
    HTTP **400** `validation: { id: ["The selected id is invalid."] }`, not
    `deleted: false`. The writer must map that to success ("already absent"), or
    a retry reports a failure that isn't one.
  - **Absence reads as 404 + `data.MediaList: null`** — the same idiom `cast.ts`
    already treats as "AniList doesn't have this", not as an error. Reuse it.
  - **MAL behaves the OPPOSITE way to AniList on both counts** (verified live on
    anime 31933 after pulling a prod token). `DELETE /v2/anime/{id}/my_list_status`
    → **200** with an empty-array body; absence is then the single-title GET simply
    **omitting `my_list_status`** (the anime still resolves 200 — no 404); and a
    second DELETE is **also 200**, i.e. it IS idempotent. So `deleteEntry` cannot
    share one error convention across the two providers: MAL's "already gone" is a
    success code, AniList's is a 400 validation error. Note MAL's PUT restore
    returns fields the app doesn't model (`priority`, `tags`, `comments`,
    `num_times_rewatched`, `rewatch_value`) — a delete drops those too, and the
    app cannot put them back.
  - **Checked and cleared**: a score-only `PUT /my_list_status` does NOT reset the
    status (`dropped` survived a `score=5` write). `updateMalListStatus`'s
    partial-patch assumption is correct — MAL's PUT is not a full replace.
  - **SIMKL is not simply "no equivalent"**: `POST /sync/history/remove` exists
    (docs/simkl/apirules.md), and `activities.anime.removed_from_list` is how the
    app already detects removals. The real reason to leave SIMKL out is narrower —
    its declared `write` is `['score']`, so a delete would be a *second* carve-out
    in an otherwise one-way-in sync. Note also that a registry SIMKL id exists
    **iff** the title is in the SIMKL list (663 of 25,382, exactly the 663 personal
    entries), so "has a SIMKL id" and "has an entry to delete" are one condition.
  - ⚠️ **A SIMKL rating is not score-only in effect — it CREATES the list entry,
    with status `watching`.** Verified live: rating a title SIMKL had never seen
    (`a_10130`, matched by MAL id since the crosswalk had no SIMKL id) added it to
    the list as `watching`, and the registry gained `simkl: 532312` + slug/kitsu/
    anidb. So `PROVIDER_CAPABILITIES.simkl.personal.write = ['score']` describes
    what the app *sends*, not what SIMKL *does* — a score write has a
    list-membership side effect the app neither models nor can undo (it has no
    status write to correct the `watching` with). Whatever `deleteEntry` does for
    SIMKL, this is the asymmetry it lands in.
  - **Trap in the current code**: `writePersonal` runs every `writeLocal` before
    any remote, and both `malWriter.writeLocal` and `anilistWriter.writeLocal`
    happily apply `status: null` — while every `writeRemote` refuses it. Reachable
    only because `canClearStatus()` gates the UI to local-only installs today;
    routing `status: null` to `deleteEntry` without fixing that asymmetry turns a
    refused remote delete into a permanent phantom discrepancy.
- **Settable preferences** — main title language, etc. `defaultTitleLanguage` is
  the real one: its rendering seam `getPrimaryTitle` is English-hardcoded across
  ~15 server + client call sites, so it is a cross-cutting change. Note it is a
  **server-side** knob (titles render in `getServerSideProps`), unlike the FR/EN
  **UI** language which is client `localStorage` — two different knobs, easily
  conflated.
- **Producers as a catalog field.** They exist only on `AniListCastEntry.studios`
  with `isMain: false`, and that slice is deliberately off the hot-path join, so
  coverage is whatever the cast sweep has reached. Do it as one task with its
  consumer: model field + `catalogFromAnilist` + the `/stats` read + coverage/dedup
  against the cast slice + a re-sweep. Weigh it against the reason cast is
  off-join at all — `catalog/anilist.json` is parsed on every cold row build.
- **Swipe system.**
- **Seiyuu as a reco source, or a "more from this seiyuu" browse page.** Both need
  catalog-wide cast, which the sweep deliberately skips (it covers the statused
  list, ~500-700 titles, not the ~25k catalog).
- **Discrepancy page utilities.** SIMKL auto-syncs from MAL but the others don't,
  so the page gets noisier as providers land: provider checkboxes to filter rows
  out (URL state, like the rest of the app), and one-way "fully sync provider A ⇒
  provider B" jobs to clear a whole class at once.
- **Promote the app on GitHub** — readme, screenshots, setup.

## Chores

- **The guided first-run wizard.** Per-field editing all exists; only the
  onboarding funnel is missing. (The empty-store onboarding that *does* exist is a
  different thing — it seeds the catalog, not the config.)
- **`personal/anilist.json` can be clobbered.** The writer reflects a push into
  the slice, but a subsequent full import replaces it wholesale. Harmless in
  practice — the push landed on AniList, so the next import reads it back — but
  the slice is not a durable local-only store the way `personal/local.json` is.

## Undecided

- **Ship AniList OAuth enabled by default, or self-host opt-in?** Registering the
  OAuth app is a deployer cost. Product call.
- **Credits routing namespace** — the one genuinely open half of the studio id
  question. See [CREDITS-ID-NAMESPACE.md](CREDITS-ID-NAMESPACE.md).
