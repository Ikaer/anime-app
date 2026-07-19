[X] Translate the app in multiple languages
[X] Setup a simple onboarding (fetch anilist unautahenticated)
[X] Provide a way to rate without loggin in a specific service (anilist, myanimelist, etc)
[] Add chips on data provenance (anilist, myanimelist, etc)
[X] Performance improvements
[] Make a few things settable (main title language - main user language - etc)
[] Promote the app on github (readme/screenshots/setup)
[] Do a swipe system
[~] Do stuff around character and seyuu — cast section SHIPPED 2026-07-19: characters + JP seiyuu
    with photos on the detail page, from AniList, in an off-hot-path lazily-filled slice
    (animes_anilist_cast.json). Still open: seiyuu as a reco source / a "more from this seiyuu"
    browse page (both need catalog-wide cast, which this deliberately does not fetch).
[X] AniList OAuth — login + SaveMediaListEntry write-back SHIPPED 2026-07-18, live-verified on
   a real account (spec: docs/ANILIST-OAUTH.md, now WIP). Landed as a 4th PersonalWriter in
   src/lib/personalWriters.ts and flips hasWritableExternal(), so tier/quick-rate/detail all
   push to AniList once connected.
[] AniList — the authenticated PRIVATE-LIST READ (the other half of the spec). The import in
   src/lib/anilistPersonalSync.ts is still anonymous-by-username and doesn't send the viewer
   token, so private profiles still can't be read. Also still open: AniList is excluded from
   discrepancy detection until that exclusion gets a token gate (see store.ts
   buildProviderStates).
[] Entry DELETION across providers — removing a status is a distinct Delete action on the list
   entry in BOTH AniList and MAL (not a status value), so today every remote writer refuses
   `status: null` with a reason. Fix belongs in the registry, not per-provider: add an optional
   deleteEntry(ctx) to PersonalWriter, route status:null to it in writePersonal, then implement
   DeleteMediaListEntry(id:) for AniList — takes the LIST ENTRY id, not the media id — and
   DELETE /v2/anime/{id}/my_list_status for MAL. SIMKL has no equivalent.
[] Betaseries provider — the second writable external. Same shape: sync + a PersonalWriter.
   Note it's a full list (not a subset feed like SIMKL), so it likely joins PRESENCE_ANCHORS
   in src/lib/discrepancy.ts.
[] Discrepancy page utilities — SIMKL auto-syncs from MAL but the others don't, so the page
   will be noisy once more providers land:
   - provider checkboxes to filter rows out (URL state, like the rest of the app)
   - one-way "fully sync provider A => provider B" jobs, to clear a whole class at once