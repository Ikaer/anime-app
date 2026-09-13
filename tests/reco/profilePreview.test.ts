/**
 * The reco-profile preview (docs/recoProfiles/PLAN.md, phase 5) — the parts that
 * fail SILENTLY.
 *
 *  - The preview pool must BE the « Recommandé » mark's population. Two
 *    transcriptions of a five-condition eligibility rule is the drift bug this
 *    repo keeps refusing: the day one of them learns about a new exclusion, the
 *    preview proposes titles the mark would never touch, and nothing errors.
 *  - A 👎 must reach the pool on the next request. The 👎 store is off the
 *    seven-slice join, so a pool cached on the row array would go stale with no
 *    new array to invalidate it.
 *  - In an UNSEEN pool a box's « écartés » are reachable (the recos tab files
 *    unwatched titles there); re-proposing one is the thing that set exists to
 *    prevent.
 *  - The §8 diagnostic counts recurrence across UNITS: counted by entry, four
 *    cours of one show read as a recurring director and a learned axis.
 *  - A profile minted `preview` would be shadowed by the static preview route.
 *
 * `rankBoxCandidates` runs for real on fixture rows (it takes rows and groups as
 * arguments), with `DATA_PATH` pointed at a missing folder first — see
 * profileRanking.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildAffinityIndex, buildUnseenPool } from '@/lib/reco/affinity';
import { diagnoseFamilies } from '@/lib/reco/profileDiagnostic';
import { mintProfileId, RESERVED_PROFILE_IDS } from '@/lib/reco/profileWeights';
import type { AnimeRecord, Box } from '@/models/anime';

process.env.DATA_PATH = path.join(os.tmpdir(), 'anime-app-test-no-store-here');

interface Fixture {
  title?: string;
  status?: string;
  score?: number;
  genres?: string[];
  tags?: string[];
  staff?: { id: number; role: string }[];
  hidden?: boolean;
  ratingIntent?: 'rewatch' | 'no_opinion';
}

const anime = (id: string, f: Fixture = {}): AnimeRecord => ({
  id,
  crosswalk: {},
  catalog: { title: f.title ?? id, genres: (f.genres ?? []).map(name => ({ id: 0, name })), studios: [] },
  personal: { status: f.status, score: f.score },
  sources: f.tags || f.staff
    ? {
        anilist: {
          tags: (f.tags ?? []).map(name => ({ name, rank: 80, category: 'x' })),
          staff: (f.staff ?? []).map(s => ({ ...s, name: `p${s.id}` })),
        },
      }
    : {},
  provenance: { catalog: {}, personal: {} },
  hidden: f.hidden,
  ratingIntent: f.ratingIntent,
} as unknown as AnimeRecord);

/** Every eligibility case the mark knows, beside two seeds so the mark builds at all. */
const world = () => [
  anime('seed1', { status: 'completed', score: 9, genres: ['Action'], tags: ['Space'] }),
  anime('seed2', { status: 'completed', score: 10, genres: ['Action'], tags: ['Space'] }),
  anime('seen', { status: 'completed', score: 6, tags: ['Space'] }),
  anime('planned', { status: 'plan_to_watch', tags: ['Space'] }),
  anime('hidden', { hidden: true, tags: ['Space'] }),
  anime('down', { tags: ['Space'] }),
  anime('intent', { ratingIntent: 'no_opinion', tags: ['Space'] }),
  anime('bare'),
  anime('sequel', { title: 'Space Opera 2nd Season', tags: ['Space'] }),
  anime('fresh', { tags: ['Space'] }),
];

test('the preview pool is exactly the « Recommandé » mark\'s population', () => {
  const all = world();
  const downIds = new Set(['down']);
  const pool = buildUnseenPool(all, downIds);
  const mark = buildAffinityIndex(all, { downIds });

  assert.deepEqual([...pool.eligible].sort(), [...mark.scores.keys()].sort(), 'one rule, not two');
  assert.equal(pool.unseen, mark.coverage.unseen, 'the same coverage count');
  assert.deepEqual([...pool.eligible].sort(), ['fresh', 'planned'], 'the cases themselves, stated');
});

test('a 👎 reaches the pool with the SAME row array', () => {
  const all = world();
  assert.ok(buildUnseenPool(all, new Set()).eligible.has('fresh'));
  assert.equal(buildUnseenPool(all, new Set(['fresh'])).eligible.has('fresh'), false,
    'a pool cached on the row array would still offer it');
});

test('the §8 diagnostic counts recurrence across UNITS, not entries', () => {
  // Director 7 directs both cours of one show (one declared unit) — an entry
  // count would call that an axis. Director 8 directs two different shows.
  const cour1 = anime('c1', { staff: [{ id: 7, role: 'Director' }, { id: 8, role: 'Director' }] });
  const cour2 = anime('c2', { staff: [{ id: 7, role: 'Director' }] });
  const other = anime('o', { staff: [{ id: 8, role: 'Director (ep 2)' }, { id: 9, role: 'Music' }] });

  const d = diagnoseFamilies([[cour1, cour2], [other]]);
  const director = d.families.find(f => f.family === 'staffDirector')!;
  assert.equal(d.units, 2);
  assert.equal(d.entries, 3);
  assert.equal(director.people, 2);
  assert.equal(director.recurring, 1, 'person 7 recurs across entries, not units');
  assert.deepEqual(director.shared, [{ id: 8, name: 'p8', units: 2 }]);
  assert.equal(director.verdict, 'axis');

  const music = d.families.find(f => f.family === 'staffMusic')!;
  assert.equal(music.verdict, 'retrieval', 'one composer on one unit: more by this person, not an axis');
  assert.equal(d.families.find(f => f.family === 'staffArt')!.verdict, 'empty');

  const byEntry = diagnoseFamilies([[cour1], [cour2], [other]]).families.find(f => f.family === 'staffDirector')!;
  assert.equal(byEntry.recurring, 2, 'the inflation the unit collapse removes');
});

test('the unseen pool ranks unwatched titles, and still skips members and écartés', async () => {
  const { rankBoxCandidates } = await import('@/lib/reco/boxes');
  const all = [
    anime('m', { status: 'completed', tags: ['Space'] }),
    anime('unseenHit', { tags: ['Space'] }),
    anime('refused', { tags: ['Space'] }),
    anime('watchedHit', { status: 'completed', tags: ['Space'] }),
    anime('x1', { tags: ['C'] }),
    anime('x2', { tags: ['D'] }),
    anime('x3', { tags: ['E'] }),
  ];
  const box: Box = { id: 'b', name: 'b', members: ['m'], excluded: ['refused'], createdAt: '' };
  const pool = new Set(['m', 'unseenHit', 'refused']);

  const inPool = rankBoxCandidates(box, all, { groups: [], pool }).map(g => g.id);
  assert.deepEqual(inPool, ['unseenHit'], 'no member, no écarté, nothing outside the pool');

  const fillLoop = rankBoxCandidates(box, all, { groups: [] }).map(g => g.id);
  assert.deepEqual(fillLoop, ['watchedHit'], 'without a pool it is the statused fill loop, unchanged');
});

test('no profile id is minted onto a static route under api/anime/profiles/', () => {
  const dir = path.join(process.cwd(), 'src/pages/api/anime/profiles');
  const staticRoutes = fs.readdirSync(dir)
    .filter(f => /\.tsx?$/.test(f) && !f.startsWith('[') && !/^index\./.test(f))
    .map(f => f.replace(/\.tsx?$/, ''));
  assert.ok(staticRoutes.length > 0, 'the preview route exists, so this asserts something');
  for (const route of staticRoutes) {
    assert.ok(RESERVED_PROFILE_IDS.includes(route), `${route}.ts would shadow a profile minted "${route}"`);
  }
  assert.equal(mintProfileId('Preview', [], []), 'preview-2');
});
