# The genre vocabulary issue

> **Problem E3.** The decision is `genres` should come from AniList. Measured
> against the live store, that **drops 60 of 78 genre values** with nothing
> replacing them. This is the hardest of the three problems and the one that needs
> a product decision, not just an implementation.

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

## Decision needed

Pick A, C or D before flipping `genres` in the per-field precedence map. **D is
recommended**; A is acceptable only if the genre filter and the genre reco source
are both considered expendable. **Do not flip to A by default** — on this store it
would silently degrade both the filter and the reco engine.

If D: the partition table is the deliverable, and it should live in this folder
next to this doc.

## Non-goals

- Merging tags into genres (rejected above).
- Changing how `anilistTags` scores — that source is fine and independent.
