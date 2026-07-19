# AniList OAuth login (private lists + write-back)

> A **design + plan** document for an independent, self-contained feature.
> Status vocabulary: `Todo` · `WIP` · `Done` · `Dropped` · `Blocked`
>
> **Status: `WIP`** — auth flow + write path implemented (2026-07-18);
> authenticated read + the one-shot list push added 2026-07-19 (see "The push").

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

## The push: bringing an existing SIMKL/MAL list up to AniList (2026-07-19)

The registry writer pushes every NEW edit to AniList once connected, from all
three write surfaces. What it cannot do is close the gap that *predates* the
connection — titles rated in SIMKL long before an AniList token existed. Nothing
iterated the list. `performAnilistPersonalPush()` in
[anilistPush.ts](../src/lib/anilistPush.ts) is that missing one-shot; after it
runs it is a no-op, because the per-edit writer keeps the two in step.

- **The local record wins, unconditionally — there is no conflict rule.** An
  early design pass proposed "skip titles already on AniList" to avoid clobbering
  AniList-side edits. That was wrong for this architecture and was dropped:
  local-cache-authority makes the merged record the truth, AniList is an
  absent-tolerant refill pipe, and it sits LAST in personal precedence — there is
  no AniList-side state worth defending. An entry is skipped only when it already
  agrees, to save a request.
- **Skip-if-present would also have missed the majority of the drift.** Measured
  against the live account 2026-07-19: 671 statused locally, 522 on AniList, of
  which **435 already agree, 151 are absent, 11 differ on status and 79 on
  score** → 236 writes. Skipping present entries would have written only the 151
  and left ~90 titles permanently stale, since no later sync revisits them.
- **Scope is the statused list incl. `plan_to_watch`** (everything with an
  effective status — `/stats`' scope, not the tier board's rateable-only one).
  Values are read through `getEffective*`, so what lands on AniList is exactly the
  SIMKL > MAL > AniList precedence the rest of the app filters on.
- **Progress is compared on nothing, and omitted for `completed`.** AniList
  auto-fills it to the episode count on COMPLETED (verified 2026-07-18), so it is
  provider-derived there; diffing it would re-push most of a completed list
  forever.
- **The stats GET answers from in-memory counters while a run is in flight.**
  Rebuilding the queue costs a `MediaListCollection` request, and a 5s UI poll
  would spend it against the same rate limit the sweep's writes are consuming.
- Throttled to ~28 req/min like the other AniList sweeps; fire-and-forget behind
  `POST /api/anime/anilist/personal-push`, logged to `anilist-personal-push`.
  Resumable by construction — each write lands immediately and the queue is
  rebuilt from a fresh remote read each run, so an interrupted sweep just finds
  fewer disagreements next time.

## Authenticated read (2026-07-19)

`anilistPersonalSync.ts` now carries both tiers. `fetchList` takes an optional
token and attaches `Authorization: Bearer` whenever one exists; a new
`LIST_QUERY_BY_ID` (`MediaListCollection(userId:)`) addresses the viewer's own
list, which is what gets through the private-profile gate.
`importAnilistPersonalList('')` with a live token imports the viewer's own list.
`fetchAuthenticatedAnilistList()` returns normalized entries without persisting —
that is what the push diffs against.

Live-verified 2026-07-19: by-name and by-id return identical results (5 lists,
522 entries, 0 missing `idMal`), and `GET /api/anime/anilist/personal-push`
against the real token returned `{statused: 671, remote: 522, differing: 236}`,
matching an independent offline diff of the same data exactly.

The Connections-page UI was verified the same day, rendering
"236 titres sur 671 diffèrent de votre liste AniList" with its push button.
**It had to be checked against a production build** (`next build` + `next start`):
`next dev` on this machine serves correct SSR HTML but never hydrates — no React
fiber attaches to any node, no mount effect runs, and a six-line probe page with a
single `useEffect` reproduces it. Dev-only (react-refresh bootstrap); the
standalone build is unaffected. Worth remembering before concluding that a
"stuck on Chargement…" Connections page is an app bug.

## Not yet done

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
