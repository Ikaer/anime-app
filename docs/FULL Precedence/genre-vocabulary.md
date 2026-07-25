# The genre vocabulary issue

> **✅ DECIDED AND SHIPPED 2026-07-25 — option C, union.** `genres` is merged
> element-wise across providers (`unionGenres` in `domain/animeUtils.ts`) instead
> of taken wholesale from one. **Nothing is lost, so the 60-value problem below is
> void** — MAL's themes and demographics stay, and AniList's assignments are added
> on top.
>
> The doc argued C "requires a new merge mode" and "re-conflates the taxonomies".
> The first is true and turned out to be ~25 lines; the second is a real cost that
> was accepted — MAL's `genres` was already three taxonomies in one field, so the
> union does not make it worse, it just declines to fix it. **Option D remains the
> better long-term shape** and is not foreclosed: splitting `themes` /
> `demographics` out later is a pure re-partition of a field that now contains
> strictly more data.
>
> What the union actually buys, measured on the live store (this was NOT known when
> the options below were written — the whole framing was about avoiding *loss*, not
> about gain):
>
> | | |
> |---|---|
> | Titles gaining ≥1 genre from AniList | **7,807 of 17,128 (45.6%)** |
> | Genre assignments added | **11,087** |
> | Biggest single gain | `Slice of Life` on 1,893 titles |
> | Live filter effect | Mystery 1,018 → 1,222 · Slice of Life 1,184 → **3,078** |
>
> Vocabulary is unchanged at 78: `Thriller` is AniList's only non-MAL genre name,
> and `GENRE_ALIASES` folds it into MAL's `Suspense` as this doc recommended.
> Verified on Death Note — gains `Mystery`, and does **not** list both `Suspense`
> and `Thriller`.
>
> **Studios did NOT get the same treatment**, and the asymmetry is the useful part:
> genres union cleanly *because they are name-keyed*, so dedupe is a `Set`. See
> [studio-id-namespace.md](studio-id-namespace.md).
>
> The analysis below is kept as the reasoning.

> **Problem E3 (original framing).** The decision is `genres` should come from
> AniList. Measured against the live store, that **drops 60 of 78 genre values**
> with nothing replacing them. This is the hardest of the three problems and the
> one that needs a product decision, not just an implementation.

## Measured (2026-07-24, live store + live `GenreCollection`)

| | Count |
|---|---|
| Distinct MAL genre names in `catalog/mal.json` | **78** |
| AniList genre names (`GenreCollection`) | **19** |
| Shared | **18** |
| AniList-only | **1** — `Thriller` |
| MAL-only (**lost on a straight flip**) | **60** |

**Shared (18):** Action, Adventure, Comedy, Drama, Ecchi, Fantasy, Hentai, Horror,
Mahou Shoujo, Mecha, Music, Mystery, Psychological, Romance, Sci-Fi, Slice of Life,
Sports, Supernatural.

**Lost (60):** Adult Cast, Anthropomorphic, Avant Garde, Award Winning, Boys Love,
CGDCT, Childcare, Combat Sports, Crossdressing, Delinquents, Detective, Educational,
Erotica, Gag Humor, Girls Love, Gore, Gourmet, Harem, High Stakes Game, Historical,
Idols (Female), Idols (Male), Isekai, Iyashikei, Josei, Kids, Love Polygon, Love
Status Quo, Magical Sex Shift, Martial Arts, Medical, Military, Mythology, Organized
Crime, Otaku Culture, Parody, Performing Arts, Pets, Racing, Reincarnation, Reverse
Harem, Samurai, School, Seinen, Shoujo, Shounen, Showbiz, Space, Strategy Game,
Super Power, Survival, Suspense, Team Sports, Time Travel, Urban Fantasy, Vampire,
Video Game, Villainess, Visual Arts, Workplace.

**`Suspense` (MAL) ≈ `Thriller` (AniList)** is a naming difference for the same
concept, not a genuine gain or loss — the one rename mapping worth encoding.

## Why this is not a lateral move

MAL's `genres` field **conflates three taxonomies**:

| Axis | Examples |
|---|---|
| Genre proper | Action, Romance, Horror |
| Theme / setting | School, Isekai, Military, Space, Vampire, Time Travel |
| Demographic | Shounen, Seinen, Josei, Shoujo |

AniList's `GenreCollection` is genre proper only — a **cleaner taxonomy**, which is
the appeal. But the themes and demographics MAL carries do not move somewhere else
on a flip; they are simply **gone from the record**.

### Two things that break

1. **The genre filter collapses 78 → 19 options.** Filtering the list by `Isekai`,
   `School`, `Shounen` or `Military` stops being possible. These are high-volume
   values on this store — School (2,261 titles), Shounen (2,246), Historical
   (1,604), Seinen (1,192).
2. **The reco `genre` source loses most of its discriminating power.** The IDF
   profile keys on genre **name** (`scoring.ts`: `genre: a => (…genres).map(g => g.name)`),
   and IDF specifically rewards *rare* values. The rare, high-signal values are
   exactly the ones being dropped (Villainess 31, Magical Sex Shift 33, Medical 54,
   Showbiz 52). A 19-value vocabulary — where most titles carry Action/Comedy/Drama —
   is close to noise for affinity scoring.

**Not affected:** `VIEW_PRESETS` filters on no genre values (verified), so the
preset remap I initially expected is a non-issue.

## Rejected: substituting AniList tags

AniList `tags` (419 distinct, ~7/title) contain many of the lost concepts. **This
is not a solution and should not be re-proposed.**

**Tags are a different axis from genres.** They are a crowd-ranked, open-ended
descriptor set with relevance ranks and categories; genres are a small closed
taxonomy. Collapsing one into the other to paper over a vocabulary gap destroys
the distinction that makes each useful — and the app already treats them as
separate reco sources (`genre` and `anilistTags`) for that reason. Losing genre
values is a genre problem and has to be solved on the genre axis.

*(Recorded here because the measurement is tempting and this reasoning has to be
re-derived otherwise.)*

## Options

**A. Straight flip.** `genres: ['anilist','mal']`. Clean 19-value taxonomy; lose 60
values, the filter options, and most genre affinity signal. Simple; genuinely lossy.

**B. Keep genres on MAL.** Retains all 78. Contradicts the AniList-catalog
direction, and keeps the conflated taxonomy. The status quo.

**C. Element-wise union.** AniList genres ∪ MAL genres. Retains everything, but
**requires a new merge mode** — precedence takes array fields *wholesale* from one
winning provider and never merges element-wise (the model states this explicitly for
`studios`). It also re-conflates the taxonomies inside one field, i.e. it reproduces
exactly the problem AniList's taxonomy is attractive for.

**D. Split the axes — recommended.** Take `genres` from AniList (19, clean), and
promote MAL's extras into their **own catalog fields**:

```
catalog.genres        ← AniList  (19 values, genre proper)
catalog.themes        ← MAL      (School, Isekai, Military, Space, …)
catalog.demographics  ← MAL      (Shounen, Seinen, Josei, Shoujo)
```

This applies the same principle as *"tags are different from genres, don't merge
them"* one level up: MAL's `genres` is itself three taxonomies in a trench coat, and
this separates them instead of picking a winner. Nothing is lost, each field has a
single clear source, the filter gains structure (filter by demographic *or* theme),
and the reco engine can weight the three independently rather than having genre
signal diluted.

**Cost:** MAL's 78 values must be partitioned into genre/theme/demographic — a
one-time hand-curated mapping table (~60 entries), which is the honest bulk of the
work. Also new filter dimensions (~6 spots each, per `CLAUDE.md`), and new reco
sources if themes/demographics should score.

## Decision — C (union), shipped 2026-07-25

Picked **C**. The full rationale and measurements are in the banner at the top of
this doc; in short, the option list above was written to answer "how do we avoid
losing 60 values", and C answers it by not losing anything — while turning out to
*add* 11,087 genre assignments the store did not have.

**D is not foreclosed and remains the better end state.** Splitting `themes` and
`demographics` out of `genres` is now a pure re-partition of a field containing
strictly more data than before, and the ~60-entry partition table would be the
same deliverable. C was taken first because it is ~25 lines against D's several
days, and because C makes D's eventual payoff larger rather than smaller.

**A is now off the table**: it was only ever justified by the taxonomy-cleanliness
argument, and the union delivers AniList's clean assignments without discarding
MAL's 60 values.

## Non-goals

- Merging tags into genres (rejected above).
- Changing how `anilistTags` scores — that source is fine and independent.
