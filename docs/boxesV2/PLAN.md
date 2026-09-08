# « Mes boîtes » v2 — implementation plan

Sequencing for [DESIGN.md](DESIGN.md). The design is approved; this file only says
in what order it gets built and where each phase stops.

**The organizing idea: three of the design's parts do not depend on the v2 page at
all, and two of those are the highest-value items in it.** The doc reads as one
revamp because it is written as one argument, but the dependency graph is not a
line. Landing the independent parts first means the §1 bugs are fixed while the
big UI is still being built, and each phase ships green against the CURRENT
`/boxes`.

## The dependency graph, and what it implies

- **« Mes regroupements » is foundational, not a feature.** The collapse
  arithmetic is what the ranking fix (§7.1), the landing card's honest count and
  top-10-of-units (§5) and the `/mix?box=` anchor collapse (§6.3) all read. It
  cannot be a late phase. It also has to exist as a **pure function**, separable
  from any UI and from `fs`, because the quick-edit panes compute their groups
  regions client-side.
- **The ranking fix ships against the current `/boxes`.** §7.1 is a one-argument
  change to `rankBoxCandidates`. Nothing about it needs the new page, and it is
  the bug with a measured 50%-of-the-vote cost in three live boxes.
- **`BoxChips` on the detail page (§8) is independent of everything.** The design
  calls it "possibly the highest-leverage item" and it is one component with one
  new caller. It has no reason to wait behind the page revamp.
- **Quick-edit (§6.2) is the only genuinely large UI piece** — two-region panes,
  multi-select, drag, group cards, the blade. Everything else on `/boxesV2` is
  conventional listing work. So it is isolated into its own phase and the blade
  goes with it, because a group card with nothing to open is not shippable.
- **§7.3 (exclusion netting) is a hypothesis, not a build item.** It is scheduled
  as a probe, and ships at weight 0 if it does not measure better.

## Phases

Each phase ends with `npm run build` green and, where a number is available, a
`scripts/probe-box.js` reading.

| # | Phase | Ships | Design |
|---|---|---|---|
| 0 | **Units foundation** — `Box.excluded` / `Box.groups`, `UserGroup` + `user/groups.json` store, the pure collapse in `domain/boxUnits.ts`, tests | nothing visible | §3, §4 |
| 1 | **Ranking fix** — `rankBoxCandidates` weights members `1/componentSize` | better proposals on the CURRENT `/boxes` | §7.1 |
| 2 | ✅ **BoxChips on `/anime/[id]`** | filing becomes a side-effect of browsing | §8 |
| 3 | ✅ **API surface** — groups CRUD, `exclude`/`declare` writes, `top` slice + unit count | nothing visible | §9 |
| 4 | ✅ **`/boxesV2` landing** — box-first cards, top 10 of units, honest count, picker, in-place edit | the new landing, alongside the old | §5 |
| 5 | ✅ **`/boxesV2/[id]` présentation + écartés** | the two simple tabs | §6.1, §6.4 |
| 6 | ✅ **Quick edit + the group blade** | the fill surface | §6.2, §4 |
| 7 | ✅ **Recos tab** — `includeSeen` default on, Oui/Non labeling, `AnimeListHeader`, collapsed anchors | the form-axis fill path | §6.3 |
| 8 | ✅ **Swap** — rename to `/boxes`, execute §2's deletion list in the same commit | v2 is the page | §2 |
| 9 | **Measurement + probes** — coverage before/after, the exclusion-netting probe | numbers, or a weight-0 ship | §7.3, §11 |

## Phase boundaries worth stating

**Phase 0 splits on client-safety, following D2's precedent** (`providers/
capabilities.ts` declarative + client-safe, `providers/registry.ts` runtime +
`fs`). The store is `src/lib/reco/groups.ts` (`fs`, added to the eslint
server-only block); the arithmetic is `src/lib/domain/boxUnits.ts`, client-safe
by folder, so the quick-edit panes can resolve their own regions without a round
trip.

**Phase 1 lands before any v2 UI on purpose.** It is the one change in the whole
document that improves something today, and isolating it is what lets
`probe-box.js` attribute the movement to the collapse rather than to the revamp.
⚠️ It has no effect until a group is DECLARED (§4's ruling), so Phase 1's probe
run needs a hand-written `groups.json` fixture — that is the phase's real work,
not the one-line weight change.

**Phases 4-7 are additive against `/boxesV2`**, so `/boxes` stays green
throughout and the swap in Phase 8 is a rename plus deletions, never a migration.

**Phase 8 is not optional and not deferrable.** The house rule is *delete the
unused thing rather than keep it working*; §2 names every line so the swap cannot
be left half-finished. Two pages, two hooks, one sidebar placement, one route.

## What is NOT in this plan

Reco profiles (its own document), threading groups into `/catch-up`,
`/quick-rate` and `/franchise/[id]`, a cleanup migration on existing memberships,
and retuning `BOX_WEIGHTS`. All four are §10.

---

## Phase 1 — measured result (2026-09-07, live store)

`node scripts/probe-box.js --box all --diff --limit 15`, against the store the
design's §1 table was measured on (26,722 catalog titles, 26 boxes, 13 non-empty).
⚠️ The `--diff` flag exists because the collapse is **inert by default** — it
synthesizes the declaration the blade would produce, since no group has been drawn
yet and a plain before/after would print identical output.

| Box | entries | units | biggest unit's share of the vote | top-15 churn |
|---|---|---|---|---|
| Laugh | 34 | 17 | 15% → 6% | 5/15 |
| We're going on a adventure | 25 | 10 | 32% → 10% | 9/15 |
| Shonen I dig | 14 | **3** | **50% → 33%** | 5/15 |
| Unique vibe | 11 | 6 | 27% → 17% | 5/15 |
| Chara design I dig | 10 | **3** | **50% → 33%** | 4/15 |
| Absolute cinema | 10 | **3** | **50% → 33%** | **10/15** |
| Laugh++ | 7 | 3 | **71% → 33%** | **11/15** |
| Bancal et je l'assume | 7 | 7 | 14% → 14% | **0/15** |
| La hype m'a pas eu | 6 | 5 | 33% → 20% | 5/15 |
| Make me cry hard | 5 | 4 | 40% → 25% | 1/15 |
| Make me emotional | 3 | 2 | 67% → 50% | 2/15 |
| Solidly grounded | 2 | 2 | 50% → 50% | 0/15 |
| Puni pour l'animation | 1 | 1 | — | 0/15 |

**§1's table reproduces exactly** (Laugh 15%, and 50% for each of Shonen I dig,
Chara design I dig and Absolute cinema), and so does the giveaway it predicted:
`Absolute cinema`'s top three become `Koukaku Kidoutai (TV)`, `Psycho-Pass 2` and
`Koukaku Kidoutai: Stand Alone Complex` — the box's own third show, surfacing from
under the Bleach and Link Click blocs — displacing the JoJo / Blue Exorcist /
Jujutsu Kaisen / Hunter x Hunter / MHA list the design named as "Bleach's tag
neighbourhood, not a craft axis".

Three things the §1 table did not have:

- **`Laugh++` is the worst inflation on the store at 71%**, worse than the three
  boxes §1 cites. It is small (7 entries, 3 units), which is exactly why it was
  missed and exactly why it hurts.
- **`Bancal et je l'assume` and `Solidly grounded` churn 0/15**, and that is the
  result worth keeping: a box whose entries collapse to nothing is weighted
  *identically* to before. The fix cannot re-rank a box the owner has not spoken
  about — which is the whole content of §4's "declared, never automatic" ruling,
  observed rather than argued.
- **Churn does not track inflation.** `Shonen I dig` sits at 50% and moves 5 of
  15; `Absolute cinema` sits at the same 50% and moves 10. The share says how
  lopsided the vote was, not how much the answer depended on it — so do not use
  one as a proxy for the other when judging a later tuning change.


---

## Phases 2-4 — what landed, and three decisions taken along the way

**Phase 2 (`BoxChips` on `/anime/[id]`).** The row sits immediately after the
personal-state section, because both answer the same KIND of question — "what do
I make of this" — where the sections above answer "what else is like this".
Verified live on Bleach: 26 chips, correctly pre-lit for its 3 real boxes, and a
toggle round-trips through the incremental `add`/`remove` (11 → 12 → 11 members).

**Phase 3 (API).** `GET/POST /api/anime/groups` + `GET/PATCH/PUT/DELETE
/api/anime/groups/[id]`; `exclude`/`unexclude`/`declare`/`undeclare` on the box
PUT; `unitCount`, `excludedCount`, `groups` and the `top` slice on the box list.

Three decisions worth recording:

- **The pure half of a box write is its own module** ([boxWrites.ts](../../src/lib/domain/boxWrites.ts)).
  `reco/boxes.ts` keeps the persistence; the two rules that have no compiler and
  no visible symptom — *excluding removes from members*, *declaring never adds
  membership* — live in a client-safe reducer so
  [tests/reco/boxWrites.test.ts](../../tests/reco/boxWrites.test.ts) can pin them
  without a store on disk. All four mutations were caught by exactly the intended
  test.
- **`projectGroup` is shared, not cross-imported.** Two routes need it, and one
  API route importing a value out of another is something nothing in this repo
  does — hence [groupSummary.ts](../../src/lib/domain/groupSummary.ts), the
  group-shaped sibling of `leanRow.ts`, for `leanRow.ts`'s own reason.
- **`mintSlugId` moved to [slug.ts](../../src/lib/domain/slug.ts).** Sharing the
  mint is what makes "the same mint as `Box`" true rather than a comment, but
  importing it from `boxes.ts` made `boxes.ts` and `groups.ts` mutually recursive
  — the exact shape `store/recordCache.ts` exists to avoid.

**Phase 4 (`/boxesV2`).** Box-first cards with the honest count, a top-10 of
UNITS, in-place name/emoji/description editing, a per-card picker behind `+`, and
an empty-box CTA.

- ⚠️ **The card's × removes the whole UNIT, not the faced title.** A slot marked
  « +6 » stands for seven entries; dropping one would leave six behind and simply
  re-face the slot, which reads as a control that did nothing. `BoxTopEntry`
  therefore ships `members`.
- **The search field was extracted to a shared
  [AnimePicker](../../src/components/anime/AnimePicker.tsx)** and
  `MixAnchorsSection` now renders it, rather than a second copy. Three surfaces
  need "pick a title", and the panel's geometry rules (fixed positioning,
  capture-phase re-measure, the 460px minimum that stops six KonoSuba seasons
  truncating to one string) are exactly what rots in triplicate.

### Verified in the browser

Live at 1280 (the TV target): no horizontal overflow, the strip wraps, 12 slots
fit per row. The declared box reads **« 3 séries · 14 entrées · 3 regroupements »
with three posters** marked `+4 / +1 / +6`; the undeclared `Chara design I dig`
and `Absolute cinema` beside it still show ten slots each, four of them Bleach
and four Link Click. That side-by-side IS §1's argument, on screen.

Two defects were found by looking rather than by building, and fixed: the `+N`
badge was anchored to the whole slot and landed on top of the title text, and the
full description placeholder repeated on all 26 cards as noise.

⚠️ **The local mirror now holds three synthetic groups** (`bleach`,
`demon-slayer`, `chainsaw-man`) declared on `shonen-i-dig`, created to verify the
chain end to end. Prod (the NAS) is untouched, and the next `npm run
data:copy-salon` purges them.


---

## Phase 5 — `/boxesV2/[id]`, and what the composition block turned out to show

Présentation and écartés, behind a `t` URL key on a new `useBoxV2UrlState`. The
recos tab is Phase 7 and its button is **not** rendered yet — a tab that
announces itself and does nothing is worse than a tab that is not there.

**One endpoint, not four.** `GET /api/anime/boxes/[id]/members` became the box's
whole detail read: the box record, the resolved units, the « écartés » rows and
the composition block. §9 already said it gains `excluded` rows; the rest joined
it because the alternative was the page fetching `/api/anime/boxes` and finding
itself in it, which computes all 26 boxes' `top` slices to render one.

**`faceUnits` is shared, not written twice** ([boxUnits.ts](../../src/lib/domain/boxUnits.ts)).
The landing card and présentation are the SAME rendering at two lengths, so a
slot that faced a different title in each would read as two different boxes.

### The composition block is a diagnosis, and it reproduces §1 a third time

Measured live on the two boxes that make the argument:

| | `Shonen I dig` (3 groups declared) | `Absolute cinema` (undeclared) |
|---|---|---|
| units / entries | **3 / 14** | 10 / 10 |
| top tags | Body Horror **3/3**, Demons 3/3, Gore 3/3, Shounen 3/3 | Urban Fantasy 9/10, Male Protagonist 8/10 |
| studios | *(none shared)* | **Studio Pierrot 3/10**, CMC Media 2/10 |
| T1 staff | *(none shared)* | **Masashi Kudou 5/10, Shirou Sagisu 5/10, Tite Kubo 5/10** |

The undeclared box reports **Bleach's composer, character designer and original
creator as half its identity** — a box that contains three shows. The declared
one reports agreement across three genuinely different shows at 3/3, and honestly
reports that they share no studio and no staff at all. That contrast is what the
block is for: it says whether the axis is a CONTENT axis before any ranked list
is trusted.

⚠️ **Every tally counts UNITS, and that is the pinned invariant.** Counting
entries would render `Shounen 7/14` — plausible-looking agreement that is one
show filed seven times, i.e. §1's inflation reproduced in the one place the owner
goes to check for it. [tests/domain/boxComposition.test.ts](../../tests/domain/boxComposition.test.ts)
pins it, along with the union rule (a unit carries a value if ANY member does —
TYBW's tags differ from base Bleach's), the shared tag floor, and the coverage
line's denominator. ⚠️ The score and year RANGES are deliberately over ENTRIES:
a min and a max are immune to duplication, so collapsing them would only discard
evidence.

Four mutations were run; the third (`untagged` counting tagless entries rather
than units) **survived the first version of its test** — the fixture had no unit
mixing a tagged and an untagged member, which is the only shape that separates
the two readings. Fixture fixed, mutation caught.

### Also fixed, and it was a live bug

`boxesV2.entriesOne` read « {units} séries · {entries} entrée ». It is selected
only when `count === 1`, which forces `units === 1`, so a one-entry box rendered
« 1 séries · 1 entrée ». Both locales corrected.

### Verified

The écartés chain end to end against a throwaway box: add 3 → exclude 1 leaves
**2 members and 1 écarté** (excluding removes from members), and ↩ leaves **2
members and 0 écartés** — un-excluding is deliberately NOT symmetric, so the box
is unchanged and re-filing stays the picker's job.

### Verified in the browser

At 1280 (the TV target): no horizontal overflow, `Absolute cinema`'s ten slots
on one row. The whole loop exercised on a throwaway box, then deleted (26 boxes
before and after):

- **`+6` expands in place** — three slots become nine rows, the six Demon Slayer
  cours reachable under their face.
- **`−` removes the whole unit**; the count and the composition block re-derive
  server-side.
- **`↩` on écartés takes the badge 2 → 1 and leaves membership at 2** — the
  designed asymmetry, visible: un-excluding does not re-file.
- **An empty box opens on the picker**, and the picker files (Mushishi → 0 → 1).
- Tab switch writes `?t=excluded`; landing → detail navigation works client-side.

### Three defects found by looking, none of which a build would catch

1. ⚠️ **The styled-jsx trap, twice on one page.** The tabs rendered as raw UA
   buttons — outset border, `#f0f0f0`, black text — while the build was green
   and every class name was present in the DOM. Two causes, both documented in
   CLAUDE.md and both hit at once: the tabs come from a `tab()` HELPER rather
   than the component's own `return`, and `.bx2d-back` is a className handed to
   `next/link`, which styled-jsx never rewrites. Fixed with the second
   `<style jsx global>` block prefixed with `.bx2d`, the split `catch-up.tsx`
   and `tier.tsx` already make.
2. **The form-axis diagnosis fired on a one-unit box.** Every tally is floored at
   two units, so a one-unit box can never produce a shared value whatever it
   holds — announcing « aucun champ du catalogue ne décrit cet axe » there states
   a conclusion the data cannot support. Now split off as `madeOfTooSmall`.
3. **« 0 séries · 0 entrées »** — French takes the singular at zero, and half the
   boxes are empty, so this was on half the landing page. The plural ternary now
   tests `<= 1` on both surfaces.


---

## Phase 6 — quick edit and the blade

The largest piece in the revamp, and the one the whole design turns on: three
regions, two-region panes, group cards, multi-select, native drag, and the blade.

### What it is made of

| Piece | Where |
|---|---|
| Source query — flat, unpaginated, filterable | `flat=1` on [watched-groups](../../src/pages/api/anime/watched-groups.ts) |
| The blade's seed — a relation component + its name | [franchise-component](../../src/pages/api/anime/franchise-component.ts) |
| Full `rows` for the blade to edit | `GET /api/anime/groups/[id]` |
| One pane, two regions | [QuickEditPane](../../src/components/anime/boxes/QuickEditPane.tsx) |
| Create / edit a group | [GroupBlade](../../src/components/anime/boxes/GroupBlade.tsx) |
| Orchestration, nudge, bulk bar, index | [QuickEdit](../../src/components/anime/boxes/QuickEdit.tsx) |

### Four decisions the design left open

- **The nudge sits ABOVE the box pane, not inside its groups region.** §6.2 says
  that region shows only `box.groups`, and §4 says the UI must OFFER the
  declaration — both are true only if the offer lives somewhere else. Putting an
  undeclared group in the region would break exactly what the region means: a
  picture of how the RANKER sees the box, where an undeclared group casts no
  collapsed vote.
- **`search` goes to the server; every other filter runs in the browser.** The
  whole watched list is fetched once, so changing a media type or a year never
  refetches and the panes never blink. Search is the exception because
  `applyNarrowingFilters` matches romaji + English + Japanese + synonyms while a
  lean row carries only the title currently displayed — a client-side title match
  would quietly stop a `native` reader finding a show by the name on their own
  screen, which is the trap CLAUDE.md spells out.
- **The filters live in quick-edit's own left rail**, not the page's sidebar.
  Présentation and écartés have nothing to filter, and the box's identity header
  and tabs must stay above all three tabs; promoting the whole page to
  `AnimePageLayout` would push them into a column beside a sidebar that is empty
  two thirds of the time.
- **An empty box opens on the PICKER, not on quick-edit.** Quick-edit's shape is
  source-left / box-right, and against an empty box the right pane is a blank
  rectangle taking half the screen to say nothing — the same emptiness §6.1's
  rule exists to avoid, only laid out. The `✎` button is one click away.

### Verified in the browser, at 1280

No horizontal overflow. Every path exercised on the live store and restored
afterwards (14 members, 3 units, 3 groups before and after):

- **Group card expands** — Bleach's 5 cours, each with its own `−`, so
  « TYBW oui, Bleach non » stays reachable.
- **Undeclare → 3 séries becomes 7 séries**, the card leaves the groups region,
  and its five entries drop into « À l'unité » each carrying a `⛓ Bleach` chip.
  That is §4's argument against auto-apply, on screen: nothing is silent either
  way, so explicit is the one that lets the owner decide. The nudge then appears;
  taking it restores « 3 séries · 14 entrées · 3 regroupements ».
- **The blade** seeds from the relation component with the name pre-filled
  (« Steins;Gate », the earliest aired member), lists the unwatched movie marked
  « pas vu », and labels every entry already in another group — five rows reading
  « déjà dans Bleach ». Informational, never blocking.
- **« Ajouter les 2 » writes both** — 14 → 16 entries AND 3 → 4 declared groups,
  in one click, with no nudge left to answer.
- **Shift-click selects a range** (4 selected) and the bulk bar states the pane's
  own verbs; Escape clears.
- **Drag works both ways** — one card into the box (15 → 17 entries), and a
  2-card SELECTION dragged out of it (17 → 15). Dragging a selected card carries
  the whole selection.
- **`⊘` sets aside** (source 706 → 705, strip reads « Écartés (1) ») and `↩`
  restores it.

### Three defects found by looking

1. **The group name truncated to « Dem… »** in the box pane: the action button
   shared its line and both labels are long by necessity. The action moved to its
   own line under the name.
2. **The blade's title rendered behind the app header.** The header is
   `position: sticky; z-index: 100` and the blade is `fixed`, so `top: 0` put the
   blade's own heading under the nav. It now measures the header — and measures
   rather than hardcoding 68px, because that header WRAPS to two lines on a
   narrow viewport, i.e. exactly when the constant would be wrong.
3. **The scrim's `inset: 0` beat its inline `top`.** Longhands now, so the
   click-outside layer starts below the nav too and the nav stays clickable —
   which is the difference between a blade and a modal.

### Still owed before the swap

`CLAUDE.md`'s « /boxes » section still describes the v1 page. It is rewritten in
Phase 8, with the deletions, so the file never documents two pages at once.


---

## Phase 7 — the recos tab

The engine is untouched (`computeAnchored` through `/api/anime/recommendations/mix?box=`).
What changed is the QUESTION the tab asks.

### The anchor collapse pays for itself twice

`resolveBoxUnits` now runs before the `MAX_BOX_ANCHORS` cap, and the mix route
takes **one representative per unit** — the highest-scored member. Measured live:

| Box | anchors before | anchors after |
|---|---|---|
| `Shonen I dig` (3 groups declared) | 14 | **3** |
| `Absolute cinema` (undeclared) | 10 | 10 |

Eleven fewer MAL requests on the declared box, and one show can no longer eat the
40-anchor budget. `Absolute cinema` is the control: five Bleach and three Link
Click entries still asked separately, which is §1's argument in fetch-cost form.

⚠️ **A representative here, fractional weights in `rankBoxCandidates` — and the
two are not inconsistent.** The profile ranker reads every member's METADATA, so
splitting a unit's vote keeps a tag all four cours share at 1 and a tag unique to
one at 1/4. This route fetches CROWD EDGES per anchor: you either ask MAL about a
title or you do not, so a fractional weight has nothing to apply to.

### `includeSeen` defaults ON, and the URL carries the OFF case

⚠️ `seen=0`, never `seen=1`. Decoding it as `=== '1'` would silently invert the
flip the whole tab is about. Verified: the checkbox writes `?t=recos&seen=0` and
the feed goes 11 → 7 (unseen only), with the hint swapping from the labeling
sentence to « Suggestions de visionnage ».

### « Non » is box-local, and that is enforced by the prop it goes through

`AnimeCardView` gained `onBoxVerdict`, deliberately NOT reused from `onFeedback`:
the thumbs write `user/reco_feedback.json`, which reshapes the GLOBAL feed. Checked
on disk after a « Non » — `user/boxes.json` gained the exclusion while
`reco_feedback.json` (2), `hidden.json` (247) and `seed_mutes.json` (2) were all
untouched.

### One divergence found and closed

**Cards-per-row was a `cpr` URL key.** That is the v1 box page's pattern, and it
is out of step with `/` and `/recommendations`, where cards-per-row is a
`ViewDefaults` value — "how it looks", never URL state. Worse, `DisplaySection`'s
own tooltip reads « Enregistré comme valeur par défaut, sur toutes les pages »,
which would have been untrue on this one page. Now persisted through
`useViewDefaults` like everywhere else, and verified: the tab opens at the
owner's stored 6 with no `cpr` in the URL.

§1's last live bug is fixed either way — the v1 tab had no control at all and
rendered two cards wide at the 1280px target.

### Verified, and restored

Box back to 14 members / 0 écartés / 3 declared groups afterwards.

- « Non » → 11 → 10 propositions, Écartés badge 1, title dropped from `members`
  too (`nextExcluded`'s rule).
- ↩ on écartés, then « Oui, c'est ça » on the recos tab → back to 14 entrées,
  still **3 séries** (the collapse holding).
- ⚠️ A `yes` does not remove the card from an `includeSeen` feed on its own — the
  title is still a crowd neighbour — so the tab hides answered cards client-side.
  Without that, answering a question would leave it on screen and the list would
  never shorten.


---

## Phase 8 — the swap

`/boxesV2` is `/boxes`. §2's deletion list executed in full, in one commit.

### Deleted

| | |
|---|---|
| `src/pages/boxes/index.tsx` | the O(titles × boxes) chip grid |
| `src/pages/boxes/[id].tsx` | the three-view detail page |
| `src/hooks/useBoxesUrlState.ts` | with the grid |
| `src/hooks/useBoxUrlState.ts` | replaced by the v2 hook, which took its name |
| `src/pages/api/anime/boxes/[id]/grow.ts` | `rankBoxCandidates` survives as the `box_candidates` engine; its role as the FILL surface does not |
| `src/pages/api/anime/watched-groups.ts` | reshaped into [watched](../../src/pages/api/anime/watched.ts) |
| 38 dead `boxes.*` i18n keys | in both locales |

`BoxChips` **moved rather than died**, as §2 said it would: its caller is now the anime
detail page. `MixAnchorsSection` keeps its `/mix` placement and loses its box-sidebar one.

### Two judgement calls beyond the list

- **`watched-groups` was renamed to `watched`, not just reshaped.** A route that
  returns no groups should not be called `watched-groups` — a name that lies is the
  same class of defect as a misleading tool description. Its grouping and pagination
  existed for the chip grid; the v2 panes group by « Mes regroupements » instead, so
  the provider's franchise components are the wrong axis there.
- **`boxesV2.*` folded into `boxes.*`.** 41 keys renamed, two collisions
  (`saveError`, `notFound`) resolved in v2's favour since both old ones were dead.

### The guard the swap exposed

⚠️ **`@/lib/reco/groups` was a write path the MCP guard did not cover.** The design
said the group writers "must be considered against the same rule before being exposed";
nothing had done that yet, so a model could have called `deleteGroup`. Now blocked by
name — `createGroup` / `updateGroup` / `deleteGroup` / `editGroupMembers` — the
seed-mute shape, keeping the readers open.

The reason it is a *name* block and not the blanket pattern: saying « these four cours
look like one show » is exactly the suggestion this surface is open for, and the readers
are what let a model explain a box's unit count. The reason the writers are blocked at
all is sharper than the box carve-out faced: a group is **global** and declared per box,
so editing its members silently re-ranks every box that declared it, while a wrongly
filled box costs a few chip clicks in one place.

Verified by breaking it — an `import { deleteGroup, createGroup }` in `mcp/tools.ts`
fails `npm run lint` with 2 errors, which fails `npm run build` through `prebuild`.

### Verified live

`/boxes` renders 26 cards; `/boxes/[id]` renders all three tabs and quick edit
(706 source rows, both panes, declared groups). `/boxesV2`, `/api/anime/watched-groups`
and `/api/anime/boxes/[id]/grow` all **404**. `/api/anime/watched` returns 720 rows.
The nav needed no change — it always pointed at `/boxes`.

CLAUDE.md's « /boxes » section was rewritten in the same pass, so the file never
documented two pages at once. It now covers « Mes regroupements », the collapse
arithmetic, the composition block, quick edit, the blade and the recos flip, plus the
`user/groups.json` entry in the store layout, `@/lib/reco/groups` in the client-safety
list, and the three new test files in the coverage roll-call.

---

## Where this leaves the plan

Phases 0-8 are done. **Phase 9 (measurement) is the only one left**: coverage before
and after (filed titles / 720, non-empty boxes / 26 — the revamp's actual thesis), and
the §7.3 exclusion-netting probe, which ships at weight 0 if it does not measure better.

⚠️ It cannot be run honestly yet. Coverage moves when the OWNER uses the new surfaces;
measuring it against a store whose only groups are the three synthetic ones this session
created would measure the session, not the design.
