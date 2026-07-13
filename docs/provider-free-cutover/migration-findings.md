# Migration + Phase B runtime findings

Notes captured while building + landing Phase B (re-key the store to canonical
id) against a copy of live data (`E:\Workspace\local\AnimeTracker\data`). The
tracking doc ([../PROVIDER-FREE-CUTOVER.md](../PROVIDER-FREE-CUTOVER.md)) stays
pristine; the detail lives here.

## Scope landed in Phase B (and what was deliberately deferred)

Phase B re-keys **only the catalog slices** to canonical id, at rest and at
every write:

- `animes_mal.json`, `animes_simkl.json`, `animes_anilist_meta.json`,
  `animes_anilist_personal.json` → keyed by canonical id.
- Every store writer resolves-before-mint (`resolveCanonicalIds`) so a sync can
  never recreate a MAL-id-keyed entry. The read join (`getAnimeForDisplay` /
  `getAnimeByIdForDisplay`) is a direct canonical-key lookup; the old lazy
  self-heal reconcile (`reconcileRegistry`/`upsertCrosswalk`) is gone.
- Outward id stays the MAL id (URLs, API route params) — resolved to the
  canonical slice key at the API boundary via `resolveByMalId`.

**Deliberately left MAL-keyed until Phase D:** `animes_hidden.json` and
`recommendations_feedback.json`. The reco engine (`recommendations.ts`) is
MAL-id-keyed internally and reads both by MAL id; the Phase B runtime does too
(the join checks `hidden` against `anime.id`). Re-keying them now — as the
cutover doc's storage table shows for the *end state* — would leave the files
canonical on disk but read as MAL, silently mis-attaching hides/thumbs. They flip
together with the reco engine + outward id in Phase D. The migration script was
de-scoped to match (it no longer touches those two files).

This is a divergence from the cutover doc's Phase B literal wording but matches
its own phase boundaries (feedback + reco = Phase D). The storage table there
still describes the correct *end state*, so it was left unedited (pristine rule).

## Live-data collision — resolved

One real output-key collision existed: MAL ids `39473` and `63802` carried the
same `simkl_id` `1055023`, so both resolved through it to one canonical id. User
confirmed `1055023` is MAL `63802` and `39473` doesn't exist on SIMKL anymore —
the `39473` SIMKL entry was a stale duplicate. Removed it from the real
`animes_simkl.json` (backup at `animes_simkl.json.bak`, 640 entries; live file
now 639). Migration then runs clean (exit 0, 0 minted, no collisions).

**Source-of-truth caveat:** the NAS is authoritative, so `npm run data:copy`
would restore the stale `39473` entry. It must be removed from the SIMKL library
/ NAS copy too, or the collision returns on the next copy-then-migrate.

## Phase B verification (write, not just read)

Typecheck-green only proves the read path; the user's requirement was
specifically that syncs must not recreate MAL keys — a write concern. Verified on
a fresh migrated copy (`…\data-canonical`) with the dev server pointed at it:

- **Read/join:** `/api/anime/animes` returns correctly-joined records — Frieren
  (`id:52991`) with its SIMKL entry and AniList meta lined up, all three slices
  canonical-keyed on disk. `hidden=true` correctly returns a hidden title
  (Gintama°, MAL 28977 from the still-MAL-keyed hidden list).
- **Write (the load-bearing check):** a live `POST …/52991/refresh` fired real
  AniList + MAL writes (`refreshAnilistMetaForIds` → `upsertAnilistMeta`;
  `fetchAnimeById` → `upsertAnime`). After the writes: both slices still had the
  entry under `a_18868` (52991's canonical id), `fetched_at` refreshed, and
  **zero purely-numeric top-level keys** in either file. The exact failure mode
  the user asked about — a sync recreating a MAL-id key — does not happen.
  (`refreshMal` is GET + local upsert only; no outward MAL mutation occurred. The
  rating/mal-status writers use the identical `resolveByMalId` lookup pattern but
  were not live-tested because their remote leg would mutate the real MAL
  account.)

## Deploy story (applying to real data — do NOT skip)

Once the self-heal reconcile is gone, the new code CANNOT run on un-migrated
files — it treats MAL-id keys as canonical and mis-joins. So the cutover is
**migrate-then-serve**, not just "push the code":

1. Deploy the new image but ensure it does not serve until the data is migrated.
2. Run `node scripts/migrate-canonical.js /app/data` against the NAS data volume
   (idempotent; halts on collision without writing).
3. Then let the new image serve.
4. Any future `npm run data:copy` from the NAS requires a re-migrate before the
   app reads it (and re-removing the stale `39473` SIMKL entry, per above).

## Bugs the copy-run surfaced (all fixed in the script)

1. **Franchise-slug false positives.** Scanning *all* crosswalk keys flagged 64
   "collisions" that were SIMKL `slug`/`imdb`/`tvdbslug` — franchise/series-level
   ids that legitimately repeat across every season. The collision scan now only
   considers the per-title resolution keys `mal`/`anilist`/`simkl`.
2. **Inline-write ordering.** Slice files were written as they were re-keyed,
   before the collision scan — so a halt left slices re-keyed but the registry
   un-written. Now everything buffers into `pendingWrites` and flushes only after
   the scan passes (slices first, registry last).
3. **Silent SIMKL loss.** Registry-claimant scanning misses the merge above (the
   overwrite leaves only one claimant). Added output-key collision detection: two
   source records resolving to one canonical id is caught directly.

## Drift risk to watch

`resolve()` in the script is a hand-port of `resolveCanonicalIds` in
`src/lib/store.ts`. Two copies of the identity logic can drift. Mitigations if it
matters later: diff their output on the same data copy, or extract the pure
resolver into a shared module both can import. Acceptable for now — the algorithm
is small, it was validated on real-data copies, and post-migration only the
store.ts resolver runs.
