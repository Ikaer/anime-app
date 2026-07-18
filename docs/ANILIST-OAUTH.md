# AniList OAuth login (private lists + write-back)

> A **design + plan** document for an independent, self-contained feature.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `WIP`** — auth flow + write path implemented (2026-07-18); the
> private-list authenticated *read* is still `Todo` (see "Not yet done").

## What

Add AniList's own OAuth so a user can **log in with AniList**. Logging in unlocks
the two things the anonymous public-username path cannot give:

1. **Private-profile list read.** `MediaListCollection` returns a private user's
   list when the request carries that user's viewer token — the same query the
   anonymous path uses, just authenticated.
2. **Write-back to AniList.** Push status/score/progress changes to the user's
   AniList list via the `SaveMediaListEntry` GraphQL mutation. This is the AniList
   equivalent of the existing MAL/SIMKL write paths.

The anonymous read-by-username capability already exists (public lists only,
read-only). This is the **login tier above it**.

## Why it's optional / gated

Anonymous read covers first-run for public profiles. OAuth is the upgrade a user
opts into when they have a **private** list or want **writes**. It costs the
**deployer** a one-time AniList OAuth app registration (client id, client secret,
redirect URI) — comparable to what MAL/SIMKL already require.

## Design sketch

Mirror the existing MAL and SIMKL OAuth integrations — they are the template:

- **Env vars** (new): `ANILIST_CLIENT_ID`, `ANILIST_CLIENT_SECRET`,
  `ANILIST_REDIRECT_URI`. Add to `.env.example`.
- **Auth flow**: an `/api/anime/anilist/auth` route (`login` → redirect to
  AniList's authorize URL; `status`; `logout`) + the registered redirect URI
  callback exchanging the code for a token. Token store in `anilist_auth.json`
  under `DATA_PATH` (same shape/pattern as `mal_auth.json` / SIMKL auth).
- **Authenticated reads**: reuse the `MediaListCollection(userName:)` query but
  send the `Authorization: Bearer <token>` header (and/or `viewer` scope) so
  private lists resolve. Fold into the existing AniList personal-list import so a
  logged-in user's private list flows through the same store + precedence seam
  the anonymous import already established.
- **Writes**: a `SaveMediaListEntry(mediaId, status, score, progress)` mutation
  behind a new `anilistWrite.ts`, wired the way the tier board already calls the
  MAL + SIMKL rating writes. Return a per-source outcome like the existing
  rating endpoint so a failed AniList push surfaces, not silently drops.
- **Connections UI**: an AniList "Connect / Disconnect" control alongside the
  existing MAL/SIMKL connect buttons, driven through `useConnections`.

## What shipped (2026-07-18)

Built to the design sketch above, plus these findings from the live API docs:

- **AniList's OAuth2 has no scopes and no refresh tokens.** Tokens are valid
  **one year**; on expiry the user simply re-authenticates. So there is no
  refresh path (unlike MAL's) — `isAnilistTokenValid` just checks the clock.
- **`state` is not documented as round-tripped — but it IS** (live-verified
  2026-07-18: of two issued states, the one belonging to the completed login was
  consumed and the unused one remained). The callback is still written
  *tolerantly* — it rejects a state that comes back stale/forged, accepts an
  absent one, and keys on `code` alone — because the behaviour is undocumented
  and could change. In practice the CSRF check is live.
- **The write keys off the ANILIST media id, not the MAL id** — the one place in
  the write path that doesn't use `crosswalk.mal`. `crosswalk.anilist` coverage
  isn't guaranteed, so `resolveAnilistMediaId` falls back to a live
  `Media(idMal:)` lookup rather than failing.
- **We write `scoreRaw`, never `score`.** `score` is interpreted in the user's own
  `scoreFormat` (POINT_100/POINT_10/POINT_5/stars), so the app's 1-10 value sent
  as `score` would read as 8/100 for a POINT_100 user. `scoreRaw` is always the
  0-100 base: app-8 → 80, correct for every profile, no format read needed.
- **Files**: [anilistAuth.ts](../src/lib/anilistAuth.ts) (token store + GraphQL
  transport), [anilistWrite.ts](../src/lib/anilistWrite.ts)
  (`SaveMediaListEntry`), [api/anime/anilist/auth.ts](../src/pages/api/anime/anilist/auth.ts),
  `AnilistAuthSection` on the Connections page, an `anilist` entry in the
  `personalWriters.ts` registry, and `anilistClientId`/`anilistClientSecret` in
  the settings store. `hasWritableExternal()` now counts an AniList token.

## Live verification (2026-07-18, account `Ikaer`, scoreFormat POINT_10)

End-to-end against the real API, writing through the app's own
`PUT /api/anime/animes/[id]/mal-status` (so the personal-writer registry, not a
bespoke call), on `a_31` = *Sekai Saikyou no Kouei* (AniList 198409):

| Step | Sent | AniList read-back | Verdict |
|---|---|---|---|
| Write | `status: completed, score: 5` | `COMPLETED`, `score 5`, `scoreRaw 50`, `progress 12` | ✅ |
| Clear score | `score: 0` | `COMPLETED`, `score 0`, `scoreRaw 0` | ✅ |
| Clear status | `status: null` | *(refused, entry untouched)* | ✅ by design |

- **`scoreRaw` confirmed**: we wrote 50, it reads back as 5 on their POINT_10
  scale — the format-independence holds.
- **Clearing a status is correctly refused**, surfacing
  `{ ok: false, error: "AniList cannot clear a status (list removal only)" }`
  rather than silently dropping — same carve-out as MAL's writer.
- **AniList auto-fills `progress` on COMPLETED.** No `progress` was sent, yet the
  entry came back `progress: 12` (the full episode count). Provider-side
  behaviour worth knowing before wiring quick-rate's auto-complete to it — the
  app's own `progress` would be redundant here, not authoritative.
- **Only `anilist` appeared in the outcomes map**, confirming the registry gating:
  MAL/SIMKL were disconnected, and `local` correctly went auto-OFF the moment an
  AniList token made `hasWritableExternal()` true.

## Not yet done

- **Authenticated private-list read.** `anilistPersonalSync.ts` is still the
  anonymous by-username path; it does not yet send the viewer token. This is the
  remaining half of the spec.
- **`animes_anilist_personal.json` clobber.** The AniList writer reflects a push
  into that slice via `upsertAnilistPersonalEntries`, but a subsequent *username
  import* calls `replaceAnilistPersonalEntries` (full replace) and drops entries
  the import doesn't carry. Harmless in practice (the push landed on AniList, so
  the next import reads it back), but it means the slice isn't a durable
  local-only store the way `animes_local_personal.json` is.
- **Entry deletion (`status: null`) is unimplemented across ALL providers.**
  Confirmed against AniList's own UI (2026-07-18): removing a title's status is a
  distinct **Delete** action on the list entry, not a status value — and MAL
  models it identically. So this isn't an AniList quirk, it's the shape of the
  domain, and today every remote writer refuses `status: null` with a reason.

  Implementing it is therefore a **registry-level** change, not a per-provider
  patch: add an optional `deleteEntry(ctx)` to `PersonalWriter`, have
  `writePersonal` route `status: null` to it when present, and implement it as
  `DeleteMediaListEntry(id: $listEntryId)` for AniList (note: takes the **list
  entry** id — the `id: 581424041` in the write response — not the media id) and
  `DELETE /v2/anime/{id}/my_list_status` for MAL. SIMKL has no equivalent and
  would stay unsupported. The local writer would delete its slice entry.

  Deferred by the user 2026-07-18 ("for the moment it's ok"). Until it exists,
  the UI correctly only offers "clear" to a local-only user.

- **AniList is absent from discrepancy detection.** `buildProviderStates` in
  `store.ts` still excludes `anilistPersonal`. Its original reason ("until it
  becomes a writable provider") expired with this change; the live reason is that
  the slice is *also* filled by the anonymous username import for users with no
  token, who can't act on a mismatch. Including it needs a token gate, mirroring
  how `local` is gated on `personalPrecedence`.
- **Write surfaces**: because the writer lives in the shared registry, ALL of the
  tier board, `/quick-rate`, and the detail-page editor push to AniList once
  connected — broader than this doc's original "keep it to one surface first".
  Deliberate: it matches how MAL sits in the registry, and a provider that only
  wrote from one surface would drift out of sync with the others.
- **Precedence unchanged.** AniList still sits last in
  `DEFAULT_PERSONAL_PRECEDENCE` (`simkl > mal > anilist`) even when OAuth'd — see
  the open question below, deliberately not resolved here.

## Open questions

- **Ship enabled-by-default, or self-host opt-in?** Registering the AniList OAuth
  app is a deployer cost. Decide whether the hosted build ships it on, or whether
  it stays a self-host-only capability the operator enables by supplying the env
  vars. (Product/deployment call.)
- **Write scope**: which surfaces push to AniList — only the tier board (as with
  MAL/SIMKL today), or also status changes elsewhere? Keep it to the one
  user-initiated write surface first.
- **Precedence when logged in**: where does an OAuth'd AniList personal slice sit
  relative to MAL/SIMKL in the effective-state order? (The anonymous import is
  the lowest tier today; a logged-in AniList user who uses AniList *as* their
  primary source may want it higher — revisit the `getEffective*` order.)
