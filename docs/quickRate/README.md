# Quick-rate — franchise-bulk rating page

**A separable nice-to-have, not part of [localRating](../localRating/README.md).** localRating
ships its own rating UI (the detail-page status + score control,
[phase 3](../localRating/03-rating-ui.md)) — that's the surface that lets you create/edit local
state and mark a title watched. This page is a *faster* way to rate at scale, not the thing that
makes local rating work.

**Depends on:** localRating [phase 2](../localRating/02-write-registry.md) (`writePersonal`) and
reuses the [phase 3](../localRating/03-rating-ui.md) rating flow. Build it after those; nothing
in localRating depends on this.

**Goal:** a dedicated page that solves the two rating-at-scale pains the tier board and detail
page don't: rating a whole **franchise** in one action, and "just put a score, mark it watched".

---

## The page

A dedicated route (e.g. `/quick-rate`), its own lean URL state hook (mirror
[useTierUrlState](../../src/hooks/useTierUrlState.ts) / `useRecommendationsUrlState` — **not**
part of `AnimeFiltersState`). Composes the sidebar filter sections like `/tier` does.

## Pain 1 — "I don't remember per-season; I end up putting the same score everywhere"

**Rate a whole franchise in one drop.** Group related entries into a franchise and let one score
fan out to every member.

- **Grouping source:** the relation graph already in the data — `catalog.relatedAnime` (MAL
  `related_anime`: sequel/prequel/side_story/…). The
  [connections page](../../src/pages/connections.tsx) already traverses these; reuse that logic.
  Compute **connected components** over the relation edges (optionally restricted to
  sequel/prequel/side-story/parent-story relations so unrelated "other" links don't over-merge a
  franchise) → each component is a franchise group.
- **UI:** franchise cards; each shows its member seasons. A single score control on the group
  sets that score for **every** member via a sequence of `writePersonal` calls.
- **Per-member override still possible** — the group score is a "set all", but a member can be
  individually adjusted (some people rate seasons differently). Group control = the fast path;
  the pain is the *default*, not a straitjacket.

## Pain 2 — "just put a rate, and it marks it watched"

**Rate ⇒ auto-complete, on this page only.** Setting a score here implies "I finished this":

- Score set → patch `{ score, status: 'completed', progress: catalog.numEpisodes }` for the
  member (progress only when `numEpisodes` is known).
- **Page-scoped, opt-out-able.** A toggle ("Marquer comme terminé en notant", default on). The
  detail page and tier board do **not** do this — auto-complete is a quick-page affordance, not
  global behavior, so a deliberate score-only edit elsewhere isn't hijacked.
- For a franchise "set all": every member gets score + completed + full progress.

## Scope — must reach unstatused titles

Unlike the tier board (statused-only), this page needs to reach **unstatused catalog titles** —
otherwise it can't help a fresh local user bulk-bootstrap a backlog, and it can't rate the
unseen seasons of a franchise you've only partly watched.

- Fetch scope should include the catalog, not just `status=watching,completed,on_hold,dropped`.
  At minimum, include `plan_to_watch`/unstatused members that share a franchise component with a
  statused one; for the from-scratch case, allow browsing the whole catalog (with the usual
  narrowing filters to keep it manageable).
- This is the one hard difference from the tier board's scope — decide and document it.

## Write discipline

- Franchise "set all" can be many writes. Reuse the tier board's **serial client queue** (`await`
  each `writePersonal` before the next) to respect SIMKL's write-lock / 1 req/s cap. Optimistic
  UI with revert-on-failure per member; per-provider failure badges from the outcome map.

## Touch list

- **New** `src/pages/quick-rate.tsx` + `src/hooks/useQuickRateUrlState.ts` — franchise view.
- Franchise-grouping helper — extract the connected-components logic from
  [connections.tsx](../../src/pages/connections.tsx) into a shared lib fn (`src/lib/franchise.ts`?)
  so both pages share one implementation.
- API scope — a fetch path that returns unstatused catalog titles for this page (see Scope).
- i18n keys (fr/en) for the new page chrome + the auto-complete toggle.
- CSS modules / `<style jsx>` per the file convention (run `npm run css:types` if a
  `.module.css` is added).

## Verification

- **Franchise set-all:** drop a score on a 3-season franchise → all 3 members get the score; with
  auto-complete on, all 3 become `completed` at full progress; outcome badges per member.
- **Reaches unseen seasons:** a franchise you've watched S1 of shows S2/S3 too, and rating the
  group scores them all.
- **Local-only user:** all of the above land in `animes_local_personal.json`, seed the reco feed
  (crowd expansion works for members carrying `crosswalk.mal` — see localRating README caveat).
