[X] Translate the app in multiple languages
[X] Setup a simple onboarding (fetch anilist unautahenticated)
[X] Provide a way to rate without loggin in a specific service (anilist, myanimelist, etc)
[] Add chips on data provenance (anilist, myanimelist, etc)
[X] Performance improvements
[] Make a few things settable (main title language - main user language - etc)
[] Promote the app on github (readme/screenshots/setup)
[] Do a swipe system
[~] Do stuff around character and seyuu — cast section shipped (characters + JP seiyuu with
    photos on the detail page). Still open: seiyuu as a reco source / a "more from this
    seiyuu" browse page (both need catalog-wide cast, which the sweep deliberately skips).
[X] AniList OAuth — login + SaveMediaListEntry write-back (spec: docs/ANILIST-OAUTH.md)
[X] AniList — the authenticated PRIVATE-LIST READ (viewer's own list by userId, private
   entries included; the anonymous by-username tier was removed, which closed the AniList
   discrepancy exclusion for free)
[X] MAL catalog/personal split (PROVIDER-PARITY H1)
[X] Data-store layout — folders instead of filename prefixes (spec: docs/DATA-LAYOUT.md)
[] Entry DELETION across providers — removing a status is a distinct Delete action on the list
   entry in BOTH AniList and MAL (not a status value), so today every remote writer refuses
   `status: null` with a reason. Fix belongs in the registry, not per-provider: add an optional
   deleteEntry(ctx) to PersonalWriter, route status:null to it in writePersonal, then implement
   DeleteMediaListEntry(id:) for AniList — takes the LIST ENTRY id, not the media id — and
   DELETE /v2/anime/{id}/my_list_status for MAL. SIMKL has no equivalent.
[] Retire user/reco_dismissed.json + getDismissedIds — the legacy read-only pre-👎 store.
   Deleting it resurrects every dismissed title into the feed, so this is a data decision,
   not a code one. (Was the last open item in the now-deleted docs/CLEANUP.md.)
[] Discrepancy page utilities — SIMKL auto-syncs from MAL but the others don't, so the page
   will be noisy once more providers land:
   - provider checkboxes to filter rows out (URL state, like the rest of the app)
   - one-way "fully sync provider A => provider B" jobs, to clear a whole class at once
