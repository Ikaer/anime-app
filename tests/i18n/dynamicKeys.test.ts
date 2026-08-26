/**
 * The key families built at runtime with `` t(`family.${id}` as TranslationKey) ``.
 *
 * That cast is the whole reason this file exists: it **bypasses the missing-key
 * compile check**, which is otherwise the thing keeping the dictionaries
 * honest. A miss does not throw — `translate()` falls back to the raw key, so
 * the TV renders the literal string `statusShort.on_hold` in the middle of the
 * page. Nothing in the build, the linter or the type-checker says a word.
 *
 * CLAUDE.md lists these families and says they "must be kept exhaustive by
 * hand". This is that, mechanised.
 *
 * **Only `fr` is asserted here.** `locales.test.ts` proves the two dictionaries
 * carry identical key sets, so a key present in `fr` is present in `en` — and
 * checking both would report every genuine gap twice.
 *
 * **Each family is driven from the id source the call site actually uses**, not
 * from a list copied into this file. Where the ids come from an exported
 * runtime constant, that constant is imported. Where they come from a union
 * type with no runtime array, the list is written as a `satisfies Record<Union,
 * 0>` literal — which makes adding a member to the union a COMPILE error here
 * until it is listed, so the union stays the source of truth either way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import fr from '@/locales/fr.json';
import { PROVIDER_CAPABILITIES, type PersonalDimension } from '@/lib/providers/capabilities';
import { SOURCE_META, RECO_WEIGHT_PRESETS } from '@/lib/reco/weights';
import { VIEW_PRESETS } from '@/lib/url/animeParams';
import { GENRE_AXES } from '@/lib/domain/genreAxis';
import { STAFF_ROLE_TIERS } from '@/lib/domain/staffRole';
import { TITLE_LANGUAGES } from '@/lib/url/viewDefaults';
import { STATS_DIMENSIONS } from '@/lib/domain/stats';
import { GRAPH_FOCAL_TYPES } from '@/lib/domain/animeGraph';
import { CRON_FRESHNESS_LEVELS, type CronRejectionReason } from '@/lib/domain/cronFreshness';
import type { UserAnimeStatus, SeasonName } from '@/models/anime';
import type { TierAxis } from '@/lib/domain/tierGap';
// Type-only: `useTierUrlState` is a hook module, and the transpile elides an
// import never used in a value position — so React is never loaded here.
import type { TierVersus } from '@/hooks/useTierUrlState';

const has = (key: string) => key in fr;

/** Assert every key this family can generate exists. Failure names the keys. */
function family<T>(name: string, ids: readonly T[], makeKey: (id: T) => string) {
  test(`${name} covers every id its call site can pass`, () => {
    assert.ok(ids.length > 0, `${name}: the id source is empty, so this asserts nothing`);
    assert.deepEqual(ids.map(makeKey).filter(k => !has(k)), [], `missing from fr.json for ${name}`);
  });
}

/**
 * Exhaustive against the union at COMPILE time: drop a member and `Record`
 * complains, add one that is not in the union and the fresh literal complains.
 */
const keysOf = <T extends string | number>(o: Record<T, 0>) => Object.keys(o) as T[];

const STATUSES = keysOf({
  watching: 0, completed: 0, on_hold: 0, dropped: 0, plan_to_watch: 0,
} satisfies Record<UserAnimeStatus, 0>);

const SEASONS = keysOf({
  winter: 0, spring: 0, summer: 0, fall: 0,
} satisfies Record<SeasonName, 0>);

const DIMENSIONS = keysOf({
  status: 0, score: 0, progress: 0,
} satisfies Record<PersonalDimension, 0>);

const TIER_AXES = keysOf({
  me: 0, mal: 0, anilist: 0, gap: 0,
} satisfies Record<TierAxis, 0>);

const TIER_VERSUS = keysOf({
  none: 0, mal: 0, anilist: 0,
} satisfies Record<TierVersus, 0>);

const CRON_REJECTION_REASONS = keysOf({
  method: 0, secretMismatch: 0, noHeader: 0,
} satisfies Record<CronRejectionReason, 0>);

/**
 * MAL's `airingStatus` is typed `string` on the record — the provider does not
 * give us a union to derive from, so this list is transcribed rather than
 * derived, and is the one family here that would not notice a new value.
 */
const AIRING_STATUSES = ['finished_airing', 'currently_airing', 'not_yet_aired'] as const;

/** The owner's watch status, on the card, the detail page, /activity, /stats… */
family('status.*', STATUSES, s => `status.${s}`);
family('statusShort.*', STATUSES, s => `statusShort.${s}`);
family('seasonName.*', SEASONS, s => `seasonName.${s}`);
family('airing.*', AIRING_STATUSES, s => `airing.${s}`);

/**
 * `PROVIDER_CAPABILITIES` is a `Record<ProvenanceSource, …>`, so its keys ARE
 * the provider union — adding a provider is a compile error there and a test
 * failure here until both dictionaries name it.
 */
family('disc.provider.*', Object.keys(PROVIDER_CAPABILITIES), p => `disc.provider.${p}`);
family('provider.dimension.*', DIMENSIONS, d => `provider.dimension.${d}`);
family('personalEdit.*', DIMENSIONS, d => `personalEdit.${d}`);

/** Both halves of every reco slider, and both halves of every weight preset. */
family('reco.source.*.label', SOURCE_META.map(m => m.source), s => `reco.source.${s}.label`);
family('reco.source.*.hint', SOURCE_META.map(m => m.source), s => `reco.source.${s}.hint`);
family('reco.preset.*.label', RECO_WEIGHT_PRESETS.map(p => p.key), k => `reco.preset.${k}.label`);
family('reco.preset.*.hint', RECO_WEIGHT_PRESETS.map(p => p.key), k => `reco.preset.${k}.hint`);

/** `VIEW_PRESETS` is deliberately untranslated data; the keys derive from it. */
family('views.*.label', VIEW_PRESETS.map(p => p.key), k => `views.${k}.label`);
family('views.*.description', VIEW_PRESETS.map(p => p.key), k => `views.${k}.description`);

family('filters.genreAxis.*', GENRE_AXES, a => `filters.genreAxis.${a}`);
family('titleLanguage.*', TITLE_LANGUAGES, t => `titleLanguage.${t}`);
family('stats.dim.*', STATS_DIMENSIONS, d => `stats.dim.${d}`);
family('graph.focalType.*', GRAPH_FOCAL_TYPES, t => `graph.focalType.${t}`);
family('graph.tier.*', STAFF_ROLE_TIERS, t => `graph.tier.${t}`);
family('tier.axis.*', TIER_AXES, a => `tier.axis.${a}`);
family('tier.vs.*', TIER_VERSUS, v => `tier.vs.${v}`);

/**
 * The cron-freshness panel. Each level is a different DIAGNOSIS, so a missing
 * key would render a raw dotted string exactly where the page is supposed to be
 * explaining an outage — the one moment it has to be legible.
 */
family('cronFreshness.level.*', CRON_FRESHNESS_LEVELS, l => `cronFreshness.level.${l}`);
family('cronFreshness.reason.*', CRON_REJECTION_REASONS, r => `cronFreshness.reason.${r}`);

/** Ten rows, 10 → 1, each carrying MAL's own word for that score. */
family('tierWord.*', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], n => `tierWord.${n}`);

/**
 * ⚠️ **Deliberately NOT `STAFF_ROLE_TIERS`.** This family is partial by design:
 * the detail page labels only T2 and T3 through the dynamic key — T1 has its
 * own section heading and T4 is folded into `detail.staffTierMore` ("Autres
 * crédits ({count})"). Asserting the full union here would demand two keys
 * nothing renders, which is why `/graph` gave itself a complete `graph.tier.*`
 * set above rather than reusing this one.
 */
family('detail.staffTier.* (T2/T3 only)', [2, 3], t => `detail.staffTier.${t}`);
