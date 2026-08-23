# Open items

Everything shipped has been removed — git has it. Closed *rulings* (things
deliberately not done) live in [DECISIONS.md](DECISIONS.md), not here.

## Features

- **Youtube** - I watch some anime on youtube (specially mini, ova, etc) and I would like to have a way to add them to my list. I know that
  there is a way to add them manually, but it is not very practical. I would like
  to have a way to add them automatically, like the other providers.
- **Settable preferences.** The main title language **shipped** — it landed as a
  `ViewDefaults` display key (`titleLanguage`), not a top-level settings field,
  so it rides the existing sparse storage + `useViewDefaults` transport; see the
  "Title language" section of CLAUDE.md. Whatever comes next here (episode-count
  display, date format…) should follow that same seam rather than growing
  `AppSettings`.
- **Producers as a catalog field.** They exist only on `AniListCastEntry.studios`
  with `isMain: false`, and that slice is deliberately off the hot-path join, so
  coverage is whatever the cast sweep has reached. Do it as one task with its
  consumer: model field + `catalogFromAnilist` + the `/stats` read + coverage/dedup
  against the cast slice + a re-sweep. Weigh it against the reason cast is
  off-join at all — `catalog/anilist.json` is parsed on every cold row build.
- **Swipe system.**
- **Seiyuu as a reco source.** Needs catalog-wide cast, which the sweep
  deliberately skips (it covers the statused list, ~500-700 titles, not the ~25k
  catalog) — at the shared AniList throttle that is a ~14h sweep, so the sweep is
  the project, not a footnote. (The "more from this seiyuu" browse half of this
  item **shipped**: `/credits/seiyuu/[id]`, via `listAnimeBySeiyuu`, declaring its
  partial coverage as `castCovered`.)
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
