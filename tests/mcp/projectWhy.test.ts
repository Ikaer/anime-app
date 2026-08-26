/**
 * `projectWhy` — the MCP feed's explanation surface.
 *
 * ⚠️ CLAUDE.md rules that a misleading tool description or projection is **a bug
 * of the same weight as a scoring bug**, and this function is the reason why.
 * It used to trim the breakdown with one `slice(0, 4)` by absolute
 * contribution, which structurally erased the negative half: `crowd` is
 * max-normalized to 1.0 at the top of the pool while `rejection` sits around
 * 0.03, so the cut removed every penalty from every card. Live-measured on the
 * top 15, `rejection` contributed on 15 of 15 and surfaced on 0.
 *
 * The consequence was not a wrong number — it was a wrong CONCLUSION. An
 * external audit read the output, inferred the rejection signal was unused, and
 * proposed rebuilding one that had existed since the discriminative profiles
 * shipped (docs/audits/recommend-algo-notes.md). A consumer that cannot see a
 * penalty cannot reason about it, and will confidently say so.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectWhy } from '@/lib/mcp/tools';
import type { RecoContribution } from '@/models/anime';

/** `value`/`weight` are carried on the real type but projectWhy reads neither. */
const contribution = (source: string, value: number, detail?: string): RecoContribution => ({
  source, value: 0, weight: 0, contribution: value, ...(detail ? { detail } : {}),
} as RecoContribution);

const sources = (why: ReturnType<typeof projectWhy>) => why.map(c => c.source);

/**
 * The regression itself. Every negative here is an order of magnitude below
 * every positive, which is exactly the real shape — under a single ranked cut
 * of four, neither would survive.
 */
test('a penalty survives even when every positive dwarfs it', () => {
  const why = projectWhy([
    contribution('crowd', 1.0),
    contribution('genre', 0.42),
    contribution('anilistTags', 0.31),
    contribution('studio', 0.22),
    contribution('suggestions', 0.18),
    contribution('rejection', -0.031),
    contribution('popularity', -0.020),
  ]);

  assert.ok(sources(why).includes('rejection'), 'the rejection penalty must be visible');
  assert.ok(sources(why).includes('popularity'), 'so must the popularity penalty');
});

test('the trim is per sign, not one ranked cut', () => {
  const why = projectWhy([
    contribution('crowd', 1.0),
    contribution('genre', 0.42),
    contribution('anilistTags', 0.31),
    contribution('studio', 0.22),
    contribution('suggestions', 0.18),
    contribution('feedback', 0.11),
    contribution('rejection', -0.031),
    contribution('popularity', -0.020),
    contribution('crowdRejection', -0.011),
  ]);

  const positives = why.filter(c => c.contribution > 0);
  const negatives = why.filter(c => c.contribution < 0);

  assert.equal(positives.length, 4, 'four positives at most');
  assert.equal(negatives.length, 2, 'two negatives at most — and never zero because of the positives');

  // Within a sign the biggest magnitudes win, so the trim still says something.
  assert.deepEqual(positives.map(c => c.source), ['crowd', 'genre', 'anilistTags', 'studio']);
  assert.deepEqual(negatives.map(c => c.source), ['rejection', 'popularity']);
});

/**
 * ⚠️ Rounding happens BEFORE the zero filter. A −0.0004 contribution is not a
 * penalty worth reporting, and surfacing it as a literal `0` reads to a model
 * as a bug rather than as "negligible" — which is the same class of mistake as
 * hiding it. (`-0 !== 0` is false, so a rounded negative zero drops out too.)
 */
test('negligible contributions are omitted, never rendered as a bare 0', () => {
  const why = projectWhy([
    contribution('crowd', 0.8),
    contribution('rejection', -0.0004),
    contribution('rating', 0.0002),
    contribution('nsfw', 0),
  ]);

  assert.deepEqual(sources(why), ['crowd']);
  assert.ok(why.every(c => c.contribution !== 0), 'nothing may be reported as a zero contribution');
  assert.ok(why.every(c => !Object.is(c.contribution, -0)), 'not even a negative zero');
});

test('contributions are rounded to three decimals', () => {
  const [only] = projectWhy([contribution('crowd', 0.123456)]);
  assert.equal(only.contribution, 0.123);
});

test('the human-readable detail rides along, and is omitted when absent', () => {
  const [withDetail, withoutDetail] = projectWhy([
    contribution('genre', 0.5, 'Action, Mecha'),
    contribution('crowd', 0.4),
  ]);
  assert.equal(withDetail.detail, 'Action, Mecha');
  assert.equal('detail' in withoutDetail, false, 'an absent detail must not become undefined in the payload');
});

test('the final list reads biggest-magnitude first, across both signs', () => {
  const why = projectWhy([
    contribution('studio', 0.2),
    contribution('rejection', -0.5),
    contribution('crowd', 0.9),
  ]);
  assert.deepEqual(sources(why), ['crowd', 'rejection', 'studio']);
});

test('an empty breakdown projects to an empty list rather than throwing', () => {
  assert.deepEqual(projectWhy([]), []);
});
