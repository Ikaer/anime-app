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
[X] AniList — the authenticated PRIVATE-LIST READ. Was already implemented (viewer's own list by
   userId, private entries included); 2026-07-20 the anonymous by-username tier was REMOVED so the
   import is authenticated-only. That closed the AniList discrepancy exclusion for free — no token
   gate needed, since an entry in the slice now always belongs to a connected account. The state
   extractors moved from store.ts to src/lib/personalState.ts, shared with hydration.
[X] MAL catalog/personal split (PROVIDER-PARITY H1) SHIPPED 2026-07-21, migrated in production.
   MAL's personal state left animes_mal.json for its own slice animes_mal_personal.json
   (MALPersonalEntry, keyed by canonical id), so a rating write no longer rewrites the 39 MB
   catalog and MALAnime is pure catalog. Migration: scripts/migrate-mal-personal.js (idempotent,
   backed by a refuse-to-start boot guard). A per-provider-total fix rode along — each provider's
   fully-watched check now uses its OWN catalog's episode count, and status==='completed' counts
   as fully-watched whatever the count.
[] Data-store layout — folders instead of filename prefixes, plus sweeping 4 orphan files
   (ratings.json, rating_criteria.json, animes_extensions.json, user_preferences.json) and 2
   stale .bak files. Spec: docs/DATA-LAYOUT.md. UNBLOCKED — H1 is done, so personal/ now holds
   one file per ProvenanceSource (4 of 4). This is the natural next step.
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