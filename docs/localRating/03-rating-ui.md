# Phase 3 — Rating UI (the bootstrap surface)

**Goal:** the in-app way to **create and edit local personal state** — set status + score (+
progress) on a title. This is not optional polish: without it a local-only user **cannot enter
any data at all**, and the local provider is inert.

## Why this is required (the gap that motivated it)

The existing rating surfaces both assume personal state *already exists*:

- **Tier board** (`/tier`) fetches `?status=watching,completed,on_hold,dropped` — it only shows
  **already-statused** titles. For a local-only user starting from an **empty** list it renders
  **nothing** — there's nothing to drag, and no way to promote an unstatused catalog title into
  a statused one.
- **Recommendations** need seeds, which are `completed` + scored titles — again, none exist yet.

So there must be a surface that takes an **unstatused catalog title → statused + scored**. That
is the bootstrap, and it lives on the **detail page** (reached from the main catalog list, which
is populated even for a local-only user via the onboarding AniList crawl).

After this phase, the tier board and the reco feed become non-empty for a local user, because
this is what first writes `animes_local_personal.json` entries.

## 3a. Detail-page status + score control

On [src/pages/anime/[id].tsx](../../src/pages/anime/[id].tsx), add a personal-state editor bound
to the record's **effective** `personal.*`:

- **Status control** — `watching | completed | on_hold | dropped | plan_to_watch | (none)`. This
  is the "mark it watched" affordance the bootstrap needs. On change → patch `{ status }` →
  `writePersonal` (phase 2).
- **Score control** — 1–10 (dropdown or segmented buttons) + clear (0). On change → patch
  `{ score }` → `writePersonal`.
- **Progress** (optional) — episodes watched, for in-progress titles.
- All three go through the **same** `writePersonal` orchestrator, so for a local-only user they
  land in `animes_local_personal.json` (creating the entry if absent); for a MAL/SIMKL user they
  fan out to the externals exactly as the tier board does.
- **No forced auto-complete here.** The status control is right there, so rating and marking
  watched are two explicit acts — don't silently flip one from the other. (The *franchise
  quick-rate* page, [docs/quickRate/](../quickRate/README.md), is where the "one score ⇒ mark the
  whole thing completed" convenience lives, because that's its whole point.)
- Surface per-provider write failures (the outcome map from phase 2) inline, small.

Light lift: a couple of controls wired to endpoints that already exist after phase 2. The work
is mostly the un-obvious part above — that this is the **entry point** for local data, so it must
handle a title with **no prior personal entry on any provider** (create, not just edit).

## 3b. Creating state from nothing — the edge to get right

The one thing to verify, because the existing endpoints were written assuming a MAL slice
exists:

- `rating.ts` / `mal-status.ts` today do `getAllAnime()[canonicalId]` and **404 if the MAL slice
  is absent** ([rating.ts:40](../../src/pages/api/anime/animes/[id]/rating.ts),
  [mal-status.ts:33](../../src/pages/api/anime/animes/[id]/mal-status.ts)). For an
  AniList-crawled, MAL-less title (the local-only user's whole catalog) that 404 is exactly the
  bug. Phase 2's `writePersonal` must **not** require a MAL slice — the local writer upserts into
  `animes_local_personal.json` keyed by the canonical id regardless of which raw slices exist.
- Confirm the detail page renders and can rate a title whose `sources.mal` is `undefined`
  (AniList-only record). The `id` route param is the canonical id; the write path keys off it, so
  no MAL id is needed for the local write.

## 3c. Relationship to the other surfaces

| Surface | Role | Can create from nothing? | Auto-complete |
|---|---|---|---|
| **Detail page** (this phase) | bootstrap + precise single edit | **yes** (status control) | no |
| **Tier board** (`/tier`, exists) | re-score already-statused titles | no (statused only) | no |
| **Quick-rate** ([quickRate](../quickRate/README.md), separate) | franchise-bulk | yes (over catalog) | yes (opt-out) |
| ~~Card inline~~ | — | — | *not built (settled)* |

All converge on `writePersonal`, so a new provider (Betaseries) shows up in every surface's
outcome badges automatically.

## Touch list (Phase 3)

- [src/pages/anime/[id].tsx](../../src/pages/anime/[id].tsx) — status + score (+ progress)
  controls wired to `writePersonal`.
- Verify phase 2's `writePersonal` + `localWriter` create-not-just-edit on a MAL-less record
  (this is really a phase-2 correctness requirement, called out here because this is where it
  first bites).
- i18n keys (fr/en) for the status/score control labels.
- CSS per the file convention (`anime/[id].tsx` uses `<style jsx>`).

## Verification

- **Bootstrap, local-only:** on a fresh local setup, open an AniList-crawled title's detail page
  (no `sources.mal`), set status `completed` + score 8 → `animes_local_personal.json` gains the
  entry, effective values reflect it, the title now appears on the tier board and can seed the
  reco feed.
- **MAL user parity:** same controls on a MAL-linked title fan out to MAL/SIMKL identically to
  the tier board (outcome badges), no regression.
- **Edit existing:** changing score on a title that already has state updates in place, doesn't
  duplicate.
