[X] Translate the app in multiple languages
[X] Setup a simple onboarding (fetch anilist unautahenticated)
[X] Provide a way to rate without loggin in a specific service (anilist, myanimelist, etc)
[] Add chips on data provenance (anilist, myanimelist, etc)
[X] Performance improvements
[] Make a few things settable (main title language - main user language - etc)
[] Promote the app on github (readme/screenshots/setup)
[] Do a swipe system
[] AniList OAuth — finish the provider so ratings sync there too (spec: docs/ANILIST-OAUTH.md,
   status Todo). Today AniList is read-only/anonymous; OAuth unlocks private-list read +
   SaveMediaListEntry write-back. Lands as a 4th PersonalWriter in src/lib/personalWriters.ts
   and flips hasWritableExternal().
[] Betaseries provider — the second writable external. Same shape: sync + a PersonalWriter.
   Note it's a full list (not a subset feed like SIMKL), so it likely joins PRESENCE_ANCHORS
   in src/lib/discrepancy.ts.
[] Discrepancy page utilities — SIMKL auto-syncs from MAL but the others don't, so the page
   will be noisy once more providers land:
   - provider checkboxes to filter rows out (URL state, like the rest of the app)
   - one-way "fully sync provider A => provider B" jobs, to clear a whole class at once