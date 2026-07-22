# Quick-rate — franchise-bulk rating page

> Shipped as `/quick-rate`. A rating-at-scale surface, **separable from**
> [localRating](../localRating/README.md): that feature ships its own rating UI
> (the detail-page control) — this is a *faster* way to rate, not the thing that
> makes local rating work.

## The two pains it solves

**1. "I don't remember per-season; I end up putting the same score everywhere."**
Rate a whole **franchise** in one action — one score fans out to every member,
with per-member override still possible. The group control is the fast path; the
pain is the *default*, not a straitjacket.

**2. "Just put a score, and it counts as watched."** Setting a score here patches
`{ score, status: 'completed', progress: numEpisodes }` (progress omitted when the
episode count is unknown).

**Auto-complete is page-scoped and opt-out-able** (the `ac` URL key). The detail
page and tier board deliberately do **not** do this, so a considered score-only
edit elsewhere is never hijacked.

## Franchise = connected component of the relation graph

Pure grouping in [domain/franchise.ts](../../src/lib/domain/franchise.ts).

- **Edges are undirected and restricted** to sequel / prequel / side-story /
  parent. `alternative_version`, `other` and `spin_off` are excluded on purpose:
  one bad merge sends a bulk score to the wrong show.
- **Relation edges carry MAL ids while records are canonical-keyed**, so traversal
  resolves through a MAL→canonical index, with an AniList→canonical index as
  fallback. Keying on one id space alone silently drops every edge into a title
  the other space doesn't know.
- **The relation data comes from AniList, not MAL.** MAL returns `related_anime`
  only from its single-title *detail* endpoint — its list and seasonal endpoints
  omit it, so a crawled catalog has relations for almost nothing (46 of 25,370
  when this shipped). AniList ships them in the same batch query as tags/staff/
  banner, so populating them is one metadata-sync run. MAL edges are still
  unioned in.

## Scope — the one hard difference from the tier board

**The whole catalog, unstatused titles included.** The tier board is
statused-only; here the unseen seasons of a franchise are exactly what you want
to sweep, and a fresh local user needs to bulk-bootstrap a backlog.

That volume drives three consequences:

- The API does **grouping and a lean projection server-side** — never ship ~25k
  `AnimeRecord`s to the browser.
- **Filtering refetches** rather than running client-side.
- Output is **paginated** (20 groups per page). No filter combination narrows
  ~25k titles to one screenful, so a cap would simply hide the remainder.

**Narrowing filters select *seeds*; each seed then expands to its whole
franchise — except media type, which also re-applies to members.** Media type
answers "what kind of entry do I rate at all" rather than "which franchise", so a
TV-only watcher must not have "set all" score the franchise's movies.

## Write discipline

A franchise "set all" is many writes. It reuses the tier board's **serial client
queue** (`await` each before the next) to respect SIMKL's write-lock and 1 req/s
cap, over `PUT …/mal-status` → `writePersonal` (not the score-only `rating`
endpoint, since auto-complete sets status too). Optimistic with revert, and
per-provider failure badges from the outcome map.
