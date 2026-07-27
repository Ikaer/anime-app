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
  - **MAL's leg is UNVERIFIED**: the stored MAL token is expired
    (`tokenValid: false`), so `DELETE /v2/anime/{id}/my_list_status` was desk-checked
    only — same URL `updateMalListStatus` already builds, different method. Re-auth
    MAL before implementing, and confirm what it answers for an absent entry.
  - **SIMKL is not simply "no equivalent"**: `POST /sync/history/remove` exists
    (docs/simkl/apirules.md), and `activities.anime.removed_from_list` is how the
    app already detects removals. The real reason to leave SIMKL out is narrower —
    its declared `write` is `['score']`, so a delete would be a *second* carve-out
    in an otherwise one-way-in sync. Note also that a registry SIMKL id exists
    **iff** the title is in the SIMKL list (663 of 25,382, exactly the 663 personal
    entries), so "has a SIMKL id" and "has an entry to delete" are one condition.
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
