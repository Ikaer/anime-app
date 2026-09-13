/**
 * `staffFields` — the craft families a reco profile weights
 * (docs/recoProfiles/DESIGN.md §3-§5, §11).
 *
 * What is pinned is the BOUNDARIES, not the whitelists' contents. Every case
 * below is one array edit away from being wrong, and none of them fails loudly:
 * a key animator filed as an animation director, or a mangaka filed as a series
 * composer, still produces a ranking — a plausible one, on a slider nobody can
 * check against anything. That is the `GENRE_ALIASES` failure mode, and the
 * reason each rejected boundary from DESIGN §3 has its own assertion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAFF_FAMILIES, STAFF_FAMILY_ROLES, STAFF_FAMILY_EXTRACTORS, PROFILE_DENOM,
  staffFamilyOf, denomFor, computeStaffFamilyIdf,
} from '@/lib/reco/staffFields';
import { MATCH_DENOM_FLOOR, FIELD_EXTRACTORS, computeIdf, type MetaField } from '@/lib/reco/scoring';
import type { AnimeRecord } from '@/models/anime';

const anime = (id: string, staff: { id: number; role: string }[]): AnimeRecord => ({
  id,
  crosswalk: {},
  catalog: { genres: [], studios: [] },
  personal: {},
  sources: { anilist: { staff: staff.map(s => ({ ...s, name: `p${s.id}` })) } },
  provenance: { catalog: {}, personal: {} },
} as unknown as AnimeRecord);

/**
 * DESIGN §3's rejected boundaries. Each would RAISE coverage — which is exactly
 * why a tidy-minded edit would add it — while diluting or mislabelling the
 * family it joins.
 */
test('the rejected boundaries stay rejected', () => {
  assert.equal(staffFamilyOf('Key Animation'), null,
    'Key Animation halves staffAnimation\'s signal (0.076 → 0.036) — it wants the animation DIRECTORS');
  assert.equal(staffFamilyOf('Storyboard'), null,
    'Storyboard is per-episode: it turns the one near-binary field (p90 2) into a diluted one (p90 6)');
  assert.equal(staffFamilyOf('Episode Director'), null, 'an episode roster, not a craft');
  assert.equal(staffFamilyOf('Theme Song Performance'), null, 'the band that sang the OP is not the composer');
  assert.equal(staffFamilyOf('Theme Song Composition'), null);
});

test('Chief Animation Director is animation, not chara design', () => {
  assert.equal(staffFamilyOf('Chief Animation Director'), 'staffAnimation');
  assert.equal(staffFamilyOf('Character Design'), 'staffCharaDesign');
});

/**
 * The merge DESIGN §3 measured and refused: one field over both reads a
 * comfortable 0.137 match median that is the average of 0.324 and 0.575, and
 * conflates "same series composer" with "adapted from the same mangaka".
 */
test('Original Creator is a source credit, not a writing one', () => {
  assert.equal(staffFamilyOf('Original Creator'), 'staffOriginal');
  assert.equal(staffFamilyOf('Original Story'), 'staffOriginal');
  assert.equal(staffFamilyOf('Series Composition'), 'staffWriting');
  assert.equal(staffFamilyOf('Script'), 'staffWriting');
});

/**
 * The same rule `staffRoleTier` applies (rule 1), read from the same function.
 * Without it the director slider would retrieve dubbing studios' filmographies.
 */
test('a localization credit is in no family', () => {
  assert.equal(staffFamilyOf('Director (English)'), null);
  assert.equal(staffFamilyOf('Director (English; ADV)'), null);
  assert.equal(staffFamilyOf('ADR Director'), null);
  assert.equal(staffFamilyOf('Music (OP; Italian)'), null);
});

/**
 * ⚠️ The tier demotes `(ep N)` for DISPLAY; the family must not follow it. An
 * anthology credits every director this way, and dropping them would leave its
 * director slider with nothing to weigh.
 */
test('an episode qualifier does not exclude, and the qualifiers are peeled', () => {
  assert.equal(staffFamilyOf('Director (ep 3)'), 'staffDirector');
  assert.equal(staffFamilyOf('Animation Director (eps 1-3)'), 'staffAnimation');
  assert.equal(staffFamilyOf('Music (OP)'), 'staffMusic');
  assert.equal(staffFamilyOf('Director (Japanese)'), 'staffDirector', 'Japanese is not a dub language');
  assert.equal(staffFamilyOf('Director '), 'staffDirector', 'the bare untrimmed shape the store holds');
  assert.equal(staffFamilyOf('series composition'), 'staffWriting');
});

/**
 * `FAMILY_BY_ROLE` is built by insertion, so a role listed in two families is
 * not an error anywhere — it just silently belongs to the later one.
 */
test('every whitelisted role maps back to its own family (the lists are disjoint)', () => {
  for (const family of STAFF_FAMILIES) {
    for (const role of STAFF_FAMILY_ROLES[family]) {
      assert.equal(staffFamilyOf(role), family, `${role} is listed under ${family}`);
    }
  }
});

/**
 * `fieldMatch` sums over the extracted values and divides by their count, so a
 * person credited twice within one family would weigh double on one title and
 * single on another for the very same shared director.
 */
test('a person counts once per family per title', () => {
  const a = anime('a', [
    { id: 1, role: 'Director' },
    { id: 1, role: 'Series Director' },
    { id: 2, role: 'Assistant Director' },
    { id: 1, role: 'Storyboard' },
  ]);
  assert.deepEqual(STAFF_FAMILY_EXTRACTORS.staffDirector(a).sort(), [1, 2]);
  assert.deepEqual(STAFF_FAMILY_EXTRACTORS.staffAnimation(a), []);
});

/**
 * DESIGN §4: two denominator tables, one router. Routed backwards, tags divide
 * by 3 and directors by 10 — every slider still moves and every number is
 * wrong. The two literal checks are the discriminating ones; the loops pin
 * that no field is left unrouted.
 */
test('denomFor routes a family to PROFILE_DENOM and a metadata field to MATCH_DENOM_FLOOR', () => {
  assert.equal(denomFor('anilistTags'), 10, 'tags keep their evidence floor');
  assert.equal(denomFor('staffDirector'), 3, 'a family gets its scale normalizer');
  for (const family of STAFF_FAMILIES) assert.equal(denomFor(family), PROFILE_DENOM[family], family);
  for (const field of Object.keys(MATCH_DENOM_FLOOR) as MetaField[]) {
    assert.equal(denomFor(field), MATCH_DENOM_FLOOR[field], field);
  }
});

/**
 * DESIGN §5: family-scoped IDF, NOT the shared full-credit map. A prolific
 * person accrues credits in roles that are not the one being asked about, so
 * "how rare as a director" and "how rare as a credit-holder" differ — measured
 * on 71% of the director family. Here person 7 directs one title and key-
 * animates three more: rare as a director, common as a credit-holder.
 */
test('the family IDF measures rarity within the family, not across all credits', () => {
  const corpus = [
    anime('a', [{ id: 7, role: 'Director' }]),
    anime('b', [{ id: 7, role: 'Key Animation' }]),
    anime('c', [{ id: 7, role: 'Key Animation' }]),
    anime('d', [{ id: 7, role: 'Key Animation' }]),
    anime('e', []),
  ];
  const family = computeStaffFamilyIdf(corpus).staffDirector.get(7);
  const shared = computeIdf(corpus, FIELD_EXTRACTORS.anilistStaff).get(7);
  assert.equal(family, Math.log(5 / 2));
  assert.equal(shared, Math.log(5 / 5));
  assert.ok(family! > shared!, 'rarer as a director than as a credit-holder');
});
