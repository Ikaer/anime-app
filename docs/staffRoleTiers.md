# Staff role importance tiers

Proposal for emphasising important credits in the detail page's staff section.

## The problem, measured

The detail page renders `sources.anilist.staff` as one flat list, role left / name
right, in AniList's `RELEVANCE` order. Measured over the live store
(`catalog/anilist.json`, 19,301 entries):

| | |
|---|---|
| titles carrying a `staff` array | 19,293 |
| …of which non-empty | 16,878 |
| total credits | 298,362 |
| credits per title | median 7, p90 **50** (the cap), mean 15.5 |
| titles at the 50 cap | 2,861 |
| **distinct raw role strings** | **28,812** |
| distinct roles after normalization | 2,502 |

So on a popular title the section is 50 undifferentiated rows in which
`Episode Director (eps 8, 13, 20, 33, 34)` has exactly the same visual weight as
`Director`. Note CLAUDE.md's existing warning that AniList's RELEVANCE sort is only
loosely importance-first — the order cannot be leaned on.

The 28,812 → 2,502 collapse is the whole trick: role strings carry **trailing
parenthetical qualifiers**, 16,142 distinct ones. The frequent ones:

```
8064 (OP)      5907 (English)              1874 (OP, ED)
7422 (ED)      5790 (ep 1) … 3525 (ep 2)     961 (Italian)
               1163 (eps 1, 2)                931 (Brazilian Portuguese)
```

## Shape: a pure function of the name, exactly like `genreAxis`

This is structurally the same problem as the three genre axes
([genreAxis.ts](../src/lib/domain/genreAxis.ts), docs/DECISIONS.md E3), and should
be built the same way — `staffRoleTier(role): 1 | 2 | 3 | 4` in a new client-safe
`src/lib/domain/staffRole.ts`:

- **A pure function of the role string**, which works because the string is already
  the identity key AniList gives us.
- **Closed whitelists for T1 / T2 / T4, open fall-through to T3** — mirroring
  `theme`'s role as the genre fall-through. A role AniList adds later is imprecise
  but never unclassified, and never silently hidden.
- **No new catalog field, no precedence entry, no migration, no re-sweep.** A
  misclassification is fixed by editing an array.

Live split: 298,362 credits → **16% / 23% / 32% / 30%**.

## The four tiers

### T1 — Auteur (median 2 rows, p90 5)

Who this show *is*. Small on purpose; this is the tier that gets real emphasis.

```
Director  ·  Chief Director  ·  Original Creator  ·  Original Story
Series Composition  ·  Character Design  ·  Music
```

### T2 — Creative department heads (median 2, p90 10)

```
Script · Screenplay · Script Composition · Storyboard
Art Director · Art Design · Color Design · Director of Photography · Editing
Sound Director · Sound Design
Chief Animation Director · Animation Director · Chief Episode Director
Character/Action/Mechanical/Effects Animation Director · Animation Supervisor
Main Animator · Assistant Director · Unit Director
Original Character Design · Mechanical Design · Concept Art
Music Composition · Music Arrangement · Music Lyrics · Music Director
Animation Producer · Original Plan
```

`Animation Producer` is the one producer credit here — it is the production-side
creative anchor, not a committee seat.

### T3 — Contributing crew + business + theme songs (median 2, p90 18)

Everything unlisted falls here. Explicitly included, so the family stays in one
tier instead of scattering:

```
Producer · Executive Producer · Chief Producer · Associate Producer
Assistant Producer · Line Producer · Planning · Planning Producer
Music Producer · CG Producer · Advertising Producer · Sound Producer
```

Landing here by fall-through: `Theme Song Performance/Composition/Lyrics/Arrangement`,
`Insert Song *`, `Sound Effects`, `Background Art`, `Prop Design`,
`Sub Character Design`, `Special Effects`, `Assistant Animation Director`,
unqualified `Episode Director`, and the ~1,978-role long tail.

### T4 — Peripheral, collapsed by default (median 1, p90 18)

Rank-and-file production, localization, promo, admin:

```
Key Animation · 2nd Key Animation · In-Between Animation · In-Betweens Check
Animation · Finishing · Coloring · Paint · Digital Paint · Layout · Photography
Video/Online/Offline/HD Editing · Recording* · *Engineer · Audio Mixing
CG Animation · CG Modeling · 2D Works · 3D Works
Advertising · Title Logo Design · Endcard · Eyecatch · Special Thanks
Production Desk/Office/Manager/Generalization · Production Committee
System Manager · Translator · Translation · every `* Assistance`
```

## Three qualifier rules — this is where the value is

Applied to the parsed qualifiers, and they matter more than the whitelists:

1. **`ADR *` and any non-Japanese language qualifier → T4, unconditionally.**
   The dub cast/crew (5,907 `(English)`, 961 `(Italian)`, 931 `(Brazilian
   Portuguese)`, …) is irrelevant to an app that already restricts cast to
   Japanese seiyuu. This alone is ~7% of all credits.

2. **An `ep`/`eps` qualifier demotes exactly one tier** (`Director (ep 3)` → T2,
   `Storyboard (ep 5)` → T3, `Key Animation (ep 1)` → T4). Demoting by one rather
   than flooring at T3 is deliberate: an anthology's per-segment directors stay
   visible as core crew.

3. **`OP` / `ED` qualifiers are deliberately ignored** (15,486 instances). Correct
   for `Theme Song Performance (ED)` — the qualifier is *which* song, not a
   demotion. Debatable for `Episode Director (OP, ED)`; called as a non-issue
   because that credit is T3/T4 either way.

### ⚠️ Trailing whitespace is load-bearing, not hygiene

The live store holds `"Producer "` (770), `"Director "` (436), `"Music "` (313) as
**separate raw strings**. The lookup must `trim()` before matching or 1,549
credits drop out of T1/T2 into the fall-through and quietly lose their emphasis.
Same failure class as `genreAxis`'s documented `GENRE_ALIASES` hazard — skip the
normalization step and a value is silently misfiled rather than visibly broken.

⚠️ **That normalization is TWO trims, and they are not interchangeable.** The
figure above is what breaks when both go; each also guards a case of its own,
re-measured 2026-08-26 over 301,628 credits:

| trim | removing it alone moves | the case only it covers |
|---|---|---|
| `parseStaffRole`'s `raw.trim()` | 141 credits / 108 strings | The peel regex is `$`-anchored, so whitespace AFTER the closing paren makes it fail outright — `"Episode Director (ep 2) "` keeps its qualifier in `base`, matches no whitelist, and rule 2 never fires. 266 live credits carry the shape. |
| `key()`'s `.trim()` | 37 credits / 16 strings | `staffRoleTier` splits a qualifier on `;`, manufacturing an untrimmed part when the dub language is not first — `" English"` in `(OP; English)`. Rule 1 then misses it. |

Consequently **normalizing once at `staffRoleTier`'s entry cannot replace the
pair**: the `;` split runs after any input-level trim and produces fresh
untrimmed substrings. The bare `"Producer "`-shaped strings are covered by both,
which is what makes either trim look dead when removed on its own — so both
cases are pinned individually in `tests/domain/staffRole.test.ts`.

## ⚠️ T1 can be empty — the render must tolerate it

**1,690 titles with staff have no T1 credit at all.** Mostly shorts and music
videos, but also anthologies: on *Halo Legends* and *Genius Party Beyond* every
`Director` carries an `(ep N)` qualifier, so rule 2 lands all of them in T2. That
is the honest answer — an anthology has no single auteur — but the section cannot
assume a non-empty head. Similarly `JAA Meets Yokohama` genuinely credits 36
directors (T1 max = 36); any "headline" treatment needs a row cap or a wrap that
survives that.

## Verification against real titles

**Cowboy Bebop** (50 credits) — T1 = Hajime Yatate, Shinichirou Watanabe, Keiko
Nobumoto, Toshihiro Kawamoto, Youko Kanno. T2 = 10 rows (Yamane, Higashi,
Nakayama, Oogami, Tsurubuchi, Kobayashi, + music directors + producers→T3). The
nine `Script (eps …)` credits and five `Episode Director (eps …)` credits fall to
T3/T4, along with `Script (German)`.

**JoJo Part 4** (50 credits) — T1 = Araki, Katou, Tsuda, Kobayashi, Nishii,
Kanno. Consolidating producers cut T2 from 18 rows to **11 rows of pure creative
crew** (p90 12 → 10); the 4 `Producer` + 3 `Planning` + `Line Producer` now sit
together in T3. All 16 `Episode Director (eps …)` credits are T4.

## Rendering — as shipped

In [anime/\[id\].tsx](../src/pages/anime/[id].tsx):

- **T1** — own block above the grid, **name first and large**, role beneath it.
  This inverts the crew grid on purpose: down there the role is the scanning key,
  here the name is. No heading (the block speaks for itself), and guarded on
  non-empty.
- **T2** — the existing two-column `.staff-list` grid, under a small muted
  `Chefs de poste` label.
- **T3** — same grid, dimmed role *and* name, labelled `Équipe & production`.
- **T4** — collapsed behind an `Autres crédits (N)` `<details>`, and **dimmed like
  T3 once expanded** — at full weight it sat below a dimmed T3 and inverted the
  hierarchy.

`StaffRows` is its own component with its own `<style jsx>` (the `Field`
precedent): styled-jsx only scopes JSX it can see, so the dim state is a **prop**
rather than a parent class — a `.tier-3 .staff-row` descendant selector would have
to cross the scope boundary via `:global`.

Role strings themselves stay **raw and untranslated** — the `/precedence`
precedent. Only the tier headings are translated (`detail.staffTier.*`, a
cast-built dynamic family, so it is registered in CLAUDE.md's exhaustive-by-hand
list).

### Live verification

| | T1 | T2 | T3 | T4 | affinity marks |
|---|---|---|---|---|---|
| JoJo Part 4 (watched) | 6 | 11 | 17 | 16 | **0** — statused |
| Mugen Train (unseen) | 5 | 24 | 17 | 4 | 5 |
| Genius Party Beyond (anthology) | **0** | 14 | 21 | 15 | 0 |

All three match the offline measurements exactly. The anthology renders with no
headline block and its per-segment directors in T2, as rule 2 intends. Affinity
counts also verified per-title across two consecutive unseen loads (so the warm
memoized index is not leaking a previous title's numbers): The Promised Neverland
4 / 11 / 4 / 4, then Mob Psycho 100 II 4 / 22 / 10.

⚠️ **The one case where the tiered render is worse than the flat list it
replaced:** Mugen Train's T2 is 24 rows, **14 of them labelled `Animation
Director`**. That is honest data — a film with a large animation-director credit
list — but 14 identical role labels in a two-column grid read as noise. Not a
reason to restructure the tiers; noted so it isn't rediscovered as a bug. If it
ever needs fixing, the fix is collapsing repeated role labels within a group, not
moving `Animation Director` out of T2.

## Out of scope

`/stats`' technical-staff dimension ([stats.ts](../src/lib/domain/stats.ts)) reads
the same `sources.anilist.staff` and could weight or filter by tier off the same
lookup. Not designed for here.

---

# Addendum: coupling the tiers to catalog presence

Investigated: should a person's prominence across the catalog ("appears a lot")
modulate the tier? **Measured answer: not as a raw count, and the useful version
is much narrower than it first looks.**

## Finding 1 — raw catalog presence measures the ROLE's throughput, not the person

Distinct staff people: **49,897**. Titles per person: median 2, p90 12, p99 52,
max 498. 46% appear on exactly one title.

The top of the global list is not who you'd expect:

| titles | person | what they are |
|---|---|---|
| 498 | Jin Aketagawa | Sound Director |
| 352 | Masafumi Mima | Sound Director |
| **345** | **John Ledford** | **ADR/dub executive (T4)** |
| 333 | Yoshikazu Iwanami | Sound Director |
| **314** | **Gen Fukunaga** | **Funimation founder (T4)** |
| 223 | Justin Cook | ADR producer (T4) |
| 155 | *Miku Hatsune* | a Vocaloid, via Theme Song Performance |

Four of the seven most-credited "people" in the catalog are dub-industry
executives or a synthesized voice. A naive prominence weight promotes exactly the
credits the T4 rule exists to hide.

Scoping to T1/T2 credits does not fix it — the list is then dominated by **sound
directors and editors**, because those are high-throughput jobs. Per-role credits
for a person at the 95th percentile:

| role | people | median | **p95** | p99 |
|---|---|---|---|---|
| Sound Director | 378 | 2 | **77** | 310 |
| Editing | 585 | 2 | **53** | 101 |
| Music | 1,738 | 2 | **24** | 61 |
| Series Composition | 855 | 2 | **24** | 59 |
| Director | 2,740 | 2 | **18** | 34 |
| Character Design | 2,556 | 2 | **14** | 30 |
| Animation Director | 4,275 | 2 | **10** | 19 |
| **Chief Director** | 385 | 1 | **6** | 14 |

A flat threshold ("≥50 credits = prolific") flags nearly every working sound
director and **zero** chief directors — Anno, Miyazaki and Shinbou included. The
number is not comparable across roles, so it cannot be used raw.

## Finding 2 — within-role percentile is comparable, but marks nearly everything

Normalizing to a percentile *among people holding that same role* makes the
statistic meaningful. But because per-role medians are 1–2 credits, the 85th
percentile only means "has more than two credits" — which nearly everyone on a
notable title's staff clears. Applied to Cowboy Bebop, **19 of 23 T1/T2 rows get a
mark.** Emphasis that fires on 83% of rows is not emphasis.

Only a p99 cut is selective enough (Bebop → 3 rows). Two problems remain even
there:

- **House pseudonyms rank top.** Bebop's #1 is `Hajime Yatate` at 169 credits —
  Sunrise's collective pen name, not a person. `Izumi Toudou` (Toei), `Ken Raika`
  and `MONACA` (a studio) all sit in the top 20 by T1 credits. There is no field
  distinguishing them from real people.
- **The pair granularity fragments a career.** Keiko Nobumoto scores 0% as Bebop's
  `Series Composition` (1 credit) and 91% as `Script` (12) — the same legendary
  writer, two rows, opposite marks.

## Finding 3 — the counts are truncated and are not filmographies

`staff` is AniList's **top 50 by RELEVANCE**, and 2,861 titles sit at that cap. So
a person's count is "titles where they made the top 50", not their filmography. It
under-counts precisely the people who are always present but never headline. Any
number shown to the user would be wrong in a way that is hard to explain.

## Recommendation

**Don't couple prominence into the tier.** The tier answers "how important is this
role on this show" and is complete on its own; prominence answers "how notable is
this person", and the two multiplied would let a prolific editor outrank the
director. Keep the tier as the layout axis.

If a prominence signal is wanted, the version worth building is **the personal
one**, not the catalog one — as a **secondary annotation inside a tier**, never a
re-ordering across tiers:

> Yuki Kajiura · Music · **19 in your list**

### It must be scoped to T1, and that is not a detail

Scoping the count to the statused list kills the dub-executive/Vocaloid half of
Finding 1 — they never enter a statused list. It does **nothing** about the
throughput half. Measured over T1+T2 credits, **15 of the top 25 are Sound
Directors or Editors**: the annotation would print "98 in your list" beside Jin
Aketagawa and "30" beside Sawano on the same page.

Restricting the count to **T1 credits only** fixes it structurally, with no second
mechanism — Sound Director and Editing are T2, so they can never carry the mark.
Verified: **zero** Sound Director/Editing rows in the T1-only top 25, which reads
as it should:

```
30 / 81  avg 8.3  Music               Hiroyuki Sawano
22 / 43  avg 8.0  Series Composition  Hiroshi Seko
19 / 82  avg 7.8  Music               Yuki Kajiura
18 / 30  avg 6.8  Series Composition  Kenta Ihara
12 / 27  avg 9.4  Music               Kensuke Ushio
```

Counting **per person, not per person×role**, also makes Finding 2's fragmentation
moot — Nobumoto stops splitting into a 0% row and a 91% row.

Do **not** apply within-role percentiles to the personal count: those counts have
median 1 / p90 5, so percentiles there would be noisier than the catalog version
rejected above.

### The threshold depends on whether you've seen the title

T1-only, per person: 1,597 people hold a T1 credit in the list — **684 with ≥2,
370 with ≥3, 166 with ≥5, 32 with ≥10.** But the fire rate splits sharply by
context:

| | ≥3 in list | ≥5 in list |
|---|---|---|
| T1 rows marked, **watched** titles | 56% | 37% |
| T1 rows marked, **unseen** titles | **15.8%** | **9.8%** |
| unseen titles with ≥1 mark | 26% | 18% |

On a title you've already watched the mark is near-useless — of course its staff
recur in your list. On an **unseen** title it is a genuine discovery signal at a
properly selective rate. Example, unmodified from the live store:

> **Kimetsu no Yaiba Movie: Mugen Ressha-hen** (unseen)
> Original Creator Koyoharu Gotouge (6) · Director Haruo Sotozaki (6) ·
> Character Design Akira Matsushima (6) · Music Gou Shiina (7) · **Yuki Kajiura (19)**

So: **show the annotation only on titles with no effective status**, or accept that
it is decoration on watched titles. `≥3` at 15.8% is the recommended default; `≥5`
if it still reads busy.

⚠️ **Note the deliberate inversion vs. the reco engine.** `anilistStaff` in
[scoring.ts](../src/lib/reco/scoring.ts) is IDF-weighted — there, a *rare* shared
staff member is the strong signal, because the question is "does sharing this
person predict I'll like it?". Here the question is "is this person worth
noticing?", and frequency is the signal. Both are correct; they are different
questions. Do not unify them.

Cost note: `buildStaffAffinity` walks **every row** of `getAnimeForDisplay()`
(~25k) and filters on `getEffectiveStatus` inside the loop — only the ~683
statused rows contribute, but the scan is catalog-wide, because that array is what
the page already holds. Memoized on the row array's identity
(`getStaffAffinity`), so it runs once per slice change rather than once per
detail-page view — the same WeakMap treatment `byCredits` and `/api/anime/genres`
use.

## What the catalog-presence version would have looked like, for the record

Within-role percentile, marked ★/★★/★★★ at p85/p95/p99. Rejected, but the failure
is instructive — on Cowboy Bebop, **Shinichirou Watanabe scores 91% as Director
and gets no ★★**, because Director's p99 is 34 credits and he has 13. The single
most recognizable name on the page fails the cut, while `Hajime Yatate` — a
pseudonym — tops it at 100%. That is the whole argument in one row.
