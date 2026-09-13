/**
 * A box's reco profile reaching the rankers (docs/recoProfiles/PLAN.md, phase 4).
 *
 * Every rule here fails SILENTLY — the ranking still comes out, plausibly:
 *
 *  - a family scored through plain `fieldMatch` instead of `denomFor` is up to
 *    3× what the same slider means on tags, so the director slider quietly
 *    outvotes everything (DESIGN §4);
 *  - a family added to the score but not to the explain makes « Pourquoi ? »
 *    under-report the term doing the work — `projectWhy`'s bug class, which
 *    CLAUDE.md weighs like a scoring bug — and the MCP box tools read `matched`
 *    the same way;
 *  - a profile that turns a family on while `anilistStaff` still counts double-
 *    counts every shared director at an ~18× scale gap.
 *
 * `computeAnchored` reads the store itself, so it is covered through the two
 * pure steps it is built from (`matchFamilyTerms`, `scoreWithBreakdown`).
 * `rankBoxCandidates` takes its rows and groups as arguments, so the REAL fill
 * loop runs here on fixture rows — with `DATA_PATH` pointed at a folder that
 * does not exist, so a future edit that makes it read the store sees an empty
 * one rather than the owner's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  buildFamilyTerms, matchFamilyTerms, familyCredits, PROFILE_DENOM,
} from '@/lib/reco/staffFields';
import { scoreWithBreakdown } from '@/lib/reco/scoring';
import { resolveProfile } from '@/lib/reco/profileWeights';
import { ANCHORED_WEIGHTS } from '@/lib/reco/weights';
import type { AnimeRecord, Box, RecoContribution, SourceWeights } from '@/models/anime';

// Before the dynamic import below: `jsonStore` resolves it at module init.
process.env.DATA_PATH = path.join(os.tmpdir(), 'anime-app-test-no-store-here');

const anime = (
  id: string,
  staff: { id: number; role: string }[],
  opts: { tags?: string[]; status?: string } = {}
): AnimeRecord => ({
  id,
  crosswalk: {},
  catalog: { genres: [], studios: [] },
  personal: opts.status ? { status: opts.status } : {},
  sources: {
    anilist: {
      staff: staff.map(s => ({ ...s, name: `p${s.id}` })),
      tags: (opts.tags ?? []).map(name => ({ name, rank: 80 })),
    },
  },
  provenance: { catalog: {}, personal: {} },
} as unknown as AnimeRecord);

/**
 * The shared world: one box member directed by person 7 and tagged `A`;
 * candidate `dir` shares the DIRECTOR only, candidate `tag` shares the TAG only;
 * three unrelated titles so every IDF is positive.
 */
// Key Animation FIRST, so a map that keeps any credit per person names the wrong one.
const member = anime('m', [{ id: 7, role: 'Key Animation' }, { id: 7, role: 'Director' }], { tags: ['A'], status: 'completed' });
const dir = anime('dir', [{ id: 7, role: 'Director' }, { id: 9, role: 'Music' }], { tags: ['B'], status: 'completed' });
const tag = anime('tag', [{ id: 8, role: 'Director' }], { tags: ['A'], status: 'completed' });
const corpus = [
  member, dir, tag,
  anime('x1', [{ id: 21, role: 'Director' }], { tags: ['C'] }),
  anime('x2', [{ id: 22, role: 'Director' }], { tags: ['D'] }),
  anime('x3', [{ id: 23, role: 'Director' }], { tags: ['E'] }),
];

test('a box with no profile builds no family at all', () => {
  assert.deepEqual(buildFamilyTerms([member], () => 1, {}, corpus), []);
  assert.deepEqual(buildFamilyTerms([member], () => 1, { staffDirector: 0, staffMusic: 0 }, corpus), []);
  const terms = buildFamilyTerms([member], () => 1, { staffDirector: 1, staffMusic: 0 }, corpus);
  assert.deepEqual(terms.map(t => t.family), ['staffDirector'], 'only the non-zero families');
});

/**
 * One shared director, a one-director candidate, a profile normalized to 1:
 * `PROFILE_DENOM.staffDirector` makes that 1/3. Plain `fieldMatch` would say 1.
 */
test('a family is scored through denomFor, not plain fieldMatch', () => {
  const terms = buildFamilyTerms([member], () => 1, { staffDirector: 0.6 }, corpus);
  const [hit] = matchFamilyTerms(dir, terms);
  assert.equal(hit.family, 'staffDirector');
  assert.equal(hit.value, 1 / PROFILE_DENOM.staffDirector);
  assert.equal(hit.contribution, 0.6 / PROFILE_DENOM.staffDirector);
  assert.deepEqual(matchFamilyTerms(tag, terms), [], 'no shared director, no hit');
});

/**
 * Person 7 is the member's director AND one of its key animators. The explain
 * line under « Réalisation » must name the Director credit, never whichever
 * credit a plain id → credit map happened to keep last.
 */
test('an explain line names the credit that puts the person in the family', () => {
  assert.deepEqual(familyCredits([member], 'staffDirector').get(7), { name: 'p7', role: 'Director' });
  assert.equal(familyCredits([member], 'staffAnimation').has(7), false, 'Key Animation is in no family');
});

test('every contribution that moves the score is a line in the breakdown', () => {
  const values = { ...ANCHORED_WEIGHTS, crowd: 0.5, genre: 0.25, anilistStaff: 0.4, popularity: 0.1 } as SourceWeights;
  const { weights, families } = resolveProfile(ANCHORED_WEIGHTS, { staffDirector: 1 });
  const terms = buildFamilyTerms([member], () => 1, families, corpus);
  const extra: RecoContribution[] = matchFamilyTerms(dir, terms).map(h => ({
    source: h.family, value: h.value, weight: h.weight, contribution: h.contribution,
  }));
  const { score, breakdown } = scoreWithBreakdown(values, weights, {}, extra);

  const sources = breakdown.map(r => r.source);
  assert.ok(sources.includes('staffDirector'), 'the family is explained');
  assert.ok(!sources.includes('anilistStaff'), 'anilistStaff is zeroed, so it neither scores nor explains');
  const explained = breakdown.reduce((sum, r) => sum + r.contribution, 0);
  assert.ok(Math.abs(score - explained) < 1e-12, `score ${score} but the breakdown explains ${explained}`);
  assert.deepEqual(
    breakdown.map(r => Math.abs(r.contribution)),
    breakdown.map(r => Math.abs(r.contribution)).sort((a, b) => b - a),
    'strongest line first'
  );
});

test('the fill loop ranks by the profile, and lists the family in matched', async () => {
  const { rankBoxCandidates } = await import('@/lib/reco/boxes');
  const box: Box = { id: 'b', name: 'b', members: ['m'], createdAt: '' };
  const opts = { groups: [] };

  const plain = rankBoxCandidates(box, corpus, opts);
  assert.deepEqual(plain.map(g => g.id), ['tag', 'dir'], 'default weighting: the shared tag leads');
  assert.ok(plain.every(g => g.matched.every(m => !m.field.startsWith('staff'))), 'no family without a profile');

  const profiled = rankBoxCandidates(box, corpus, { ...opts, profile: { staffDirector: 1 } });
  assert.deepEqual(profiled.map(g => g.id), ['dir', 'tag'], 'the director profile lifts the shared director');
  const top = profiled[0];
  assert.equal(top.score, 1 / PROFILE_DENOM.staffDirector, 'scored through denomFor, and nothing else');
  assert.deepEqual(top.matched, [{ field: 'staffDirector', values: ['p7'] }], 'named, and the only field');
  assert.ok(profiled.every(g => g.matched.every(m => m.field !== 'anilistStaff')), 'anilistStaff zeroed');
});
