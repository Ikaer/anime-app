/**
 * `staffRoleTier` — importance tiers for AniList staff credits.
 *
 * The whitelists are not what is pinned here. They are long, they are meant to
 * grow, and a role added to one is self-evidently in it. What is pinned is the
 * **normalization and the three qualifier rules**, which docs/staffRoleTiers.md
 * says carry more of the value than the whitelists do — 28,812 distinct raw
 * role strings collapse to 2,502 once qualifiers are parsed off — and every one
 * of which fails silently when it breaks: the credit still renders, in the
 * wrong group, on a page nobody diffs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staffRoleTier, parseStaffRole, groupStaffByTier, STAFF_ROLE_TIERS } from '@/lib/domain/staffRole';
import type { AniListStaffEntry } from '@/models/anime';

/**
 * ⚠️ The tier path normalizes whitespace in TWO places, and they are **not**
 * redundant — they cover disjoint inputs. Re-measured 2026-08-26 against the
 * live store (301,628 credits), removing each in turn:
 *
 * | removed | credits changing tier | why |
 * |---|---|---|
 * | both | 1,549 (182 strings) | bare `"Director "` → T1 falls through to T3 |
 * | `parseStaffRole`'s `raw.trim()` | 141 (108) | `)`-then-space defeats the `$`-anchored peel |
 * | `key()`'s trim | 37 (16) | `;`-split yields `" English"` from `(OP; English)` |
 *
 * THIS test is the doubled case — the bare untrimmed strings — so it passes
 * with either trim present and only fires when both go. That is exactly what
 * makes each trim easy to misread as dead code, so the two tests below isolate
 * them: each fails on its own trim's removal, and each names the shape it
 * guards. Do not take one trim's removal passing CI as evidence it was dead.
 *
 * For the record of what was actually unpinned before those two were added:
 * dropping `key()`'s trim left the whole suite GREEN, while dropping
 * `parseStaffRole`'s already failed the peel test at the foot of this file (via
 * `'  Director  '`) — so only one of the two was genuinely unguarded, and the
 * guard that existed sat under a different test's name.
 *
 * The doc's third example, `"Producer "` (770 credits), cannot be asserted at
 * all: the producer family is pinned to T3 and the fall-through is ALSO T3, so
 * the bug is invisible on that string. It is the two below that would move.
 */
test('trailing and surrounding whitespace never changes a tier', () => {
  assert.equal(staffRoleTier('Director '), 1);
  assert.equal(staffRoleTier('Music '), 1);
  assert.equal(staffRoleTier('  Chief Director  '), 1);
});

/**
 * ⚠️ Isolates `parseStaffRole`'s `raw.trim()`. The peel regex is `$`-anchored,
 * so whitespace AFTER the closing paren makes it fail outright — the qualifier
 * stays inside `base`, misses every whitelist, and rule 2 never fires. 266 live
 * credits carry this shape.
 *
 * `Episode Director` is the discriminating base on purpose: it is fall-through
 * T3 and then demoted, so this fails if EITHER the peel or rule 2 breaks.
 * `Key Animation (ep 3) ` is the more common shape live but is already T4 and
 * caps there, which makes it blind to the demotion half.
 */
test('a qualifier is peeled even when whitespace follows the closing paren', () => {
  assert.equal(staffRoleTier('Episode Director (ep 2) '), 4, 'T3 fall-through, demoted by (ep 2)');
  assert.equal(staffRoleTier('Key Animation (ep 3) '), 4);
  assert.deepEqual(parseStaffRole('Director (ep 5) '), { base: 'Director', qualifiers: ['ep 5'] });
});

/**
 * ⚠️ Isolates `key()`'s trim. `staffRoleTier` splits a qualifier on `;`, which
 * manufactures a fresh untrimmed part whenever the dub language is not first —
 * `" English"` here. That is why normalizing once at the function's entry could
 * NOT replace this trim: the split happens after any such normalization.
 *
 * The `(English; ADV)` case in rule 1's test puts the language first, where it
 * needs no trimming, which is precisely why it never caught this.
 */
test('rule 1 sees a dub language that is not the first `;` part', () => {
  assert.equal(staffRoleTier('Theme Song Performance (OP; English)'), 4);
  assert.equal(staffRoleTier('Theme Song Lyrics (OP; Italian)'), 4);
});

test('matching is case-insensitive', () => {
  assert.equal(staffRoleTier('director'), 1);
  assert.equal(staffRoleTier('adr director'), 4);
});

/**
 * Rule 1 — localization is T4 whatever the base says, because this app already
 * restricts cast to Japanese seiyuu. `Director (English)` is a dub director,
 * not the show's director.
 */
test('rule 1: ADR and dub-language credits are T4 regardless of base role', () => {
  assert.equal(staffRoleTier('ADR Director'), 4);
  assert.equal(staffRoleTier('ADR Script'), 4);
  assert.equal(staffRoleTier('Director (English)'), 4);
  // AniList combines a language with a studio note; the split on `;` is what
  // stops this from reading as one unknown qualifier.
  assert.equal(staffRoleTier('Director (English; ADV)'), 4);
});

/**
 * `Japanese` is deliberately absent from the dub set — it is the primary
 * language, not a localization marker. Adding it would send every
 * Japanese-qualified credit, including real ones, to T4.
 */
test('rule 1 exempts Japanese, which is not a dub language', () => {
  assert.equal(staffRoleTier('Director (Japanese)'), 1);
});

/**
 * Rule 2 — ⚠️ a demotion of exactly ONE tier, never a floor. The difference is
 * visible on anthologies: *Halo Legends* and *Genius Party Beyond* credit every
 * `Director` with an `(ep N)` qualifier, so a floor to T3 would empty their
 * core-crew section entirely, while one step lands them in T2 where they read
 * as what they are.
 */
test('rule 2: an episode qualifier demotes exactly one tier', () => {
  assert.equal(staffRoleTier('Director (ep 5)'), 2, 'T1 → T2, not floored to T3');
  assert.equal(staffRoleTier('Animation Director (eps 1-3)'), 3, 'T2 → T3');
  assert.equal(staffRoleTier('Producer (ep 2)'), 4, 'T3 → T4');
});

test('rule 2 cannot push past T4', () => {
  assert.equal(staffRoleTier('Key Animation (ep 1)'), 4);
  assert.equal(staffRoleTier('Key Animation'), 4);
});

/**
 * Rule 3 — 15,486 credits carry an `OP`/`ED` qualifier, and on
 * `Theme Song Performance (ED)` it says WHICH SONG, not that the credit matters
 * less. A mixed qualifier still demotes, because the `eps` part is real.
 */
test('rule 3: OP/ED qualifiers are ignored, but a mixed one still demotes', () => {
  assert.equal(staffRoleTier('Director (OP)'), 1, 'OP alone must not demote');
  assert.equal(staffRoleTier('Director (OP1, eps 4, 14)'), 2, 'the eps part still counts');
});

/**
 * The producer/planning family is pinned to T3 **as a group**. Left to the
 * whitelists it scattered across three tiers; consolidating it cut JoJo Part
 * 4's T2 from 18 rows to 11 of pure creative crew.
 */
test('the producer family lands in T3 together', () => {
  for (const role of ['Producer', 'Executive Producer', 'Chief Producer', 'Associate Producer',
    'Line Producer', 'Planning', 'Advertising Producer', 'Music Producer']) {
    assert.equal(staffRoleTier(role), 3, role);
  }
});

/** The one deliberate exception: a creative anchor, not a committee seat. */
test('Animation Producer stays in T2', () => {
  assert.equal(staffRoleTier('Animation Producer'), 2);
});

/**
 * The open fall-through is the design, same as `genreAxis`'s `theme`: a role
 * AniList adds next year is imprecise but never unclassified and — importantly
 * — never silently hidden in the collapsed T4 section.
 */
test('an unknown role falls through to T3 rather than throwing or hiding', () => {
  assert.equal(staffRoleTier('Some Role AniList Adds In 2027'), 3);
  assert.equal(staffRoleTier('Theme Song Performance'), 3);
  assert.equal(staffRoleTier(''), 3);
});

test('parseStaffRole peels every trailing parenthetical, outermost first', () => {
  assert.deepEqual(parseStaffRole('Theme Song Performance (ED) (eps 1-12)'), {
    base: 'Theme Song Performance',
    qualifiers: ['ED', 'eps 1-12'],
  });
  assert.deepEqual(parseStaffRole('  Director  '), { base: 'Director', qualifiers: [] });
});

/**
 * ⚠️ T1 can be empty and the render must tolerate it — 1,690 titles with staff
 * carry no T1 credit. This is the anthology shape that produces it.
 */
test('groupStaffByTier returns all four tiers, and T1 may legitimately be empty', () => {
  const staff = [
    { role: 'Director (ep 1)' },
    { role: 'Director (ep 2)' },
    { role: 'Key Animation' },
  ] as AniListStaffEntry[];

  const grouped = groupStaffByTier(staff);

  assert.deepEqual(Object.keys(grouped).map(Number).sort(), [...STAFF_ROLE_TIERS].sort());
  assert.deepEqual(grouped[1], [], 'every Director carried an (ep N) qualifier');
  assert.deepEqual(grouped[2].map(c => c.role), ['Director (ep 1)', 'Director (ep 2)'],
    'AniList relevance order is preserved within a tier');
  assert.deepEqual(grouped[3], []);
  assert.deepEqual(grouped[4].map(c => c.role), ['Key Animation']);
});
