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
  media id — and `DELETE /v2/anime/{id}/my_list_status` for MAL. SIMKL has no
  equivalent. Until then the UI correctly offers "clear" only to a local-only user.
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
