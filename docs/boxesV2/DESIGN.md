# « Mes boîtes » v2 — design

Status: **approved, not built**. Built behind `/boxesV2`, swapped over `/boxes` at the end
(see [Route strategy](#route-strategy)).

The reco **profiles** system (per-box weight profiles, a tuning page with live sliders) is a
SEPARATE iteration with its own document. It is out of scope here; this doc only avoids
foreclosing it.

---

## 1. Why — what is actually broken

All numbers below were measured against the live store (`npm run data:copy`, 2026-09-07:
26,722 catalog titles, 720 statused, 26 boxes).

**The landing page asks a 12,298-cell question.** It is an O(titles × boxes) matrix — 473
franchise groups × 26 boxes — and every row asks "which of my 26 axes is this?". That is not
a question anyone answers 473 times. The evidence that it does not work: **108 of 720 watched
titles (15%) are filed in any box at all**, and **13 of the 26 boxes are empty**, after two
labeling sessions.

**« Remplir » adds titles that were never asked for.** `rankBoxCandidates` returns the whole
*catalog* relation component and « Ajouter » files every entry in it, watched or not. Measured
across the 13 non-empty boxes: **487 of 1,539 proposed entries (32%) are titles the owner has
never watched**. ⚠️ The defect is the unasked-for bulk add, NOT the unwatched state — filing an
unwatched title deliberately through the picker is a wanted feature and must survive.

**A multi-cour show buys a multiple of the vote.** `buildFieldProfile` weights every member
`() => 1`, so N entries of one show cast N votes:

| Box | entries | distinct shows | biggest show's share of the vote |
|---|---|---|---|
| Shonen I dig | 14 | 3 | **50%** (Demon Slayer 7, Bleach 5, Chainsaw Man 2) |
| Absolute cinema | 10 | 3 | **50%** |
| Chara design I dig | 10 | 3 | **50%** |
| Laugh | 34 | 17 | 15% |

This is a ranking bug, not a cosmetic one. Holding the exclusion set fixed for a fair
comparison, collapsing each show to one vote changes **11 of the top 15 proposals for
`Absolute cinema`** and 7 of 15 for `Shonen I dig` — and what surfaces is the giveaway:
`Ghost in the Shell (TV)`, `GitS: Stand Alone Complex`, `Psycho-Pass 2`, i.e. the box's own
third show, which its Bleach and Link Click blocs were drowning.

**The grow ranker cannot serve the boxes now being created.** Live, `Absolute cinema` proposes
JoJo, Blue Exorcist, Jujutsu Kaisen, Hunter x Hunter and MHA Vigilantes, justified by
`Urban Fantasy · Super Power · Male Protagonist` — Bleach's tag neighbourhood, not a craft
axis. CLAUDE.md already records this as measured and expected: no catalog field encodes form.
Most of the 13 empty boxes are form/affect axes (`M'a foutu la trouille`, `Le trou après la
fin`, `J'ai dû faire une pause`), so the tab's premise fails on exactly the boxes still to be
filled. Filters + the owner's own eyes beat a ranker that cannot see the axis.

**Skips do not persist.** Documented as deliberate ("a skip means not now"). At 26 boxes it is
the dominant cost: the same 40 proposals are re-judged on every visit. The correct shape is a
durable **excluded** set — "no, not this axis" is a judgement of the same kind as membership.

### Live bugs found while browsing, fixed by construction in v2

- Members tab flashes « Cette boîte est vide » while the header says « 10 entrées » — the
  members view clears `isLoading` before its own fetch lands.
- The sidebar reads **`10 / 9007199254740991 anime dans le mix`** — `MAX_SAFE_INTEGER` leaking
  into `MixAnchorsSection`'s label.
- Rename is a `window.prompt`.
- The recos tab renders 2 cards wide at the 1280px target: it has a `cpr` URL key and no
  `AnimeListHeader` to drive it.

---

## 2. Route strategy

Build `/boxesV2` alongside `/boxes`, swap at the end. **Fork the page, not the data or the
lib.**

- `Box.members` stays a flat canonical-id array, so v2 needs no different member semantics and
  `/mix?box=`, `computeAnchored` and the four MCP box tools keep working unchanged throughout.
- New fields are additive (`excluded?`), so `/boxes` ignores them and stays green while v2 is
  built.
- `src/lib/reco/boxes.ts` is extended **in place**, never forked. Two copies of the store would
  be two copies of the only file in the app that cannot be re-fetched from a provider.
- New API routes only where the projection genuinely differs (the list's `top` slice, the
  excluded write, the groups CRUD).

### Deletion list — the swap is not done until every line is gone

⚠️ Naming the list here so the swap cannot be left half-finished; the house rule is *delete the
unused thing rather than keep it working*.

- `src/pages/boxes/index.tsx` — the chip grid.
- `src/pages/boxes/[id].tsx` — the three-tab detail page.
- `src/components/anime/boxes/BoxChips.tsx` — **moves, does not die.** Its only current caller
  is the grid; its new home is the anime detail page (§6).
- `src/hooks/useBoxesUrlState.ts`, `useBoxUrlState.ts` — replaced.
- `MixAnchorsSection` as the box sidebar — the *picker* survives inside the group blade and the
  landing cards; the sidebar placement does not.
- `GET /api/anime/boxes/[id]/grow` and `rankBoxCandidates`' role as the FILL surface. The
  ranker itself survives (§7) — it is the `box_candidates` MCP tool's engine and the recos
  tab's re-ranker.
- `/boxesV2` is renamed to `/boxes` in the same commit as the deletions. There is one user and
  the old URLs can break.

⚠️ `src/pages/api/anime/watched-groups.ts` is a **reshape, not a deletion**. It is the chip
grid's only consumer, but the quick-edit source pane needs almost the same query without the
franchise grouping and without pagination.

---

## 3. Data model

### `user/boxes.json` — one new field

```ts
interface Box {
  id: string;
  name: string;
  emoji?: string;
  description?: string;
  members: string[];          // canonical ids — unchanged, still flat, AUTHORITATIVE
  excluded?: string[];        // NEW — canonical ids judged "not this axis"
  groups?: string[];          // NEW — UserGroup ids whose collapse applies in THIS box (§4)
  createdAt: string;
}
```

`excluded` is absent rather than `[]` when empty, matching how `description` and `emoji` are
already handled.

⚠️ **`excluded` will contain UNWATCHED ids.** The recos tab with `includeSeen` on surfaces
unseen candidates, and « Non » files them. So nothing that renders or counts the excluded list
may join it against the watched list — that is the same failure shape as deriving a seiyuu
filmography from the cast slice, which returned only titles already watched.

⚠️ `excluded` is **box-local and must never reach the global feed.** It is not a `👎`, not a
hide, and not a seed mute. A title excluded from `Absolute cinema` says nothing about
`/recommendations`.

### `user/groups.json` — « Mes regroupements », new file

```ts
interface UserGroup {
  id: string;                 // slug from the name, deduped — same mint as Box
  name: string;
  members: string[];          // canonical ids
  createdAt: string;
}
```

A bare array, beside `boxes.json` / `hidden.json` / `reco_feedback.json`. Store lives in
`src/lib/reco/groups.ts` for `boxes.ts`' reason: it is an engine annotation, off the
seven-slice join, so a write here cannot change an assembled row and must not invalidate the
row cache.

⚠️ **Durable user data.** Like `boxes.json`, no provider can re-supply it. It belongs in
CLAUDE.md's "costs that are real" list, not in the reprocess-freely list.

---

## 4. « Mes regroupements » — user-defined units

### What it is

A global, reusable, hand-drawn statement that several titles **are one thing**. The provider
relation graph is a *suggestion* it is seeded from, never an authority it obeys — that is the
whole point of the feature ("on my terms").

### It is an overlay, not a membership unit

⚠️ `Box.members` stays a flat list of canonical ids. A group never appears in it. Three
reasons, and undoing any of them breaks something specific:

- **Per-title control survives.** "TYBW in, base Bleach out" is a required case. If a box held
  *group* ids, saying that would mean splitting the Bleach group — and groups are global, so
  the split would silently re-scope every other box using it.
- **Nothing downstream changes.** `/mix?box=`, `computeAnchored`, `box_candidates`,
  `list_boxes` all keep reading a flat id array.
- **Reuse costs one click, not a rebuild.** Defining « Bleach » once while filling `Shonen I
  dig` means `Chara design I dig` picks it from the existing list. The DEFINITION is global and
  shared; only the *application* is declared per box (§4's `Box.groups`), so there is never a
  per-box copy of the member list to keep in sync.

"Add all 17 at once" is a **button**, not the storage model.

### A title may belong to several groups

Deliberate, and overruled from the first draft of this design: the owner picks different
subsets of seasons depending on what a box is about. Subsets used together in one box are
normally disjoint; overlap across boxes is the point.

### Collapse arithmetic — resolved per box, over that box's own members and DECLARED groups

For a box's member set, build the connected components of "shares a **declared** group with",
**restricted to members**, and weight each member `1 / componentSize`. Two restrictions, both
load-bearing: only groups in `box.groups` participate (§4's ruling), and only titles in
`box.members` are nodes.

- Disjoint subsets declared in one box → two components → two votes. The subset case works.
- TYBW's 4 cours filed, base Bleach not → the component is those 4 → one vote. Base Bleach
  contributes nothing because it is not a member.
- Two overlapping **declared** groups → they **merge into one unit**. That is the only
  well-defined answer, and having declared both it is the owner's own call ("that's on me").
- A member in no declared group keeps weight 1, so an undeclared box behaves exactly as today.

The invariant this buys, and the reason to prefer it over picking a representative: **every
unit sums to exactly one vote**, whatever the group topology.

⚠️ **Fractional weights, not a representative.** `buildFieldProfile` already takes a
`weightFn`; the change is passing `a => 1 / componentSize(a)` instead of `() => 1`. Picking one
representative per unit would throw away the tags of the other cours — TYBW's would be
replaced by base Bleach's. Fractional weighting keeps a tag all four share at 1 and a tag
unique to one cour at 1/4, which is the faithful reading.

### Merge in the math, keep separate on screen

⚠️ The display does **not** fuse overlapping groups — two groups render as two cards even when
the ranking counted them as one unit. Fusing them visually was rejected: it makes the pane a
mess and hides a structure the owner deliberately drew.

**Math and display answer different questions and need not agree.** The vote arithmetic above
operates on the member SET (connected components, one vote per unit); the display operates on
groups. A title drawn under two group cards is still one vote, and that is not a contradiction
because the two views are not claiming the same thing.

⚠️ **A title may therefore be drawn more than once, and the panes are laid out to allow it**
(§6.2's two-region split). An earlier draft of this design assumed a flat pane where each anime
appears exactly once, and paid for that assumption with an invented tie-break ("render under
the smallest applicable group, ties to most recent") plus a ⧉ marker for where display and math
diverged. All three were **removed**: the constraint was the page's, not the data's, and a
heuristic that exists only to satisfy a self-imposed constraint is strictly worse than no
heuristic. Do not reintroduce a single-draw rule.

One consequence to expect rather than treat as a bug: `−` on a title inside group card A
removes it from the **box**, so it also leaves card B. Correct, but it reads as one click
hitting two places.

### `Box.groups` — application is declared PER BOX, definition stays global

⚠️ **A group is not a universal fact, it is a judgement made with an aim in mind — and the aim
is the box.** So a box declares which groups it uses:

```ts
groups?: string[];    // UserGroup ids whose collapse applies in THIS box
```

⚠️ **Auto-application was designed first and is WRONG. Do not go back to it.** The rejected
version applied every group wherever its members happened to land, on the argument that reuse
should cost nothing and that collapsing is measurably right almost always (a multi-cour show
holds 50% of the vote in three live boxes, §1). "Almost always" is the defect. Concrete failure:
a broad « Gundam » group made for a mecha box — the wide-scope component is **131 entries** —
would then fuse 08th MS Team and Iron-Blooded Orphans in `Absolute cinema`, where they are two
separate artistic achievements deliberately filed as two. Auto-apply silently imposes a
judgement made for a different box, and silence is the whole problem: the owner never asked
that question here.

The objection auto-apply was defending against — "filing four cours one at a time then silently
fails to collapse them" — does not survive §6.2's two-region display, where undeclared cours
visibly render as separate cards. Nothing is silent either way; explicit is the one that lets
the owner decide.

**Definition is global, application is per box.** The group's members are defined once in
`user/groups.json` and picked from the existing list — that is the reuse requirement ("define
Bleach in `Shonen I dig`, use it in `Chara design I dig` without rebuilding it"). Only the
declaration is box-local, and **a group may be declared by any number of boxes at once**; the
boxes share the one definition rather than each holding a copy. Editing the group's members
therefore changes every box that declared it, which is the intended behaviour — a group is one
statement about what those titles are.

Three details that keep the common path cheap:

- **"Add all 17" writes both** — the ids into `members` and the group id into `groups`. One
  click, both effects, so the ordinary path still feels automatic.
- **Filing entries one at a time makes the UI OFFER the declaration**: « ces 4 entrées
  appartiennent au regroupement Bleach — les compter comme une seule ? ». The nudge without the
  decision.
- ⚠️ **A declaration NEVER adds membership.** `members` is authoritative; `groups` is a lens
  over it. If declaring a group also filed its titles, the two would be sources of truth that
  can drift — and every consumer (`/mix?box=`, `computeAnchored`, `box_candidates`,
  `list_boxes`) reads `members` alone, so a title present in `groups` but not `members` would be
  invisible to the very ranking this feature exists to fix. Under the lens rule a declared but
  unfiled group contributes nothing, a deleted global group is an unresolvable id to ignore, and
  removing a title from a box needs no group bookkeeping at all.

The arithmetic above is unchanged: two **declared** groups that overlap still fuse into one unit
in the vote (otherwise the show gets two votes) and still render as two cards. The difference is
that the fusion is now unambiguously the owner's own doing.

### Creating and editing — the blade

Opened from any card in quick-edit, and from a collapsed unit to edit an existing group. A
right-hand **blade**, not a modal: at the 1280 CSS px TV target it keeps the list being filed
visible, which is the context the decision is made in.

- **Pre-seeded from the provider relation component, every entry checked.** "This whole show is
  one thing" is the common case; carving out is the exception. Uncheck what does not belong.
- **Name pre-filled** from the component's earliest AIRED member — `franchiseOrder.ts` already
  computes exactly that, so « Bleach » arrives typed.
- **A picker**, so titles the relation graph does not connect can be added, and so a standalone
  title with no component can still start a group.
- Entries already in another group are **labelled with that group's name** — informational, not
  blocking, since overlap is legal. It must be visible before it merges something.
- **Unwatched entries stay listable and checkable.** They are inert until one is filed, and
  then it is already grouped.

---

## 5. `/boxesV2` — the landing page

The list of boxes. Box-first, not title-first. This is the inversion that fixes §1's first
finding.

Per box card:

- Emoji, name, description — **all three editable in place**, blur saves, reusing the detail
  page's existing pattern verbatim.
- **A TOP 10** of the box's contents. Ordering: **personal score desc, then insertion order in
  `members`**. Score alone barely orders anything — measured, `Unique vibe` is
  `10,10,10,10,10,10,10,10,10` and `Absolute cinema` has five 10s — and "what I filed first" is
  a serviceable proxy for "best example". Cheap, stable, no new state.
  ⚠️ **It is a top 10 of UNITS, not of entries** — one slot per resolved unit, faced by its
  best-scored member and marked « +3 ». Otherwise `Shonen I dig`'s top 10 is seven Demon Slayer
  cours and three other things, which is the §1 inflation rendered as a summary. This is the
  one place the collapse is applied for display without a groups region, because a card has
  room for a list and not for two regions.
- **The honest count: « 3 séries · 14 entrées »**, i.e. resolved units alongside raw entries.
  This is where the §1 inflation becomes visible and therefore fixable, per box, by judgement.
  ⚠️ Do NOT write a migration script to collapse existing memberships: `user/boxes.json` is
  durable user data, and the four TYBW cours may be deliberate.
- **« Tout afficher »** when there are more than 10 — navigates to `/boxesV2/[id]`, which *is*
  the full presentation. No expand-in-place.
- **Add via picker**, revealed by a `+` rather than 26 always-mounted search inputs. That panel
  is `position: fixed` and re-measures on scroll and resize.
- **Remove from the card** — an × on a poster.
- **An empty box** (13 of 26 today) renders a CTA, not a blank card, and clicking it opens
  quick-edit directly (§6.2).

---

## 6. `/boxesV2/[id]` — one box

Tabs: **présentation** (default), **recos**, **écartés**. Quick-edit is a *mode* on
présentation, not a fourth tab — "what is this box" stays the page's answer.

⚠️ The sidebar is the **standard filter sidebar** (`RecoFiltersSection`, as every other listing
surface), not the current add/remove panel.

### 6.1 Présentation

The landing card at full length: every member, no « Tout afficher ». Plus one block the current
page lacks —

**What this box is made of**: shared tags, studios, T1 staff, score range, year range. Free
(the ranker already builds those profiles), and it is the honest answer to "what did I actually
draw here". It also tells you at a glance whether the axis is a *content* axis (will project)
or a *form* axis (will not) — which is the distinction the reco-profiles iteration is built on.

⚠️ **An empty box opens straight into quick-edit.** 13 of 26 boxes have no members, so under a
presentation-by-default rule half the boxes render a blank screen.

### 6.2 Quick edit — the fill surface

Replaces « Remplir » entirely. Three regions:

- **Top left — source**: watched titles neither in the box nor excluded (~600 rows, hence the
  filter sidebar).
- **Top right — the box**.
- **Bottom — « écartés »**, one full-width collapsible strip, not a quadrant. Excluded is a
  much rarer state than the other two and does not deserve half the screen.

⚠️ **Each pane is TWO regions, not one flat list**, and that is what removes §4's tie-break:

- a **groups region** on top — one card per group with **≥2** of its members in that pane, and a
  title is free to appear in more than one card;
- a **flat region** below for everything else.

A group with exactly one member present stays in the flat region carrying a group chip: the
groups region's job is "here are the collapses actually happening", and a wall of one-item
group cards would empty that of meaning.

⚠️ **The two panes populate that region from different sets, on purpose.** The BOX pane shows
only `box.groups` — the declared ones — because that region is a picture of how the ranker sees
the box, and an undeclared group casts no collapsed vote (§4). The SOURCE pane shows every
global group with ≥2 members present: nothing there is declared yet, and the region is a
browsing convenience whose whole point is to let one click file a whole show. Filing from a
source group card is the "Add all 17" path, so it writes the membership AND declares the group.

**Groups appear in three placements, with three jobs:**

1. **The groups region, in both panes.** A group renders as ONE card (stacked posters, name,
   count), with a chevron to expand and act on individual entries — that is what makes "file
   all of Bleach" one click while keeping "TYBW yes, base Bleach no" reachable. In the source
   pane the card counts only what is not filed yet (« 4 restants »).
2. **A « Mes regroupements » sidebar section** — the index: every group, its size, how many of
   it are in this box, edit, and create-from-scratch. The reuse and management surface, costing
   no working-pane width. Not a fourth pane.
3. **A group chip on an individual card in the flat region**, for a grouped title standing
   alone — its siblings filtered out, or only one of them present. Click opens the blade.

**Interaction — drag-and-drop AND multi-select**, with this split, because click cannot mean
both "select" and "move":

- **Card body = select.** Shift-click for a range within a pane, Escape clears. A bulk bar
  appears with the selection: « Ajouter (12) » / « Écarter (12) ».
- **Hover buttons = act on that one card** (`+` / `⊘` in source, `−` in the box, `↩` in
  écartés), so filing one at a time stays a single click.
- **Drag = move**, and dragging a card that is part of the selection drags the whole selection.

⚠️ The body selects rather than moves because the source pane holds ~600 rows: an accidental
click that files something is a mistake you then have to hunt for, while an accidental
selection costs nothing.

Native HTML5 drag, no library — `/tier`'s rule, and this repo hand-rolled that one to avoid a
layout dependency.

**The picker stays**, in the source region: adding an unwatched title deliberately is a wanted
feature (§1).

### 6.3 Recos

`computeAnchored` over the box, unchanged engine.

- ⚠️ **`includeSeen` defaults ON.** This is the sharpest change in the revamp: with seen titles
  in the feed, each card carries « Oui, c'est ça » → members and « Non » → excluded, and both
  remove it from the list. It turns the recos tab into a *labeling* surface, and it is the only
  fill mechanism that works for a form axis, because **the crowd graph encodes tone even though
  no catalog field does**.
- The checkbox **stays**, only its default flips. Once a box is well labeled, `includeSeen=0` is
  genuinely what you want (actual watch suggestions), and the URL key already exists.
- Renders `AnimeListHeader` so `cpr` has a control (§1's last bug).
- Anchors are collapsed by group: **one representative per unit** (highest personal score).
  Crowd edges are fetched per anchor, so fractional weighting does not apply here — and this
  also stops one show eating the `MAX_BOX_ANCHORS = 40` budget and saves MAL requests.

### 6.4 Écartés

The excluded list, with `↩` to undo. Needed the day exclusions exist — an error must be
cheap to reverse.

⚠️ Renders from ids alone. See §3: this list contains unwatched titles.

---

## 7. Ranking changes

1. **Group-collapsed profile weights** — `rankBoxCandidates` passes
   `a => 1 / componentSize(a)` to `buildFieldProfile` instead of `() => 1`. §4.
2. **Proposals no longer bulk-add the component.** Whatever survives of the ranker proposes
   *titles*; a group is added by the group card, deliberately. This is the fix for §1's 32%.
3. **Exclusions as a negative signal — a hypothesis, not a decision.** Netting members against
   exclusions, the way `buildDiscriminativeProfiles` nets likes against drops, *might* rescue
   the metadata ranker on form axes. ⚠️ It may also net to ~zero: for `Absolute cinema` the
   exclusions differ from the members by *form*, which is precisely what no catalog field
   encodes — the same ⚠️ CLAUDE.md already carries about widening the rejection side. **Settle
   it with `node scripts/probe-box.js` before shipping it**, and ship weight 0 if it does not
   measure better. This is not CLAUDE.md's "anti-box is a no-op" argument, which is about
   netting against *global* likes — a different pair.

⚠️ `BOX_WEIGHTS` and `BOX_TAG_MIN_RANK` stay as they are. They were measured against
`ANCHORED_WEIGHTS` and won; re-tuning them belongs to the profiles iteration.

---

## 8. `BoxChips` on the anime detail page

Separate from everything above and possibly the highest-leverage item in it.

The chip grid's one real strength is answering "which boxes does **this** show belong to", and
that question currently has no other home. `BoxChips` already exists and has exactly one
caller. Putting a row of it on `/anime/[id]` turns filing from a 12,298-cell chore into a
side-effect of browsing — at the moment you are actually thinking "oh, that one made me cry".

Given 15% coverage after two labeling sessions, this is the change most likely to move the
number.

- Writes through the existing incremental `add`/`remove` (⚠️ never a full `members` replacement
  — many chips against many boxes would race).
- Files **the title**, never its component. §1.

---

## 9. API surface

| Route | Change |
|---|---|
| `GET /api/anime/boxes` | + `excluded`, + `groups`, + resolved unit count, + a `top` slice (10 lean rows) so the landing renders without N+1 member fetches |
| `PUT /api/anime/boxes/[id]` | + `exclude` / `unexclude` and `declare` / `undeclare` incremental arrays, same shape and same race argument as `add`/`remove`. ⚠️ `declare` must never imply `add` (§4) |
| `GET /api/anime/boxes/[id]/members` | + `excluded` rows |
| `GET /api/anime/boxes/[id]/grow` | deleted as a page-facing route (§2) |
| `GET/POST /api/anime/groups`, `PATCH/PUT/DELETE /api/anime/groups/[id]` | new — « Mes regroupements » CRUD |
| `GET /api/anime/watched-groups` | reshaped into the quick-edit source query: ungrouped by provider franchise, filterable, unpaginated or large-paged |
| `GET /api/anime/recommendations/mix?box=` | anchors collapsed by group (§6.3) |

**MCP**: `list_boxes` / `box_candidates` / `create_box` / `edit_box` keep working (flat
`members` is unchanged). ⚠️ `deleteBox` stays blocked **by name** in `eslint.config.mjs`, and
the group writers must be considered against the same rule before being exposed — they are not
exposed in this iteration.

---

## 10. Out of scope, deliberately

- **Reco profiles** — its own document.
- **Threading « Mes regroupements » into `/catch-up`, `/quick-rate`, `/franchise/[id]`.** The
  store shape does not prevent it later; doing it now doubles the surface for no measured need.
- **A cleanup migration on existing box memberships.** §5.
- **Retuning `BOX_WEIGHTS`.** §7.

---

## 11. Measurement plan

Nothing here ships on taste alone where a number is available.

- **`scripts/probe-box.js`** — re-run per box before/after the group collapse (§7.1) and, if
  built, before/after exclusion netting (§7.3). The §1 table is the baseline.
- **Coverage** — filed titles / 720, and non-empty boxes / total, before and after. The
  revamp's actual thesis is that these move off 15% and 13-of-26.
- **The unwatched-bulk-add count** — 487 of 1,539 must go to 0 by construction, not by filter.
- ⚠️ `scripts/backtest-reco.js` does **not** apply to any of this. It grades the global feed
  against held-out 8+ completions; a box is the owner overriding a ranking on purpose, the same
  category the `num_episodes` knob was rejected in.
