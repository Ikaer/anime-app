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
- **`state` is not documented as round-tripped.** We send one anyway, but the
  callback is *tolerant*: it rejects a state that comes back stale/forged and
  accepts an absent one. Copying SIMKL's hard `consumeOAuthState` reject verbatim
  would have failed every login. The callback keys on `code` alone.
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
