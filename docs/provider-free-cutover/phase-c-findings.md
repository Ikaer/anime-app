# Phase C findings

Verified live against an empty scratch store (`~/.anime-app/data`, no
production data): a 3-page AniList season crawl produced 100 MAL-anchored +
8 AniList-only-no-idMal canonical ids. `GET /api/anime/animes` returned all
100 idMal-bearing rows with `sources.mal` undefined, real AniList CDN poster
URLs in `catalog.mainPicture`, and every populated `catalog.*` field
provenanced `"anilist"`. Re-running the crawl left the row count and
canonical ids unchanged (`a_1` stable across the re-crawl). The 8 no-idMal
titles stay out of the row set, per this doc's "Deferred" scope.

`next/image` renders every catalog poster with `unoptimized` already (both
`AnimeCardView.tsx` and `AnimeTable.tsx`), so the AniList CDN host needed no
`next.config.js` remote-pattern change.

`AnimeForDisplay.id` stays `number` (required), not `number | undefined`.
It resolves from the local MAL slice's id, falling back to the registry
crosswalk's `mal` field (populated from AniList's `idMal` even when no local
MAL slice exists yet). A canonical id with no resolvable MAL id anywhere
(true AniList-only, no `idMal`) is skipped at the row-set level in
`getAnimeForDisplay` rather than surfaced as an id-less row — matching this
doc's "Deferred" scope and avoiding an `id?: number` ripple through the ~150
call sites that read `AnimeForDisplay.id` as a plain MAL id.

`toAnimeRecord` was reshaped to take raw per-provider slices
(`{ mal?, simkl?, anilistMeta?, anilistPersonal?, hidden?, discrepancy?,
crosswalk? }`) instead of a pre-merged `MergedAnime` bag — `MergedAnime` no
longer exists as a type. This is what let a canonical id with no MAL slice
construct a valid record without a synthetic/placeholder MAL object.

`simkl`/`anilistMeta`/`anilistPersonal`/`crosswalk` stayed as top-level
convenience fields on `AnimeForDisplay` (mirroring `sources.*`/`crosswalk`)
rather than being migrated to `sources.*` reads — they were never raw MAL
fields, and this doc's Phase C reader list doesn't name them. Only genuine
raw-MAL-field reads (`my_list_status`, `created_at`, `updated_at`, `title`,
`mean`, `genres`, `media_type`, `start_date`/`start_season`) were migrated
onto `catalog`/`personal`/`sources.mal`.
