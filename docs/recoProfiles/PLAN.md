# Reco profiles — implementation plan

Sequencing for [DESIGN.md](DESIGN.md). The design is approved; this file only says in what
order it gets built, where each phase stops, and what each phase measured.

**The organizing idea: the field split is the feature, and it ships alone first.** The design
says it outright — "the sliders are the easy half". Eight staff families with the wrong
boundaries, or the right boundaries on the wrong scale, produce plausible rankings and no error,
so they land green and measured before a store, a route or a slider exists to hide them behind.

## The prerequisite is met

DESIGN.md §2 sequences this after the whole boxesV2 swap. That is done: `domain/boxUnits.ts`,
`reco/groups.ts`, `Box.groups` / `Box.excluded`, `unitWeightFn` inside `rankBoxCandidates`, and
`/boxes` IS the v2 page. What §2 still owes is its consequence, which is now measurable where it
was not on 2026-09-07: the recurrence table was built on `getFranchiseIndex(all, 'direct')` as a
**proxy** because no group had been declared yet. The group blade has shipped since, so the
diagnostic reads the box's DECLARED units through `resolveBoxUnits(box, getGroups())` — the same
collapse the ranker weights by, so the two cannot disagree about what a "show" is.

## ⚠️ Where DESIGN.md §9 has drifted from the code

- **`GET /api/anime/boxes/[id]/grow` does not exist.** The boxesV2 swap deleted it (DESIGN §1
  predicted exactly that). `rankBoxCandidates`' only live callers are the MCP `box_candidates` and
  `get_box` tools and `scripts/probe-box.js` — no page reads the fill-loop ranking any more.
- **So the box's VISIBLE reco surface is `/api/anime/recommendations/mix?box=`** — the recos tab,
  `computeAnchored` over `ANCHORED_WEIGHTS`. "Attach a profile to refine a box's recos" means that
  route first. `rankBoxCandidates` still resolves the profile (the MCP proposes members through it),
  but it is the secondary consumer, not the primary one.
- **§7's "reuse `affinity.ts`' eligibility exactly" is an extraction, not a call.** `isScoreable`
  is module-private and the eligibility test is inlined in `buildAffinityIndex`'s loop. The preview
  pool exports ONE predicate from there; transcribing the five conditions would be two copies of a
  rule this repo treats as a drift bug.

## Phases

Each phase ends with `npm run build` green.

| # | Phase | Ships | Design |
|---|---|---|---|
| 1 | **Staff families** — `reco/staffFields.ts` (client-safe): the eight whitelists, `staffFamilyOf`, extractors, `PROFILE_DENOM`, `denomFor`, the family IDF; tests; `scripts/probe-profile.js` | nothing visible — numbers | §3, §4, §5, §11 |
| 2 | **Profile model + resolver** — `RecoProfile` / `ProfileField`, the sparse resolver that zeroes `anilistStaff` whenever a family is non-zero, the shipped presets; tests | nothing visible | §6, §8 presets |
| 3 | **Store + API** — `user/reco_profiles.json`, `reco/profiles.ts` (eslint server-only; writers blocked by name on the MCP surface), CRUD routes, `Box.profileId` | nothing visible | §6, §9 |
| 4 | **Rankers honour a profile** — `computeAnchored` and `rankBoxCandidates` take family weights through `denomFor`; `mix?box=` and the MCP box tools resolve the box's profile. `probe-box.js` must read identical where the profile is `Défaut` | better box recos, where a profile is attached | §6, §9 |
| 5 | **Preview** — the unseen-catalog pool (one predicate lifted out of `affinity.ts`), `POST /api/anime/profiles/preview`, the §8 diagnostic block | nothing visible | §7, §8 |
| 6 | **`/profiles` + `/profiles/[id]`** — sliders, live preview, presets, diagnostic; attach from the box page; i18n (a `satisfies Record<StaffFamily, 0>` driver in `dynamicKeys.test.ts`); CLAUDE.md | the feature | §8 |

## Phase 1 — what it decided beyond the design

- **Dub credits are not family members.** DESIGN §3 defines the families over
  `parseStaffRole(role).base` alone, which would file `Director (English)` — a dub director — as
  the show's director. `staffRoleTier` already sends those to T4 unconditionally; the families
  reuse that exact rule (`isLocalizationCredit`, lifted out of `staffRoleTier` so it has one home)
  rather than re-deriving it.
- **A person counts once per family per title.** `fieldMatch` divides by the extracted value
  count and sums over the values, so a person credited both `Director` and `Series Director` on
  one show would weigh twice and inflate the denominator. The extractor dedupes; the design's
  credits/title figures were measured the same way in spirit ("distinct people").
- **Episode-qualified credits stay in.** `Director (ep 3)` is how an anthology credits its
  directors; `staffRoleTier` demotes it a tier for *display*, which is a different question from
  "is this person a director of this show".

### Phase 1 — measured (2026-09-13, office store: 26,771 records, 721 statused, 716 with staff)

`node scripts/probe-profile.js --stats` re-derives DESIGN §3/§4 through the shipped module.
`raw` is the pooled nonzero match median at floor 1 over the 13 boxes with ≥5 members (unit-
weighted, family IDF); `corrected` is the same through `denomFor` — the scale a slider sees.

| field | cov | med/p75/p90 | people | hits | raw | denom | corrected | binds |
|---|---|---|---|---|---|---|---|---|
| `staffDirector` | 96.8% | 1/2/2 | 3,335 | 258 | 0.358 | 3 | **0.195** | 97.5% |
| `staffWriting` | 92.2% | 1/2/3 | 2,521 | 874 | 0.352 | 2 | **0.214** | 85.2% |
| `staffCharaDesign` | 96.5% | 2/2/2 | 3,846 | 185 | 0.409 | 3 | **0.190** | 97.0% |
| `staffAnimation` | 59.6% | 3/5/11 | 5,010 | 335 | 0.087 | 1 | 0.087 | 29.7% |
| `staffArt` | 86.9% | 4/5/6 | 3,898 | 1,482 | 0.120 | 1 | 0.120 | 3.9% |
| `staffMusic` | 91.6% | 1/1/2 | 2,486 | 916 | 0.412 | 3 | **0.156** | 97.9% |
| `staffSound` | 85.8% | 2/2/2 | 632 | 2,121 | 0.425 | 4 | **0.153** | 100.0% |
| `staffOriginal` | 94.7% | 1/1/1 | 3,901 | 94 | 0.484 | 3 | **0.191** | 99.9% |
| *ref* `anilistTags` ≥60 | 98.7% | 14/18/23 | 415 | 8,899 | 0.211 | 10 | 0.197 | 25.9% |
| *ref* `anilistStaff` | 100% | 50/50/50 | 50,371 | 6,057 | 0.020 | 20 | 0.019 | 12.8% |

- **`PROFILE_DENOM` holds.** Every corrected family lands at 0.15-0.21 against tags' 0.197, and
  the two uncorrected ones (`staffAnimation`, `staffArt`) are still the two sitting low — §4's
  inversion, reproduced on a store that has grown (13 measured boxes against the design's 10).
  The raw medians all rose ~20-30% since 2026-09-07, tags' by the same ratio, so the relative
  scales — the thing the table encodes — did not move. `binds` matches the design to the decimal.
- The med/p75/p90 column runs higher than the design's because it is taken over titles that
  carry the family, not over the whole statused list (zeros excluded) — `binds` is computed the
  same way in both and agrees exactly.
- All eight family IDF passes cost **303 ms** over 26,771 records (the design estimated 74-76 ms
  *each*): the role → family lookup is memoized per raw role string, so a credit is parsed once.

`node scripts/probe-profile.js --box all` is the §8 diagnostic through DECLARED units. The boxes
have grown a lot since the design (`Absolute cinema` 10 entries → 31 over 11 units), so §2's
"0 on every family" no longer holds verbatim — but its point does:

| box | entries → units | director | chara design | animation |
|---|---|---|---|---|
| Absolute cinema | 31 → 11 | 1 of 29 shared | **0** of 24 | **0** of 112 |
| Chara design I dig | 25 → 9 | 1 of 27 | **0** of 14 | 1 of 78 |
| Shonen I dig | 19 → 5 | **0** of 15 | 1 of 8 | **0** of 95 |
| Puni pour l'animation | 3 → 3 | 0 | 0 | **0** of 10 |
| Bancal et je l'assume | 7 → 7 | 2 of 8 | 0 | 0 |

⚠️ **The box named after character design still shares no character designer across two of
its nine shows.** Its chara-design slider is a retrieval knob ("more by these 14 people"), which
is what was asked for — and exactly the sentence the page has to print.

⚠️ **The proxy and the declared collapse genuinely disagree, so the diagnostic must read
declared units.** On `Je les aurais suivis n'importe où` the proxy finds 2 directors recurring
where the owner's groups find 0 (a group joins what the direct graph splits); on `La hype m'a pas
eu` it is the reverse — 0 by proxy, 2 declared, because the owner split a component the graph
joins. Reading the proxy would have mislabelled both boxes.
