# anime-app — Recommendation Algorithm Review

Notes from an MCP session on `anime-tracker` (2026-08-23). Observations are based on
live tool output: `my_stats`, `tier_list`, `recommend` (pool of 974 candidates,
`lastRefresh` 02:20Z).

---

## 1. Baseline observations

### Score distribution vs community

| Scope | n | Mean gap vs MAL |
|---|---|---|
| All rated | 653 | −0.57 |
| ≤ 2010 | 60 | −0.70 |
| ≥ 2020 | 422 | −0.67 |
| 2011–2019 (derived) | ~171 | ~−0.28 |

Two conclusions:

- **There is no era effect.** Pre-2010 and post-2020 harshness are statistically
  indistinguishable. Low scores on canonical classics (End of Evangelion, Gintama,
  Gurren Lagann, GitS: SAC) are title-specific, not generational — Ghost in the Shell
  (1995) is a 10, Hunter x Hunter (1999) and Gundam SEED are 9s.
- **The −0.57 global mean is largely a sampling artifact.** 422 of 653 rated titles are
  post-2020, i.e. seasonal intake that gets triaged. This measures a funnel, not
  severity. Any model that treats the global gap as a "harshness constant" will be
  mis-calibrated.

### Signal decomposition in `recommend`

Contribution ranges observed across the top 15:

| Source | Range | Comment |
|---|---|---|
| `crowd` | 0.63 – 1.00 | Dominant. Clamped at 1.0. |
| `anilistCrowd` | 0.41 – 0.70 | Corroborates `crowd`, largely redundant |
| `suggestions` | 0.35 (flat) | Binary flag, no gradation |
| `anilistTags` / `genre` / `studio` / `anilistStaff` | 0.11 – 0.16 | Too weak to reorder anything |
| `popularity` | −0.131 – −0.149 | Effectively constant |

The feed is, in practice, pure collaborative filtering. Content-based axes exist but
cannot break a tie.

---

## 2. Proposed changes, ranked by leverage

### 2.1 Negative seeds — highest impact

`becauseOf` only ever cites liked titles. The dropped list and the 319 titles rated
below community mean are unused signal.

MAL and AniList recommendation graphs are symmetric, so this reuses the existing data
structure with an inverted weight:

```
affinity = Σ w_i · sim(candidate, seed_i)   for liked seeds
         − λ · Σ w_j · sim(candidate, seed_j)   for disliked / dropped seeds
```

Example: *Deadman Wonderland* scores 1.515 via The Future Diary + Tokyo Ghoul, but it
sits in a cluster that also contains High School of the Dead and similar. If anything in
that neighbourhood is rated low or dropped, the candidate should be pulled down.

Start with `λ` tuned so that a dropped seed weighs roughly half a liked seed, then fit
it properly once §2.4 is in place.

### 2.2 Weight seeds by gap, not by raw score

A 10 on Haikyu!! (MAL 8.43) carries little information — everyone likes it. A 10 on
Shoshimin (MAL 7.36, the single largest positive gap on the board) is the sharpest
available signal, and it is exactly what surfaces Hyouka.

```
seed_weight ∝ (my_score − mal_mean)     # instead of my_score
```

This is TF-IDF applied to seeds: down-weight titles where community consensus is strong,
because "fans of X" is uninformative when X is universally loved. It should meaningfully
sharpen the taste fingerprint without any new data source.

### 2.3 `crowd` saturates and double-counts popularity

Two separate defects:

- **Clamping.** Cowboy Bebop returns exactly `1.000`. Anything at the ceiling is
  indistinguishable from anything else at the ceiling — discrimination is lost precisely
  at the top of the ranking, where it matters most.
- **Count-based scaling.** The term appears to grow with the *number* of matched seeds
  (7 for Cowboy Bebop, 2 for Run with the Wind). Match count correlates with the
  candidate's own popularity, since popular titles appear in more recommendation lists.
  So `crowd` silently re-injects the popularity bias that the `popularity` term is
  trying to remove.

Fix: normalise by the candidate's total recommendation count — use the *proportion* of
its recommendation graph that intersects the seed set, not the raw intersection size.

### 2.4 Replace the affinity score with a predicted rating

`affinityScore` is a hand-weighted sum. It is unfalsifiable: there is no way to tell
whether a change improves it.

There are 653 labelled examples available. Fit a model:

```
features: [crowd_sim, anilist_sim, tag_overlap, studio_affinity, staff_affinity,
           mal_mean, anilist_mean, year, num_episodes, media_type]
target:   my_score
```

Ridge regression for interpretability, gradient boosting for accuracy. Cross-validate
and report MAE. From that point every subsequent change is measurable against a
baseline instead of eyeballed.

Secondary benefit: the learned coefficient on `mal_mean` quantifies how much community
consensus actually predicts the owner's score. Given the gap profile, expect it to be
near zero — which would justify demoting `mean` as a ranking input entirely.

### 2.5 Second head: P(drop)

The stated behaviour is "worst case I bail after 3 episodes". The real cost function is
therefore not "will I like this" but "will I finish this". Dropped labels already exist.

Train a separate binary classifier for drop probability and split the feed:

- **Safe bets** — high predicted score, low drop risk
- **Gambles** — high predicted score, high variance

This also makes `num_episodes` genuinely usable as a feature: Yu Yu Hakusho at 112
episodes is not the same commitment as a 100-minute Maquia, and the ranking currently
treats them identically.

### 2.6 Recalibrate the popularity penalty

Current spread: 0.018 between 339k members (Run with the Wind) and 2.07M (Cowboy Bebop)
— a 6× audience range. This looks like `−k · log(members)` with `k` far too small; the
term is effectively a constant offset applied to everything.

Replace with a percentile rank within the candidate pool, so the penalty spans a usable
range. Without this, `nicheMode` has nothing to work with.

### 2.7 Clean up `anilistStaff`

The staff payload for Run with the Wind lists 38 people, down to "Recording Assistant",
for a total contribution of 0.149. That is dilution, not signal.

- Restrict to Director, Series Composition, Character Design, Music.
- Weight by measured per-person affinity — derived from `my_stats(minMyScore=9)` — rather
  than by mere presence.

For reference, the top-of-list staff changes completely once filtered by score: over the
full list Jin Aketagawa leads with 100 titles (14%), but on titles rated ≥9 it is
Atsuhiro Iwakami (21, 14.1%). The unfiltered ranking measures production volume, not
taste.

---

## 3. Server-side inconsistency

`tier_list` applies filters inconsistently across response fields:

- `minYear` / `maxYear` → `distribution` and `gapSummary` **are** filtered
  (`comparable` returned 60 and 422 respectively).
- `minGap` → `total` returned 40, but `distribution` and `gapSummary` still described
  all 653 titles.

Either behaviour is defensible, but it should be uniform, and the tool description should
state which it is. As-is, aggregate figures cannot be trusted without knowing which
filter produced them.

---

## 4. Suggested order of work

1. §2.4 (predicted rating + MAE baseline) — needed to evaluate everything else
2. §2.1 (negative seeds) — largest expected gain
3. §2.2 (gap-weighted seeds) — cheap, no new data
4. §2.3 (crowd normalisation) — fixes a hidden popularity double-count
5. §2.5 (drop model) — new capability rather than a fix
6. §2.6, §2.7, §3 — cleanup
