# AniList OAuth login (private lists + write-back)

> A **design + plan** document for an independent, self-contained feature.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `Todo`.**

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
