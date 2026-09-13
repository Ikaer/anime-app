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
| 1 | ✅ **Staff families** — `reco/staffFields.ts` (client-safe): the eight whitelists, `staffFamilyOf`, extractors, `PROFILE_DENOM`, `denomFor`, the family IDF; tests; `scripts/probe-profile.js` | nothing visible — numbers | §3, §4, §5, §11 |
| 2 | ✅ **Profile model + resolver** — `RecoProfile` / `ProfileField`, the sparse resolver that zeroes `anilistStaff` whenever a family is non-zero, the shipped presets; tests | nothing visible | §6, §8 presets |
| 3 | ✅ **Store + API** — `user/reco_profiles.json`, `reco/profiles.ts` (eslint server-only; writers blocked by name on the MCP surface), CRUD routes, `Box.profileId` | nothing visible | §6, §9 |
| 4 | ✅ **Rankers honour a profile** — `computeAnchored` and `rankBoxCandidates` take family weights through `denomFor`; `mix?box=` and the MCP box tools resolve the box's profile. `probe-box.js` must read identical where the profile is `Défaut` | better box recos, where a profile is attached | §6, §9 |
| 5 | ✅ **Preview** — the unseen-catalog pool (one predicate lifted out of `affinity.ts`), `POST /api/anime/profiles/preview`, the §8 diagnostic block | nothing visible | §7, §8 |
| 6 | **`/profiles` + `/profiles/[id]`** — sliders, live preview, presets, diagnostic; attach from the box page; the page-only i18n (the family `reco.source.*` keys and their `dynamicKeys.test.ts` driver landed in phase 4); CLAUDE.md | the feature | §8 |

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

## Phase 2 — what it decided beyond the design

The pure half is [reco/profileWeights.ts](../../src/lib/reco/profileWeights.ts): `RecoProfile`,
`ProfileField`, `sanitizeProfileWeights`, `resolveProfile`, `PROFILE_PRESETS`. It lives in the
client-safe `reco/` module rather than `@/models/anime` because its key type is `StaffFamily`, and
`models/` imports nothing.

- **Sparse by INTENT, not by equality.** DESIGN §6 says to persist "only values differing from the
  surface's base", following `sparseViewDefaults`. That rule assumes ONE base, and a profile has two
  (`BOX_WEIGHTS.genre` 0.25, `ANCHORED_WEIGHTS.genre` 0.2): dropping a value because it equals one
  base silently changes what the other ranks with. So a key is present because the owner moved that
  slider, absent means "this surface's default", and resetting a slider deletes the key. Pinned.
- **`BOX_WEIGHTS` moved from `boxes.ts` to the client-safe `weights.ts`**, beside
  `ANCHORED_WEIGHTS` and for its stated reason: the profile page must show what an untouched slider
  resolves to, and `boxes.ts` is `fs`-bound.
- **The zeroing is unconditional** — it fires even when a profile explicitly sets `anilistStaff`
  beside a family. A double count at an ~18× scale gap is exactly the silent failure §6 wants
  unrepresentable, and `staffZeroed` rides on the resolution so the page can say it happened.
- **Bounds**: families 0-1 (one shared range is the point of `PROFILE_DENOM`); every `RecoSource`
  field keeps the bounds `SOURCE_META` already gives its slider, so a profile cannot store a value
  no other surface can express.
- **Presets** name a lead family at 1.0 — "counts as much as the tags" after `PROFILE_DENOM`, tags
  being 1.0 in `BOX_WEIGHTS` — and a supporting field at ~0.5. Starting points for a slider, not
  measured optima: nothing here has a ground truth to fit against.

## Phase 3 — what it decided beyond the design

Store [reco/profiles.ts](../../src/lib/reco/profiles.ts), routes `api/anime/profiles` (GET list with
`usedBy`, POST with `weights` or a `preset` key) and `api/anime/profiles/[id]` (GET, PATCH, DELETE),
`Box.profileId`, and `PUT /api/anime/boxes/[id]` taking `profileId` (`null` detaches).

- **DELETE refuses with 409 + `usedBy` while a box points at the profile**, and succeeds with
  `?confirm=1` — the design's "confirmation naming those boxes", with the naming done by the server.
- **A confirmed delete does NOT sweep `Box.profileId`** — `deleteGroup`'s reason: the dangling id
  is inert (`getBoxProfile` reads it as "no profile") and `boxes.json` is the one file no provider
  can re-supply. ⚠️ **But inert is only safe if it can never become live again**, and `mintSlugId`
  frees a deleted slug: re-creating a profile of the same name would silently re-bind every box
  still naming it — a weighting nobody attached. So `mintProfileId` treats every id a box still
  names as taken. Live-verified: delete-while-attached then re-create the same name mints
  `realisation-test-2`, with `usedBy: []`.
- **`profileId` rides on the box's PUT, not its PATCH.** PATCH is the box's *description* (what
  `updateBox` and the MCP's `edit_box` write); a profile changes how the box *ranks*, the same side
  of the line as `groups`. And attaching is its own function, `setBoxProfile`, rather than a field on
  `updateBox`, because `boxes.ts` is importable from the MCP — the only way to block the attach
  there is by name, which needs a name of its own. Blocked, alongside the three profile writers;
  both lint blocks were verified by importing each blocked name into `src/lib/mcp/`.
- **Existence of the profile is the route's check**, not `setBoxProfile`'s: `profiles.ts` imports
  `boxes.ts` (for `usedBy` and the mint), so the reverse import would be a cycle. Attaching an
  unknown id is a 404 rather than a silent no-op on every ranking.
- **`weights` on PATCH replaces the whole map.** A slider reset is a key deletion, which a merge
  cannot express; `boxes.ts`' incremental-write race argument (many chips, many boxes, at once) does
  not describe one page editing one profile a slider release at a time.
- Live-checked end to end on the office store against the dev server (create from preset, clamp and
  drop-unknown on PATCH, attach, `profileId` surviving a group edit, a member edit and a PATCH, 409,
  confirmed delete, re-mint), then `user/boxes.json` restored to its exact original hash and the
  test `reco_profiles.json` removed.

## ⚠️ Phase 4 is bigger than its table row — settle these before wiring

*Settled — see "Phase 4 — what it decided" below for how each one landed.*

- **The explain must carry the families, or it lies.** `computeAnchored` builds `values` as a
  `SourceWeights` and its `breakdown` from `Object.keys(values) as RecoSource[]`;
  `RecoContribution.source` is a `RecoSource`. A family scored into the sum but absent from the
  breakdown makes « Pourquoi ? » silently under-report the term doing the work — `projectWhy`'s bug
  verbatim, which CLAUDE.md weighs like a scoring bug, and `mcp/tools.ts` reads the same array.
  So `RecoContribution.source` widens to `RecoSource | StaffFamily` (one breakdown, one trim, one
  sort), touching `feed.ts`, `similar.ts`, `anchored.ts` and `mcp/project.ts`. The explain labels
  are `reco.source.${source}.label` (`AnimeCardView`, `MoreLikeThis`), so the eight
  `reco.source.staff*.label` / `.hint` keys land in BOTH locales in phase 4, not 6 — with a
  `satisfies Record<StaffFamily, 0>` driver in `tests/i18n/dynamicKeys.test.ts`. The same keys
  then serve the profile page's sliders, `RecoWeightsSection`'s pattern.
- **Precedence on `mix?box=`.** The route resolves `parseSourceWeights(w)` over
  `ANCHORED_WEIGHTS`, and `encodeSourceWeights` emits only what differs from the base it is given.
  If the box's profile is not that base, a slider dragged back to exactly the anchored default drops
  out of the URL and the profile re-applies — the control snaps back. The profile-resolved weights
  must BE the base the recos tab encodes against (client and server alike), so URL overrides sit on
  top of the profile rather than competing with it.
- **Two IDF memos in `rankBoxCandidates`, never one.** It reads `idfFor(all, minRank)` — separate
  from `computeIdfSet` because of the tag rank floor — and the families need `staffFamilyIdf(all)`
  beside it. Both memoize on the row array's identity; folding one into the other loses the reason
  the first exists.
- **Regression check:** `probe-box.js --box all` must read identically before and after wherever no
  profile is attached. That is the change most likely to break silently.

## Phase 4 — what it decided beyond the design

Both rankers honour a box's profile: `mix?box=` (the recos tab — `computeAnchored`) and
`rankBoxCandidates` (the MCP's `box_candidates` / `get_box`). No page shows a profile yet; the only
visible change is on a box that has one attached, which today is none.

- **One family step, shared.** `staffFields.ts` gained `buildFamilyTerms` (profiles for the
  NON-ZERO families only — no family IDF pass, no profile build otherwise), `matchFamilyTerms`
  (`flooredFieldMatch` through `denomFor`) and `familyCredits`. Both rankers call them, so they
  cannot disagree about how a family is built or scaled. ⚠️ In `computeAnchored` the metadata
  fields stay on plain `fieldMatch` and only the families go through `denomFor` — the unfloored
  form on a near-binary family is exactly the ~3× overshoot `PROFILE_DENOM` removes.
- **The explain carries the families, structurally.** `RecoContribution.source` is now
  `RecoSource | StaffFamily`; `models/` takes `StaffFamily` as an `import type` from the
  client-safe `staffFields.ts` (erased at compile time, so models still imports no values). The
  sum and the rows come from ONE pass, `scoreWithBreakdown` in `scoring.ts` — the feed's and the
  anchored ranker's identical inline loops, lifted, same summation order, so neither score moved by
  a bit. ⚠️ **The widening broke no consumer**: every reader already launders `source` through a
  `` `reco.source.${…}` as TranslationKey `` cast or into a `string`. So the compiler proved
  nothing, and the proof was behavioural — the live card rendered `Réalisation | +0.32 | En commun
  : Director : Tetsurou Araki`, not the raw key. On the box side the same rule applies to
  `BoxCandidateGroup.matched` (now `MatchField`), which the MCP projects verbatim; family values
  there are staff NAMES (`anilistStaff`'s stay ids — changing them would have broken the
  regression diff).
- **An explain line names the credit that puts the person IN the family.** `anchored.ts`' existing
  `id → credit` map keeps an arbitrary credit per person, so a director who also key-animated on an
  anchor could read `Key Animation : X` under « Réalisation ». `familyCredits` filters by family.
  Live, it is what renders `Assistant Director : Hiroyuki Tanaka` on *Shisha no Teikoku*.
- **Precedence on `mix?box=` is base < profile < URL, resolved ONCE** (`resolveProfileOver`): the
  URL is merged INTO the profile and the whole thing goes through `resolveProfile`, so the
  `anilistStaff` zeroing holds after the URL too. The advisor-flagged hole: `w` accepts
  `anilistStaff`, and merging the URL onto an already-resolved profile would let a hand-typed
  `?w=anilistStaff:1` reinstate the double count. Live-verified: 0 `anilistStaff` rows with it.
  Families never come from `w` (`parseSourceWeights` knows only `RecoSource`s), so the profile is
  their only source. The response echoes `profile.base` — the profile-resolved weights WITHOUT the
  URL — which is what phase 6's controls must pass to `encodeSourceWeights`, or a slider dragged to
  the anchored default drops out of the URL and snaps back. `BoxRecos` still sends no `w`.
- ⚠️ **« Plus comme ça » and `/mix?ids=` deliberately pass no `families`.** `computeAnchored` has
  three callers and only `mix?box=` has a box to scope a profile to; the detail page and a
  hand-picked mix have none, so their explain is unchanged (the `?? {}` path builds nothing). Do
  not thread a profile there "to finish the job" — a profile is per-box (DESIGN §10).
- **`rankBoxCandidates` takes `profile?: ProfileWeights`** and resolves it over `options.weights ??
  BOX_WEIGHTS` itself (`profileWeights.ts` is client-safe; only `profiles.ts` would be a cycle).
  The MCP callers look it up with `getBoxProfile` and return it as `profile`; both tool
  descriptions now say a family hit is "more by this person", the owner's weighting, not evidence
  of an axis. `probe-box.js` also resolves a live box's attached profile, so it reads what the MCP
  sees. The two IDF memos stay separate (`idfFor` keyed by tag rank, `staffFamilyIdf` beside it).
- **mix.ts's fetch half moved to `reco/mixFetch.ts`** (`boxAnchorIds`, `loadMixEdges`, the caches,
  the two caps) so `probe-profile.js --rank --pool anchored` runs the REAL anchor selection and edge
  resolution — `similarFetch.ts`' precedent. Added to the eslint server-only list. (`similarFetch`
  and `seedMutes` are not on that list either; out of scope here, noted.)
- **The i18n driver is `STAFF_FAMILIES`, not a `satisfies Record<StaffFamily, 0>` literal** — that
  file's own rule: a runtime array exists and the union is derived from it, so a literal would be a
  second copy. Verified by deleting `reco.source.staffSound.label`: the family case fails.
- **Tests** ([tests/reco/profileRanking.test.ts](../../tests/reco/profileRanking.test.ts), plus two
  in `profileWeights.test.ts`): each verified by breaking what it guards — building every family
  regardless of weight, `denomFor` → 1, `familyCredits` without the family filter, `extra` summed
  but not listed, the family `matched` push dropped, the profile ignored, the zeroing skipped in
  the fill loop, the URL merged after the zeroing, the profile winning over the URL. Each break
  failed exactly its test. The real `rankBoxCandidates` runs there on fixture rows: it takes its
  rows and groups as arguments, and `DATA_PATH` points at a missing folder before a dynamic import.

### Phase 4 — measured (2026-09-13, office store)

**Regression:** `probe-box.js --box all` (1,286 lines, every non-empty box) and the fixture run are
byte-identical before and after, timing lines masked. No box had a profile attached.

`node scripts/probe-profile.js --rank --box <id> --weights <w> [--pool anchored]`, top 10-12 against
the same box under `Défaut`:

| box | pool | profile | top changed | what rose |
|---|---|---|---|---|
| Bancal et je l'assume | statused | `staffDirector: 1` | **7/12** | SnK S2, *Bubble*, *Death Note*, HotD, *Vampire in the Garden*, *Hellsing Ultimate* — Tetsurou Araki and Hiroyuki Tanaka (DESIGN §8, reproduced on the real fill loop) |
| Bancal et je l'assume | anchored | `staffDirector: 1` | **2/12** | HotD (Araki), *Shisha no Teikoku* (Tanaka) |
| Absolute cinema | statused | `staffDirector: 1` | 3/10 | *Evangelion* (Anno, Tsurumaki), *Akudama Drive* (Taguchi), *Ninja Kamui* |
| Chara design I dig | statused | `staffCharaDesign: 1, staffAnimation: 0.5` | **7/10** | *Undead Unluck* / *D.Gray-man* (Hideyuki Morioka), *Kami no Tou*, *Yuri!!! on Ice* |
| Laugh | statused | `staffMusic: 1` | 4/10 | *Mono*, *Lycoris Recoil*, *Hige wo Soru*, *Love Live!* — composers of the box's rom-coms |

- ⚠️ **On the recos tab a family at 1.0 is a nudge, not a takeover.** `crowd` is max-normalized to
  1.0 at the top of the pool and `anilistCrowd` sits beside it, while a near-binary family tops out
  near 1/3 after `PROFILE_DENOM`. That is the anchored base doing its job (the crowd graph IS the
  box's recos tab), and it is the number phase 6's slider page must set expectations with — the
  fill loop, which has no crowd term, moves 3-4× more for the same profile.
- **Laugh + `staffMusic` did not reproduce §8's failure on the fill loop** (Yuuki Hayashi's
  action-shonen filmography): the statused pool holds far fewer of any one composer's credits than
  the catalog does. The drift that DID appear (*Love Live!*, *Lycoris Recoil* under a comedy axis)
  is the same shape, milder. §8's warning belongs to phase 5's catalog pool, where it will bite.
- Cost: once the family IDF is memoized, a profiled fill-loop rank took 16-20 ms (the first,
  default rank of each run paid ~165 ms building `idfFor`); the recos tab answered in ~0.5 s warm
  on the dev server with edges cached, against ~2 s for the first request.
- **Live check** (dev server, office store): test profile `{ staffDirector: 1 }` attached to `Bancal
  et je l'assume` through the phase 3 routes; `mix?box=…&includeSeen=true` moved 2 of its top 12,
  carried 5 family rows with role-correct details and 0 `anilistStaff` rows (with and without
  `?w=anilistStaff:1`), every card's score equalled the sum of its explained contributions, and
  `profile` came back with `staffZeroed: true`. The MCP `get_box` returned the profile and
  `staffDirector=[…]` in `matched`. Then detached, deleted, `user/reco_profiles.json` removed, and
  `user/boxes.json` verified byte-identical to its backup (sha1 `accee660…`).

## Phase 5 — what it decided beyond the design

`POST /api/anime/profiles/preview` over [reco/profilePreview.ts](../../src/lib/reco/profilePreview.ts):
`{ weights? | profileId?, box | anchors, pool?, limit?, includeSeen?, lang? }` → lean rows, the
§8 diagnostic, the pool's `base` (with `families` and `staffZeroed`), and per pool its `coverage`
or crowd `sources`. Nothing is saved or attached; no page reads it yet.

- **The pool is the mark's, by extraction — as two predicates, not one.** `affinity.ts` exports
  `isUnseenCandidate` (seen / intent / hidden / 👎 — the half that decides `coverage.unseen`) and
  `isScoreable`; `buildUnseenPool` runs them and `isPrematureSequel` in `buildAffinityIndex`'s
  own order. A single five-condition predicate would have silently changed what the mark's
  coverage counts. Pinned by comparing the pool with the mark's scored set on one fixture; on the
  live store the two are the same 15,271 of 25,854. `buildAffinityIndex` is otherwise untouched
  (DESIGN §10: no profile reaches the mark) — `probe-affinity.js` reads byte-identically for
  2024-fall, 2025-spring and 2023-winter.
- **Not memoized.** The pool depends on the 👎 store, which is off the seven-slice join: a 👎
  produces no new row array, so a WeakMap on `all` would serve a stale pool. It costs 24-65 ms;
  the IDF it feeds is what was expensive, and that is memoized. Pinned (same array, new 👎).
- **Same ranker, different pool** — the one call deliberately departing from the advisor's
  suggestion of a second, flat scoring loop. `rankBoxCandidates` takes `pool?: ReadonlySet`
  (default: the statused list, so the fill loop and `probe-box.js` are byte-identical), which
  makes the preview predict what the attached profile does rather than what a sibling ranker
  would, and inherits two rules for free: écartés are skipped inside the loop (reachable here —
  `Box.excluded` holds unwatched ids), and results group by direct franchise. The grouping is
  right for an unseen pool too: without it a watched show's unseen side entries flood the top
  (DESIGN §8's own "Shingeki no Kyojin ×4"). A row reports `franchise`, the other entries it
  stands for.
- **Three pools, each over the base its real ranker uses**: `catalog` (default, a pure local read)
  and `statused` resolve over `BOX_WEIGHTS`; `anchored` — the recos tab — over
  `ANCHORED_WEIGHTS`, through `mixFetch` (the only one reaching MAL / AniList), with seen titles
  in for a box as the tab has them. `boxAnsweredIds` (members ∪ écartés) moved into `mixFetch` so
  the anchored preview and the tab cannot disagree on what a box has answered.
- **The §8 diagnostic is [reco/profileDiagnostic.ts](../../src/lib/reco/profileDiagnostic.ts)**
  (pure): per family, people, how many recur across two or more UNITS, the recurring people
  named, and a verdict enum `empty | retrieval | axis` — the sentence stays phase 6's, so no
  locale keys yet. `probe-profile.js --box` now reads it (three unit readings: every entry alone,
  the declared units, the §2 proxy) instead of its own inline copy — and the rewired probe printed
  the previous run's 167 lines exactly, two independent implementations agreeing.
- **`profileId` in the body previews a saved profile as stored** (`weights` wins when both are
  sent, the create route's rule over `preset`); phase 6 sends `weights`, the live slider state.
- ⚠️ **`preview` is a reserved profile id.** A static route beats a dynamic one, so a profile
  named « Preview » would mint `preview` and every GET / PATCH / DELETE on it would land on the
  preview route. `RESERVED_PROFILE_IDS` feeds `mintProfileId`, and a test reads
  `src/pages/api/anime/profiles/` so a future static route there must be reserved too.
- `probe-profile.js --rank` now calls `previewProfile` for every pool and defaults to `catalog`.

### Phase 5 — measured (2026-09-13, office store)

**Regressions**, captured before the first edit: `probe-affinity.js` (three seasons) and
`probe-box.js --box all` byte-identical, timings masked; the diagnostic identical as above.

`probe-profile.js --rank --box <id> --weights <w>` on the catalog pool, against `Défaut`:

| box | profile | top changed | what rose |
|---|---|---|---|
| Absolute cinema | `staffDirector: 1` | **11/15** (statused: 3/10) | *Evangelion: Death & Rebirth* (Anno), *Innocence* and *GITS 2.0* (Oshii), Haoling Li's Chinese animation, *Sousei no Onmyouji* (Taguchi) — §7's "reaches 119, not 2", seen |
| Bancal et je l'assume | `staffDirector: 1` | 7/12 | Araki (*Death Note: Rewrite*, *Kabaneri Movie 1*) and Hiroyuki Tanaka (*Claymore*, *Chobits*, *Shisha no Teikoku*) — the two people the diagnostic names as this box's axis |
| Laugh | `staffMusic: 1` | **10/12** | **Tomoki Kikuya holds 8 of the 12** (*Bocchi the Rock! Movie*, *Hidamari Sketch*, *Ika Musume*, *Nisekoi*…) |

- ⚠️ **One person can take most of the page, which is §8's mechanism working as specified.** On
  Laugh the diagnostic calls music an AXIS — Kikuya is credited on 4 of the box's units — so his
  filmography rising is the box agreeing on him, and it stays comedic. §8's Yuuki Hayashi example
  is the same arithmetic on a person who writes for shonen. The page's job (phase 6) is to print
  the diagnostic beside the list so the owner can tell which of the two it is.
- Cost on the dev server: a catalog preview answers in **107-416 ms warm** (1.6 s cold, IDF and
  row build included), `statused` in 23 ms; the pool build is 24-65 ms of that. DESIGN §7
  estimated 541 ms for one catalog rank; the family IDF memo and the rank-floored `idfFor` memo
  are what keep it under.
- **Live check** (dev server, office store; the preview writes nothing, and every `user/*.json`
  sha1 matched after): catalog default and profiled, the clamp (`staffDirector: 7` → 1, unknown
  key dropped), statused, ad-hoc anchors (three Miyazaki-era titles → his filmography, 29 of 30
  rows with a family line), and anchored on « Bancal » (both crowd sources ok, the diagnostic
  naming Araki and Tanaka as the axis). Eight invalid requests each answered their 4xx.
