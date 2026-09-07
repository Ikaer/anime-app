# Reco **profiles** — per-axis weighting for a box

Status: **design, not built.** Scoped out of [« Mes boîtes » v2](../boxesV2/DESIGN.md),
which names this document as its own §10 out-of-scope entry.

⚠️ **It is sequenced after the whole `/boxesV2` swap, not merely after its §4 group collapse,
and that is a hard dependency rather than a preference.** §4 is what makes the tuning
*meaningful* ([§2](#2-why-this-cannot-be-built-before-boxesv2)); the swap is what makes it
*attachable*, since boxesV2 §2 deletes `src/pages/boxes/[id].tsx` and the page-facing `grow`
route, which are two of the four surfaces [§9](#9-api-surface) modifies. Building against
them first would mean writing the profile plumbing twice.

The owner's ask, in their words: a recommendation *profile* card — « Absolute cinema »
should weight the **director** more, « Puni pour l'animation » the **animation staff and
studio**, « Chara design I dig » the **character designer**. A page to build profiles with
sliders, testable live against a box or an ad-hoc anchor set, and attachable to a box to
refine its recos.

Every number below was measured against the live store on 2026-09-07 (26,722 catalog
titles, 721 statused, 716 of those carrying AniList staff, 26 boxes). Scripts were throwaway
probes in the shape of `scripts/probe-box.js`; the one worth keeping is named in
[§11](#11-measurement-plan).

---

## 1. What already exists, and what is missing

**`BOX_WEIGHTS` in [boxes.ts](../../src/lib/reco/boxes.ts) already IS a profile.** It is a
box-local `Record<MetaField, number>` — tags 1.0, staff 0.35, genre 0.25, studio 0.05 —
that measurably beat `ANCHORED_WEIGHTS`, and whose module comment records exactly why studio
was demoted from 0.15 to 0.05. So the storage shape, the override plumbing and the
justification-by-measurement are all precedent. **The feature is largely "make that per-box,
and add the fields the owner is actually naming."**

**The fields he names do not exist.** `anilistStaff` is ONE `MetaField` over the whole
top-50 credit list, so "the director matters more here" is not expressible — there is no
knob that separates a director from a key animator. That split is the real content of this
feature; the sliders are the easy half.

The raw material is there: [staffRole.ts](../../src/lib/domain/staffRole.ts) parses role
strings, peels qualifiers and tiers them T1-T4, and its whitelists enumerate the individual
roles. What it does not do is group them by *craft* — T1 mixes the director, the character
designer and the composer into one tier precisely because it answers "how important", not
"which department".

### Measured: the staff space this splits

301,252 credits over 2,488 distinct base roles (after `parseStaffRole` peels qualifiers).
Coverage is lopsided, in a useful way:

| population | titles | with AniList staff |
|---|---|---|
| whole catalog | 26,722 | 17,710 (66.3%) |
| **statused list** | 721 | **716 (99.3%)** |

⚠️ **Read that asymmetry the right way round.** A box's *members* are always statused, so a
profile is built from near-complete data. Its *candidates* may not be — a third of the
catalog carries no staff at all and scores a flat 0 on every family, which is the same
"scoreable population" problem `affinity.ts` solves with a percentile over the scoreable set
rather than over everything. It matters in [§7](#7-the-preview-pool-is-the-unseen-catalog).

---

## 2. Why this cannot be built before boxesV2

boxesV2 §1 measured that a multi-cour show buys a multiple of the vote: `buildFieldProfile`
weights every member `() => 1`, so Bleach's 5 cours cast 5 votes. For metadata fields that
inflates a tag. **For staff fields it decides who LEADS the profile**, because
`buildFieldProfile` accumulates and then `normalize`s to max 1.

Live, « Absolute cinema » is 10 entries and **3 shows** (Ghost in the Shell, Bleach ×5,
Link Click ×4). Its director profile today:

```
Tomohisa Taguchi 1.00, Haoling Li 0.71, Hikaru Murata 0.61, Yuanyuan Lu 0.32,
Masashi Itou 0.31, Mizuho Nishikubo 0.24, Mamoru Oshii 0.23, Noriyuki Abe 0.22
```

On a box whose stated axis is *cinema*, Mamoru Oshii sits at 0.23 while the Bleach and Link
Click blocs hold the top. Post-collapse every show contributes 1×. **A profile tuned against
the inflated version is tuned against an artefact, and the tuning will not transfer** — a
sequencing constraint, not a caveat.

The recurrence numbers say the same thing more bluntly. Collapsing members by connected
component (⚠️ measured with `getFranchiseIndex(all, 'direct')` as a **proxy** — boxesV2 §4 is
explicit that the relation graph only *seeds* a hand-drawn group, so these are indicative of
the collapse rather than its own numbers):

| box | entries | shows | director recurrence | chara-design recurrence | recurring across shows |
|---|---|---|---|---|---|
| Absolute cinema | 10 | **3** | 4 → **1** | 5 → **1** | **0** on every family |
| Chara design I dig | 10 | **3** | 4 → **1** | 5 → **1** | writing only (Michiko Yokote ×2) |
| Shonen I dig | 14 | **3** | 7 → **1** | 7 → **1** | **0** on every family |
| Bancal et je l'assume | 7 | 7 | 2 → **2** | 1 → 1 | Tetsurou Araki ×2, Hiroyuki Sawano ×3 |
| Laugh | 34 | 17 | 4 → **2** | 5 → **2** | Seiji Kishi ×2, Masato Kouda ×3, +7 |

⚠️ **On the three boxes the owner named as the motivating cases, no person recurs across two
shows in any craft family.** The whole apparent recurrence was one show's cours.

That is not a reason to abandon the feature — it is a reason to be honest about what it is:

> **A craft slider is a RETRIEVAL knob, not a learned axis.** With 3 shows the profile is a
> lookup table of 8 people, and cranking `staffDirector` means "show me more by these
> people". That is exactly what was asked for. It is *not* taste inference, and the UI must
> not imply that it is ([§8](#8-the-page)).

Cross-show agreement starts appearing around 7 shows (`Bancal et je l'assume`) and is
comfortable at 17 (`Laugh`). The profile page should say which regime a box is in.

⚠️ **« Puni pour l'animation » currently holds ONE member** (Blue Lock vs. U-20 Japan, 5
animation credits of 50 staff). The box that motivates `staffAnimation` — itself the
lowest-coverage family in the set at 59.2% — has a one-show profile today. It is excluded
from every table above, which filters to boxes with ≥5 members. This is not an argument
against the field; it is the sharpest possible statement of §2's point: the sliders are
built before the labeling that gives them something to weigh, and boxesV2 exists to make
that labeling cheap. Ship the field, and expect it to say nothing until the box is filled.

---

## 3. The field set

Eight families, each a closed whitelist over `parseStaffRole(role).base`, in the `genreAxis`
/ `staffRoleTier` shape: **a pure function of the role string**, so no new catalog field, no
precedence entry, no migration, no AniList re-sweep, and a misclassification is fixed by
editing an array.

Measured over the **statused list** (the population a box's members and the fill loop live
in). `match med` is the median NONZERO `fieldMatch` value pooled over the 10 boxes with ≥5
members against all statused candidates, at floor 1 — the field's raw contribution scale
before any correction:

| field | roles | cov | credits/title (med / p75 / p90) | distinct people | match med | scale |
|---|---|---|---|---|---|---|
| `staffDirector` | Director, Chief Director, Assistant Director, Unit Director, Series Director | 96.1% | 1 / 2 / 2 | 3,345 | **0.273** | ÷3 |
| `staffWriting` | Series Composition, Script, Screenplay, Script Composition | 91.7% | 1 / 2 / 3 | 2,691 | **0.324** | ÷2 |
| `staffOriginal` | Original Creator, Original Story, Original Plan, Original Work | 94.0% | 1 / 1 / **1** | 3,901 | **0.575** | ÷3 |
| `staffCharaDesign` | Character Design, Original Character Design | 95.8% | 1 / 2 / 2 | 3,846 | **0.368** | ÷3 |
| `staffAnimation` | Animation Director (+ Chief / Character / Action / Mechanical / Effects / Assistant), Animation Supervisor, Main Animator | 59.2% | 1 / 3 / 7 | 5,010 | 0.076 | — |
| `staffMusic` | Music, Music Composition, Music Arrangement, Music Director | 91.0% | 1 / 1 / 2 | 2,491 | **0.369** | ÷3 |
| `staffArt` | Art Director, Art Design, Color Design, Director of Photography, Concept Art, Background Art | 86.3% | 3 / 4 / 5 | 3,899 | 0.100 | — |
| `staffSound` | Sound Director, Sound Design, Sound Effects | 85.2% | 1 / 2 / 2 | 634 | **0.382** | ÷4 |
| *ref* `anilistTags` (rank ≥ 60) | — | 100% | 14 | — | 0.169 | floor 10 |
| *ref* `anilistStaff` (top 50) | — | 99.3% | 42 | — | **0.015** | — |

(Distinct-people counts are catalog-wide; coverage and per-title counts are statused.)

**The split fixes the dilution and then overshoots it.** The existing `anilistStaff` field
measures 0.015 against tags' 0.169 — the ~11× dilution `weights.ts` documents and compensates
for with a 1.0 default weight and a 0-3 slider range. Narrowing to a family moves the value to
**0.076-0.575**, i.e. from 11× too small to as much as 3.4× too large, and — worse for a
slider panel — spread across a factor of **7.6 between the families themselves**. Neither end
is usable on a page with eleven sliders side by side, which is what §4 is for.

### ⚠️ Writing and Original are two fields, not one

The obvious merge (one `staffWriting` covering Series Composition, Script, Screenplay, Script
Composition, Original Creator and Original Story) was measured and **rejected**, because the
merge hides both halves:

| set | cov | med / p75 / p90 | people | match med @1 |
|---|---|---|---|---|
| merged | 98.9% | 2 / 3 / 4 | 6,015 | 0.137 |
| `staffWriting` alone | 91.7% | 1 / 2 / 3 | 2,691 | **0.324** |
| `staffOriginal` alone | 94.0% | 1 / 1 / **1** | 3,901 | **0.575** |

The merged 0.137 sits comfortably near tags' 0.169 and would take **no §4 correction at all** —
but it is the average of a 0.324 field and a 0.575 field, each of which needs one. The merge
manufactures a safe-looking number out of two unsafe ones, purely because carrying two credits
instead of one doubles `fieldMatch`'s denominator.

They are also different questions. **`Original Creator` is the mangaka — a SOURCE credit, not
an anime-writing one.** Sharing it means "adapted from the same author" (every CLAMP
adaptation, every Urasawa adaptation), which is a genuinely useful axis and a completely
different one from "same series composer". A box drawn on adaptation pedigree and a box drawn
on scripting deserve separate sliders.

⚠️ **`staffOriginal` is the tightest field in the set — p90 1, max 5, 3,901 people — and
therefore the sparsest**: 45 pooled hits across the ten measured boxes, against
`staffDirector`'s 137 and `staffSound`'s 1,116. That is the correct behaviour for a
high-precision field, not a defect (it is `staffSound`'s problem exactly inverted), but it
means the slider will read as inert on most boxes and should be ordered last in the staff
group.

### Rejected family boundaries, each with the number that rejected it

- ⚠️ **`Key Animation` inside `staffAnimation`.** 31,387 credits over 7,815 people, the
  single most common role in the store. Including it: coverage 66.6%, median 2 / p90 **16**
  credits, match median **0.036**. Excluding it: coverage 59.2%, median 1 / p90 7, match
  median **0.076** — twice the signal. Key Animation is precisely the mass that buries a
  series composer inside `anilistStaff`, and re-importing it into the family *named after
  animation* would recreate the problem the split exists to solve. « Puni pour l'animation »
  wants the animation **directors**, not the 40-person key-animation roster.
- ⚠️ **`Storyboard` inside `staffDirector`.** A directorial function, but adding it moves the
  family from median 1 / p90 2 to median 2 / **p90 6, max 18**, because storyboard is credited
  per episode. It would turn the one clean near-binary field into a diluted one. A
  `staffStoryboard` field is available later if asked for, at one more IDF pass.
- ⚠️ **`Episode Director`.** 12,448 credits, 40.4% coverage, p90 8 on the statused list.
  Per-episode by construction — `staffRoleTier` already demotes it a tier for exactly this
  reason. Not a craft axis, an episode roster.
- ⚠️ **`Theme Song *` inside `staffMusic`.** Would raise coverage 91% → 95.3% and the median
  from 1 to 3, but `Theme Song Performance` is 13,045 credits of *recording artists* — the
  band that sang the OP is not the show's composer. Sharing Yoasobi is not sharing Kensuke
  Ushio. A `staffThemeSong` field is a separate ask.
- ⚠️ **`Chief Animation Director` inside `staffCharaDesign`.** It is in practice the
  chara-design enforcer, and folding it in raises coverage 95.8% → 96.3%. It also raises the
  median from 1 to 2 and lifts the statused people count 627 → 1,019, diluting the one field
  whose entire purpose is to name a single person. It stays in `staffAnimation`, which is
  where its title says it is.

### `staffSound` is offered but flagged

634 distinct people catalog-wide, **147 across the whole statused list** — an order of
magnitude fewer than any other family. Consequently it is the highest-hit-rate field in the
set (1,116 pooled hits against `staffDirector`'s 137) and the least discriminative: sharing a
sound director means little when 147 people cover 721 shows. It ships at weight 0 with a hint
saying so, the way `nsfw` does in `SOURCE_META`.

---

## 4. ⚠️ The scale correction is NOT `MATCH_DENOM_FLOOR`'s kind, and must not be merged into it

`flooredFieldMatch` computes `Σ profile-weight / max(valueCount, floor)`. `MATCH_DENOM_FLOOR`
exists because `anilistTags` runs p25 10 / median 14 / p90 23 against a floor of 10 — **the
floor binds on the sparse tail and nothing else**, which is what stopped *LONA* riding one tag
to #2. Measured share of field-carrying titles whose count is at or below the floor:

| field | floor | binds on (statused) | binds on (catalog w/ staff) |
|---|---|---|---|
| `anilistTags` | 10 | **26.0%** ← the sparse tail | — |
| `staffArt` | 1 | 3.9% | 26.3% |
| `staffAnimation` | 1 | 29.7% | 50.5% |
| `staffWriting` | 2 | 84.7% | 84.7% |
| `staffDirector` | 3 | **97.5%** | 98.4% |
| `staffCharaDesign` | 3 | **97.0%** | 97.9% |
| `staffMusic` | 3 | **97.9%** | 98.3% |
| `staffOriginal` | 3 | **99.9%** | 99.8% |
| `staffSound` | 4 | **100.0%** | 99.8% |

⚠️ **On the five near-binary families the "floor" binds on essentially every title, so it is
arithmetically `weight /= floor` — a uniform rescale, not an evidence discount.** Writing it up
as "this stops a one-credit title riding to the top" would be false: on a field where 97% of
titles have exactly one credit there is no spread to protect against. It exists so that **1.0
on the director slider and 1.0 on the tags slider contribute comparably**, which is the
precondition for an eleven-slider page meaning anything at all.

So it gets its own constant, its own name, and a comment saying which of the two jobs it does:

```ts
/** Scale normalizers — NOT MATCH_DENOM_FLOOR's evidence floors. See DESIGN §4. */
export const PROFILE_DENOM: Record<StaffFamily, number> = {
  staffDirector: 3, staffOriginal: 3, staffCharaDesign: 3, staffMusic: 3,
  staffSound: 4, staffWriting: 2,
  staffAnimation: 1, staffArt: 1,
};
```

⚠️ **The inversion is the thing to preserve: the two families that get NO correction
(`staffAnimation`, `staffArt`) are the only two with real within-field spread**, and
`staffAnimation` is *under*-scaled at 0.076 rather than over. A future editor reading a table
of eight numbers will take it for one mechanism applied evenly. It is not. `staffWriting`'s 2
is the one genuinely intermediate case — it binds on 84.7%, so it is mostly a rescale and
partly a floor.

⚠️ **Two denominator tables are now in play and a ranker must not guess between them.** A
profile weights staff families (`PROFILE_DENOM`) *and* `anilistTags` / `genre` / `studio`
(`MATCH_DENOM_FLOOR`). The resolver looks up `PROFILE_DENOM` for a `StaffFamily` key and
`MATCH_DENOM_FLOOR` for everything else — one function, `denomFor(field)`, so the choice is
made once rather than at each of the two call sites that would otherwise fork.

**Rejected: folding the divisor into the default weight instead** (`staffDirector: 0.117`).
Arithmetically identical for 97.5% of titles and simpler to explain, but wrong on the tail
that remains — *JAA Meets Yokohama* genuinely credits 36 directors, and a bare weight divisor
would let it match as strongly as a one-director film. It also puts the correction inside the
value the user drags, so the slider's own number stops being comparable across fields, which
is the problem being solved. Reusing `flooredFieldMatch` costs nothing and handles both.

**Rejected: per-field slider ranges.** `SOURCE_META` already gives `anilistStaff` a 0-3 max
where everything else is 0-1; that is the current workaround for the dilution, and it is
exactly what makes the existing weights panel hard to reason about — a comment in `weights.ts`
has to explain the range is "not a typo". Eight more fields on eight more scales would make
the profile page unreadable. Normalize the values, keep every slider 0-1.

---

## 5. Where the fields live — ⚠️ not on `MetaField`

Adding eight members to `MetaField` puts them in `computeIdfSet` and `buildFieldProfileSet`,
which are the **feed's** shared builders: eight extra catalog-wide IDF passes and eight extra
profile builds on a path that reads none of them. That is CLAUDE.md's *hot-path latency*
category — the one cost the project posture says to design around, and explicitly not its
reprocess-freely one.

Two precedents already refuse exactly this, and both are followed here:

- `staffT1Extractor` is "**deliberately NOT a `MetaField`** … promoting it would add a seventh
  IDF pass and a seventh positive profile that nothing reads."
- `boxes.ts` builds its own `idfFor(all, minRank)` rather than calling `computeIdfSet`,
  because a box counts only tags above the rank floor.

So the families go in a new **client-safe** module `src/lib/reco/staffFields.ts`:
`StaffFamily`, the whitelists, `STAFF_FAMILY_EXTRACTORS`, `PROFILE_DENOM`, and a
`staffFamilyIdf(all)` memoized on the row array's identity (the WeakMap trick `byCredits`,
`getFranchiseIndex` and `boxes.ts`' own `idfFor` all use, so it self-invalidates when a slice's
mtime moves). Client-safe because the profile page renders the field metadata — the same
reason `weights.ts` and `scoring.ts` are.

### ⚠️ Overturning `staffT1Extractor`'s IDF-reuse decision, with the measurement

`scoring.ts` reuses `idf.anilistStaff` for its T1 extractor, arguing that it "measures how
rare the PERSON is across the corpus, which is the same question whatever role this particular
credit was". **That argument does not transfer to the families, and the store says so.** Share
of a family's people whose family-scoped IDF differs from the shared full-credit IDF by more
than 0.25 nats:

| family | people | diverge | example |
|---|---|---|---|
| `staffDirector` | 3,345 | **71%** | Shinichirou Watanabe 7.36 as director vs 6.64 overall |
| `staffCharaDesign` | 3,846 | **63%** | Toshihiro Kawamoto 6.67 vs 6.02 |
| `staffMusic` | 2,491 | 36% | Youko Kanno 6.53 vs 6.24 |
| `staffAnimation` | 5,010 | 34% | Masahiro Andou 6.90 vs 6.15 |

The divergence runs in the meaningful direction: Watanabe is rarer *as a director* than as a
credit-holder, because a prolific person accrues credits in roles that are not the one being
asked about. "How rare as a director" is genuinely a different question from "how rare as a
credit-holder" — which is **not** true for `staffT1Extractor`, whose T1 set spans six unrelated
crafts and so has no single role to be rare in. The cost is measured: **74-76 ms per family
pass, 651 ms for all eleven** (eight families + tags + genre + studio) over 26,722 records,
once per store change, memoized.

The T1 extractor keeps the shared IDF unchanged. Nothing about the rejection profile moves.

---

## 6. Data model

### `user/reco_profiles.json` — new file

```ts
type ProfileField = RecoSource | StaffFamily;

interface RecoProfile {
  id: string;                                     // slug from the name, deduped — Box's mint
  name: string;
  emoji?: string;
  description?: string;                           // what axis this weighting is FOR
  weights: Partial<Record<ProfileField, number>>; // SPARSE — see below
  createdAt: string;
}
```

A bare array beside `boxes.json` / `hidden.json` / `seed_mutes.json`. Store in
`src/lib/reco/profiles.ts`, for `boxes.ts`' and `feedback.ts`' reason: an engine annotation,
off the seven-slice join, so a write here cannot change an assembled row and must not
invalidate the row cache.

⚠️ **Durable user data.** No provider can re-supply a hand-tuned weighting. It belongs in
CLAUDE.md's *"costs that are real"* list, not in the reprocess-freely one — `data:copy*` before
anything destructive, and ask before an operation that can lose it.

### The key is `RecoSource | StaffFamily`, deliberately the wide union

A profile has to serve **two rankers with different vocabularies**:

- `rankBoxCandidates` (the fill loop) takes `Record<MetaField, number>` — metadata only.
- `computeAnchored` (the box's recos tab, `/mix`, « Plus comme ça ») takes `SourceWeights`,
  which additionally carries `crowd`, `anilistCrowd`, `rejection`, `popularity`.

Picking either narrow vocabulary forces a translation layer on the other. `MetaField ⊂
RecoSource` already, so `RecoSource | StaffFamily` is a strict superset of both; **each ranker
resolves the subset it understands and ignores the rest.** Sparse storage follows
`sparseViewDefaults` / `sanitizeCatalogPrecedence`: only values differing from the surface's
base are persisted, so a later change to a shipped default is not frozen by a stored no-op.

### ⚠️ `anilistStaff` is forced to 0 whenever any family is non-zero

The eight families are **subsets of** `anilistStaff`'s top-50 list. `DEFAULT_WEIGHTS.anilistStaff`
is 1.0 — the largest metadata weight in the app — and it is persisted in the URL `w` param. So
a profile that sets `staffDirector` without zeroing `anilistStaff` **counts a shared director
twice, at scales ~18× apart** (0.015 raw against 0.273 raw).

This is the trap `RECO_WEIGHT_PRESETS` already documents in prose — *"Explicit zeros are
required: the metadata sources now default non-zero, so a 'pure crowd' preset must override
them or it silently inherits them."* Here it is made unrepresentable instead: **the resolver
zeroes `anilistStaff` when any `StaffFamily` weight is non-zero**, and the UI states it rather
than doing it silently. `anilistStaff` stays the feed's field; the families are the profile's.

That divergence is not new — `BOX_WEIGHTS` already differs from `ANCHORED_WEIGHTS` on four
fields for measured reasons. This is one more.

### Attachment

`Box` gains `profileId?: string` — one optional field, absent when unset, matching how `emoji`
/ `description` / boxesV2's `excluded` are handled. ⚠️ A profile is **referenced, not copied**:
editing it must move every box pointing at it, which is the whole reason it is an object rather
than a per-box weight blob. A profile referenced by a box cannot be deleted without a
confirmation naming those boxes.

---

## 7. The preview pool is the unseen catalog

⚠️ **The obvious pool — the box fill loop's — demonstrates as broken on the exact box that
motivated the feature.** `rankBoxCandidates` scopes to the statused list, correctly (a box
member must be something the owner watched and can judge). Reach of a craft profile there,
against reach over the whole catalog:

| box | director hits: catalog (statused) | chara-design | animation |
|---|---|---|---|
| **Absolute cinema** | 119 (**2**) | 29 (**1**) | 312 (18) |
| Chara design I dig | 73 (3) | 62 (**3**) | 254 (16) |
| Shonen I dig | 83 (6) | 31 (3) | 416 (40) |
| Laugh | 247 (30) | 207 (21) | 280 (31) |
| Bancal et je l'assume | 85 (17) | 149 (15) | 169 (26) |

**« Absolute cinema »'s director slider can move exactly two titles in the statused list.**
Catalog-wide it reaches 119, and the answer is legible: the top of it is eleven Tomohisa Taguchi
credits (Persona 3/4, Digimon Kizuna, Kino no Tabi 2017, Sousei no Onmyouji, Natsu e no Tunnel),
then Haoling Li's Chinese-animation run. That is a real answer to "more by these people"; the
statused version is silence.

So **two pools, stated as two:**

- **Fill loop** — `rankBoxCandidates`, statused only, unchanged. A profile still applies here;
  it just moves little on a small box, and the page must not pretend otherwise.
- **Profile preview** — the **unseen catalog**, reusing `affinity.ts`' eligibility exactly: not
  in `SEEN_STATUSES`, not `hidden`, not 👎, no `RatingIntent`, not a premature sequel. Memoized
  on the row array's identity, like every other catalog-wide index here.

This is affordable, which was the design's open question and is now measured:

| operation | cost |
|---|---|
| all 11 IDF passes (8 families + tags + genre + studio) | **651 ms**, once per store change |
| one 11-field rank over 721 statused | **54 ms** |
| one 11-field rank over 26,722 catalog | **541 ms** |

⚠️ **The preview is a pure local read and calls no provider** — the property that makes a live
slider possible at all. The crowd half (`computeAnchored`) does cost provider requests but
caches edges per anchor, so it is free after first load; the preview therefore defaults to the
metadata pool, and the crowd-anchored view is a second tab loaded on demand.

⚠️ **The preview pool is NOT a fourth recommendation surface.** It is a tuning instrument,
scoped to the profile page. A catalog-wide metadata ranker already exists and already ships a
badge — `affinity.ts` — and duplicating its output under a different name is the kind of second
verdict CLAUDE.md already refuses between « Recommandé » and `recoMeta`.

---

## 8. The page

`/profiles` (list + create) and `/profiles/[id]` (edit + live preview), composing the standard
sidebar sections and `AnimeListHeader` the way `/mix` and `/boxes` do.

**Left: the sliders.** All eleven on one 0-1 scale (§4), grouped *staff* / *content* / *crowd*,
with the crowd group disabled while the preview is on the metadata pool. Commits to state on
release, not per tick — `RecoWeightsSection`'s existing rule, same history-spam reason.

**Right: the ranking, re-ranked live.** 541 ms per full recompute is under the threshold where
a slider stops feeling attached to its result, and the fill-loop pool at 53 ms is instant. The
anchor is either a box (`?box=`) or an ad-hoc set (`?a=` — `/mix`'s key and `/mix`'s picker, so
a mix can be promoted to a profile test without retyping it).

**⚠️ The diagnostic block is not optional, and it is the cheapest defence in the design.** Per
family, over the anchor set after group collapse: how many distinct people, and how many recur
across two or more shows. §2's table, rendered:

> `Absolute cinema` — **0 directors shared across 3 shows.** This slider retrieves more work by
> these 8 people; it has not learned an axis.

Without it the failure mode is invisible and confident. Measured: `Laugh` (a comedy axis) with
`staffMusic` at 1.2 returns **Boku no Hero Academia ×3, Shaman King, Wistoria ×2** — Yuuki
Hayashi's action-shonen filmography imported wholesale into a comedy box, changing 10 of the top
10. `staffDirector` there does the same: Tsuki ga Michibiku Isekai Douchuu ×2, Silent Witch.
**A craft slider on a box whose axis is not that craft returns the person's whole unrelated
filmography** — the same shape as the Kinema Citrus / *Black Bullet* failure `BOX_WEIGHTS` was
measured into existence to fix, in a different field.

The same slider on a box that *is* a craft axis does exactly what was asked. `Bancal et je
l'assume` (7 shows) with `staffDirector` 1.2 → Shingeki no Kyojin ×4, Death Note, Highschool of
the Dead, Vampire in the Garden — Tetsurou Araki's filmography. With `staffMusic` 1.2 → 86 ×2,
the SnK final seasons, Aldnoah.Zero — Hiroyuki Sawano's. Both changed 9-10 of the top 10 against
a tags-only baseline. **The knob works; the diagnostic is what tells you whether it is the right
knob for this box.**

### Shipped starting points, not just a blank slate

`RECO_WEIGHT_PRESETS`' precedent: sparse, named, merged onto the base. Four that map directly
onto what was asked for — **Réalisation** (director + writing), **Animation** (animation +
studio + art), **Chara design** (chara design + animation), **Adaptation** (original + writing,
the `staffOriginal` axis §3 split out) — plus **Défaut**, which is `BOX_WEIGHTS` unchanged.
⚠️ Every preset states `anilistStaff: 0` explicitly, for §6's reason.

---

## 9. API surface

| Route | Change |
|---|---|
| `GET/POST /api/anime/profiles` | new — list / create |
| `PATCH/PUT/DELETE /api/anime/profiles/[id]` | new — edit / delete (refuses while referenced) |
| `POST /api/anime/profiles/preview` | new — `{ weights, anchors \| box, pool }` → ranked lean rows. POST because the weights blob is larger than a query string wants and the call is not cacheable |
| `PUT /api/anime/boxes/[id]` | + `profileId` (nullable, to detach) |
| `GET /api/anime/boxes/[id]/grow` | resolves the box's profile over `BOX_WEIGHTS` |
| `GET /api/anime/recommendations/mix?box=` | same resolution, over `ANCHORED_WEIGHTS` |

**MCP.** ⚠️ Profile writers are **not** exposed, and the boxes carve-out is not precedent for
them. That carve-out was opened because "what do these eight shows have in common" is something
a model is measurably better at than `rankBoxCandidates`, and because a box is a named object
the owner sees on a page. A profile is a **weighting that silently changes every ranking that
follows** — the same objection that blocks `addSeedMute` by name, and sharper, because a model
able to set one would be tuning the answer it is about to give. *Reading* a profile (so a model
can explain a ranking, or suggest a weighting in prose) is fine and useful; add `profiles.ts`'
writers to the `importNames` block in `eslint.config.mjs` alongside `deleteBox`, `addSeedMute`
and `removeSeedMute` — a named exception with a stated reason, never a widened pattern.

---

## 10. Out of scope, deliberately

- **A global profile for `/recommendations`.** The feed's weights are already URL-tunable and
  already backtestable; a durable named profile over them is a different feature with a
  different justification (and `backtest-reco.js` *does* apply there, which changes how it would
  have to be argued). This iteration is per-box only.
- **Threading a profile into `affinity.ts`' « Recommandé » mark.** Tempting — it is the one
  existing ranker whose pool matches §7's — but the mark is deliberately one verdict from one
  weighting, and a per-box profile has no meaning on the main list, which is not scoped to a box.
- **A `staffStoryboard`, `staffThemeSong` or `staffProduction` family.** Each is one array and
  one IDF pass; none was asked for, and §3 records the numbers that would justify or refuse them.
- **Learning a profile from a box.** Fitting weights to the members is fitting to 3-17 points
  with no held-out set, and §11 says why the harness cannot referee it either.
- **Retuning `BOX_WEIGHTS` itself.** boxesV2 §7 deferred it here; this design makes it
  *overridable* rather than *different*. The shipped default stays what was measured.

---

## 11. Measurement plan

- **`scripts/probe-profile.js`** — the probe this design was written from, promoted:
  `--box <id> --weights staffDirector=1.2 --pool catalog|statused`, printing the ranking, the
  per-field match values and the §8 diagnostic. It **measures rather than asserts**, like
  `probe-box.js` and `backtest-reco.js` — do not convert it into pass/fail.
- **`scripts/probe-box.js`** — re-run per box before/after the field split, to confirm the fill
  loop is unchanged where the profile is `Défaut`. That is the regression this is most likely to
  break silently.
- ⚠️ **`scripts/backtest-reco.js` does NOT apply.** It grades the global feed against held-out
  8+ completions. A profile is the owner *overriding* a ranking on purpose — the same category
  `/boxes` sits in, and the same category the rejected `num_episodes` commitment knob was refused
  in, but inverted: that one was a guess dressed as a model change, this one is the owner
  speaking directly. A profile will very likely score *worse* on the harness, and that is not an
  argument against it.
- **Tests worth their place** (the suite pins what fails SILENTLY):
  - `staffFamilyOf(role)` on the boundary cases §3 rejected — `Key Animation` outside
    `staffAnimation`, `Storyboard` outside `staffDirector`, `Theme Song Performance` outside
    `staffMusic`, `Chief Animation Director` in animation rather than chara-design, and
    **`Original Creator` in `staffOriginal` rather than `staffWriting`**. Each is one whitelist
    edit away from being wrong, with no crash and nothing visibly wrong on screen.
  - `denomFor(field)` routing a `StaffFamily` to `PROFILE_DENOM` and everything else to
    `MATCH_DENOM_FLOOR` (§4). Getting it backwards divides tags by 3 and directors by 10 —
    every slider still moves, and every number is wrong.
  - The `anilistStaff`-zeroing invariant (§6). Double counting at an 18× scale gap produces a
    plausible-looking ranking and no error — the `GENRE_ALIASES` failure mode exactly.
  - ⚠️ Verify each by **breaking the thing it guards** before committing it. A test that has
    never failed has proved nothing.
