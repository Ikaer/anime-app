# AniList OAuth — private list read + write-back

> Shipped. This keeps the provider quirks that are expensive to rediscover, and
> the open items.

## What it unlocks

Logging in with AniList gives the two things the anonymous public-username path
could not: **private-profile list read** and **write-back** via the
`SaveMediaListEntry` mutation. It is the login tier above anonymous catalog
access, and it costs the **deployer** a one-time OAuth app registration
(`ANILIST_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI`).

## Provider quirks — the load-bearing four

- **No scopes, no refresh tokens, 1-year tokens.** There is no refresh path to
  write; on expiry the user re-authenticates, and `isAnilistTokenValid` is a
  clock check.

- **The callback tolerates a missing `state`.** AniList is not *documented* to
  round-trip it (live-verification showed it does). So the callback keys on
  `code` alone and rejects only a state that came back *and* is stale/forged.
  Do **not** "fix" this into SIMKL's hard reject — the behaviour is undocumented
  and may change.

- **`SaveMediaListEntry(mediaId:)` takes the ANILIST id, not the MAL id** — the
  one write path that doesn't key off `crosswalk.mal`. Coverage of
  `crosswalk.anilist` isn't guaranteed, so `resolveAnilistMediaId` falls back to
  a live `Media(idMal:)` lookup rather than failing.

- **Always write `scoreRaw` (0-100 base), never `score`.** `score` is
  interpreted in the user's own `scoreFormat`, so the app's 1-10 value sent as
  `score` reads as 8/100 for a POINT_100 user. `scoreRaw: score * 10` is correct
  for every profile with no format read.

Two more, verified live:

- **AniList auto-fills `progress` to the episode count when status becomes
  COMPLETED.** The app's own progress value is redundant on that path, not
  authoritative — so the push omits it for `completed` rather than diffing it
  forever.
- **Clearing a status is refused** (`ok: false` with a reason), not silently
  dropped — same carve-out as MAL's writer. Removing a status is a distinct
  **Delete** action on the list entry in both AniList and MAL, not a status
  value.

## Shape

- [providers/anilist/auth.ts](../src/lib/providers/anilist/auth.ts) — token store,
  CSRF state, validity clock, viewer lookup. The transport itself is
  `anilist/client.ts`, shared with the anonymous sweeps.
- [providers/anilist/write.ts](../src/lib/providers/anilist/write.ts) —
  `SaveMediaListEntry`, registered as the `anilist` entry in
  `providers/writers.ts`. Handles status + score + progress (it is an upsert),
  unlike SIMKL's score-only carve-out.
- [providers/anilist/personalSync.ts](../src/lib/providers/anilist/personalSync.ts) —
  the read half. `importAnilistPersonalList()` pulls the OAuth'd viewer's OWN
  list by `userId`, **private entries included**, in a single
  `MediaListCollection` call (it returns the whole list, not a paginated
  connection, so no throttled batch loop) and full-replaces `personal/anilist.json`.

**It is authenticated-only, and that is load-bearing** rather than a limitation:
because every entry in the slice belongs to a connected account, AniList
participates in discrepancy detection with no actionability gate. The anonymous
by-username tier was removed for exactly this reason.

## The one-shot push

The registry writer pushes every **new** edit to AniList once connected. What it
cannot do is close the gap that *predates* the connection — titles rated in
SIMKL long before an AniList token existed. `performAnilistPersonalPush()` in
[providers/anilist/push.ts](../src/lib/providers/anilist/push.ts) is that missing
one-shot; after it runs it is a no-op.

- **The local record wins unconditionally — there is no conflict rule.**
  "Skip titles already on AniList" was proposed and dropped: local-cache-authority
  makes the merged record the truth, AniList is an absent-tolerant refill pipe,
  and it sits last in personal precedence. An entry is skipped only when it
  already *agrees*, to save a request. Skip-if-present would also have missed the
  majority of the drift — measured 151 absent but 90 more differing on
  status/score, which no later sync revisits.
- **Scope is the statused list incl. `plan_to_watch`**, read through
  `getEffective*`, so what lands on AniList is exactly the app's precedence.
- **The stats GET answers from in-memory counters while a run is in flight** —
  rebuilding the queue costs a `MediaListCollection` request, and a 5s UI poll
  would spend it against the same rate limit the writes are consuming.
- Fire-and-forget behind `POST /api/anime/anilist/personal-push`, logged to
  `anilist-personal-push`. Resumable by construction: each write lands
  immediately and the queue is rebuilt from a fresh remote read each run.

## Open items

- **`personal/anilist.json` can be clobbered.** The writer reflects a push into
  the slice, but a subsequent full import replaces it wholesale and drops entries
  the import doesn't carry. Harmless in practice (the push landed on AniList, so
  the next import reads it back), but the slice is not a durable local-only store
  the way `personal/local.json` is.
- **Entry deletion (`status: null`) is unimplemented across ALL providers**, and
  the fix belongs in the **registry**, not per provider: add an optional
  `deleteEntry(ctx)` to `PersonalWriter`, route `status: null` to it in
  `writePersonal`, then implement `DeleteMediaListEntry(id:)` for AniList — it
  takes the **list entry** id, not the media id — and
  `DELETE /v2/anime/{id}/my_list_status` for MAL. SIMKL has no equivalent. Until
  it exists, the UI correctly only offers "clear" to a local-only user.
- **Ship enabled-by-default, or self-host opt-in?** Registering the OAuth app is
  a deployer cost. (Product/deployment call.)

## Testing note

Verify UI on a **production build** (`next build` + `next start`). `next dev` on
this machine serves correct SSR HTML but never hydrates — no React fiber
attaches, no mount effect runs (reproduced with a six-line probe page). It is a
dev-only react-refresh bootstrap issue; the standalone build is unaffected.
Worth remembering before concluding that a page stuck on "Chargement…" is an app
bug.
