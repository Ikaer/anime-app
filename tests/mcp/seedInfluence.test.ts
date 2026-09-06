/**
 * `projectSeedInfluence` — which of the owner's own titles the feed leans on.
 *
 * The function exists because the concentration is invisible per card: each one
 * names its own backers, and only the tally says "a quarter of your top 20 comes
 * from two titles". It is the diagnosis the MCP surface reports so a model can
 * suggest a mute — and CLAUDE.md rules that a misleading projection is a bug of
 * the same weight as a scoring bug, which is what these two cases pin.
 *
 * Both failures are SILENT. Neither changes a type, throws, or empties a list;
 * each just re-orders a ranking that still looks entirely plausible, and the
 * consumer confidently names the wrong title as the one worth muting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSeedInfluence } from '@/lib/mcp/tools';
import type { RecoMeta } from '@/models/anime';

/** A candidate backed by the given seeds, strongest first — `topSeeds`' own order. */
const card = (...seedIds: string[]): RecoMeta => ({
  affinityScore: 0,
  topSeeds: seedIds.map(id => ({ id, title: id.toUpperCase(), backers: 1 })),
  totalSeeds: seedIds.length,
  fromSuggestions: false,
  breakdown: [],
});

/**
 * ⚠️ The ordering is `leads` (candidates a seed is the STRONGEST backer of),
 * with `appears` only as a tie-break — never the other way round.
 *
 * The two disagree exactly when a seed backs many candidates without ever being
 * the decisive voice on one, which is the common shape: a broadly-connected
 * title like a long-running shonen shows up second on everything. Sorting by
 * `appears` would rank it above the title actually crowding the top of the feed
 * — the one the owner perceives as "this keeps deciding my recommendations",
 * and the only one muting would help.
 *
 * Here `broad` appears on all four cards and leads none; `narrow` leads two.
 */
test('a seed that leads outranks one that merely appears more often', () => {
  const rows = projectSeedInfluence([
    card('narrow', 'broad'),
    card('narrow', 'broad'),
    card('other', 'broad'),
    card('third', 'broad'),
  ]);

  assert.equal(rows[0].id, 'narrow', 'the seed leading two cards must come first');
  assert.deepEqual(
    { leads: rows[0].leads, appears: rows[0].appears },
    { leads: 2, appears: 2 }
  );

  const broad = rows.find(r => r.id === 'broad');
  assert.ok(broad, 'a seed that never leads is still reported');
  assert.deepEqual({ leads: broad.leads, appears: broad.appears }, { leads: 0, appears: 4 });
  assert.ok(
    rows.indexOf(broad) > 0,
    'appearing on every card must not outrank leading — that is the whole ordering'
  );
});

/**
 * ⚠️ `appears` counts CANDIDATES, and a lead is also an appearance.
 *
 * Counting the two into separate buckets (an `else` on the rank check) would
 * make `leads + appears` the real total and every reported share wrong by the
 * lead count — understating precisely the seeds that dominate, since those are
 * the ones with the most leads to lose.
 */
test('a lead counts as an appearance too, so leads never exceed appears', () => {
  const rows = projectSeedInfluence([card('solo'), card('solo'), card('solo')]);

  assert.equal(rows.length, 1);
  assert.deepEqual(
    { leads: rows[0].leads, appears: rows[0].appears },
    { leads: 3, appears: 3 },
    'three cards led is three cards appeared on, not three and zero'
  );
});
