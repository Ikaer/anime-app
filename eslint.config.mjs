import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

// Modules that transitively reach `fs` and must never be bundled client-side.
// Each pattern is doubled as `**/lib/…` so a relative import can't dodge the `@/` alias.
const SERVER_ONLY = [
  '@/lib/store',
  '@/lib/store/**',
  '@/lib/config/settings',
  '@/lib/config/connectionLog',
  '@/lib/providers/registry',
  '@/lib/providers/status',
  '@/lib/providers/writers',
  '@/lib/providers/cronSync',
  '@/lib/providers/cronHealth',
  '@/lib/providers/mal/**',
  '@/lib/providers/simkl/**',
  '@/lib/providers/anilist/**',
  '@/lib/reco/anchored',
  '@/lib/reco/boxes',
  '@/lib/reco/data',
  '@/lib/reco/feed',
  '@/lib/reco/feedback',
  '@/lib/reco/groups',
  '@/lib/reco/mixFetch',
  '@/lib/reco/profiles',
  '@/lib/reco/refresh',
  '@/lib/reco/similar',
].flatMap((p) => [p, p.replace(/^@\//, '**/')]);

const SERVER_ONLY_MESSAGE =
  'Server-only module (transitively reaches fs) — components and hooks must not bundle it. ' +
  'Types are fine: use `import type`. Values belong in a page, getServerSideProps or an API route; ' +
  'the client-safe helpers are @/lib/domain/**, @/lib/url/**, @/lib/i18n, ' +
  '@/lib/reco/{weights,scoring,byCredits,staffFields,profileWeights} and @/lib/providers/{capabilities,personalState,discrepancy}.';

// Store exports that WRITE. The MCP surface is read-only by contract, and these
// are the names that would break it — including `resolveCanonicalId(s)`, which
// mints a registry entry when it can't resolve one.
const STORE_WRITES = [
  'saveAnime',
  'upsertAnime',
  'addHiddenAnimeId',
  'removeHiddenAnimeId',
  'upsertMalPersonal',
  'removeMalPersonal',
  'upsertSimklEntries',
  'removeSimklEntries',
  'upsertAnilistMeta',
  'upsertAnilistCatalogFields',
  'upsertAnilistCast',
  'replaceAnilistPersonalEntries',
  'upsertAnilistPersonalEntries',
  'removeAnilistPersonalEntries',
  'upsertLocalEntries',
  'removeLocalEntries',
  'updatePersonalStatusBatch',
  'resolveCanonicalId',
  'resolveCanonicalIds',
];

// Modules whose whole point is to mutate something — the store, a provider, or a
// remote list. None of them belongs in a read-only surface.
const WRITE_MODULES = [
  '@/lib/providers/writers',
  '@/lib/providers/cronSync',
  '@/lib/providers/cronHealth',
  '@/lib/providers/*/write',
  '@/lib/providers/*/sync',
  '@/lib/providers/*/personalSync',
  '@/lib/reco/refresh',
  '@/lib/reco/feedback',
].flatMap((p) => [p, p.replace(/^@\/lib\//, '**/'), p.replace(/^@\//, '**/')]);

const GROUP_DELETE_MESSAGE =
  "Dropping a « regroupement » throws away labeling that exists in exactly one place and that " +
  "no provider can re-supply — deleteBox's objection, unchanged. Creating and editing one IS " +
  "open here: naming what several cours have in common is the thing this surface is for, and " +
  "the owner reads every proposal before it lands. Deleting is not a proposal, it is a loss. " +
  "The owner drops a group in the blade on /boxes/[id].";

const SEED_MUTE_WRITE_MESSAGE =
  "Muting a seed is the OWNER's call, not this surface's. Reading the mutes is fine " +
  "(getSeedMutes / getSeedMuteSet / getMutedSeedAnime) and is what lets a model report which " +
  "titles dominate the feed; writing one is not. A mute silently changes every later ranking, " +
  "so a model that could set one would be tuning the answer it is about to give — the same " +
  "'marking its own homework' objection that keeps ratings and statuses read-only, and a " +
  "sharper one than boxes faced, since a box is a named object the owner sees on /boxes while " +
  "a mute is a subtraction. The tool surface reports the diagnosis; the owner clicks the mute " +
  "in the app (the feed card's seed hint, or the « Sources » sidebar section).";

const PROFILE_WRITE_MESSAGE =
  "Reco profiles are READABLE here, never writable (docs/recoProfiles/DESIGN.md §9). The boxes " +
  "carve-out is not precedent: a box is a named object the owner sees on /boxes, while a profile " +
  "is a weighting that silently changes every ranking that follows — so a model able to create, " +
  "edit or attach one would be tuning the answer it is about to give, addSeedMute's objection " +
  "and a sharper one. Reading a profile (to explain a ranking, or to suggest a weighting in " +
  "prose) is fine: getProfiles / getProfile / getBoxProfile / boxesUsingProfile. The owner " +
  "tunes and attaches profiles in the app.";

const READ_ONLY_MESSAGE =
  'The MCP surface is read-only: it exists so a model can ASK about the local record, ' +
  'not edit it. Reads are fine (getAnimeForDisplay, getAnimeByCanonicalId, the get*/list* ' +
  'slice readers); anything that mutates the store or pushes to a provider does not belong ' +
  'under src/lib/mcp/. If a write tool is ever wanted, that is a deliberate decision to make ' +
  'here first, not something to slip past this rule — as it was for boxes, the one carve-out: ' +
  '`@/lib/reco/boxes` is importable so a model can help name and fill a taste axis, which is ' +
  'the thing it is actually good at and the thing the metadata ranker measurably cannot do for ' +
  'a tone axis. Ratings and statuses stay read-only: they are the ground truth every ranking ' +
  'in this app is measured against.';

const BOX_WRITE_MESSAGE =
  'Boxes are writable from the MCP surface, but not deletable. Creating, renaming and adding or ' +
  'removing members are all recoverable in a few clicks; deleting a box throws away labeling ' +
  'that exists in exactly one place and that no provider can re-supply. Remove a box in the app.';

export default defineConfig([
  {
    // ⚠️ `.claude/worktrees/**` holds full CHECKOUTS of this repo — a subagent
    // working in isolation gets one. Without this, `eslint .` lints every file
    // twice (live-measured: 68 warnings became 136 the moment one existed) and,
    // worse, another agent's half-finished edit fails THIS build. CI never sees
    // it, since a runner checks out fresh — so the failure would be local-only
    // and look like a phantom.
    ignores: ['.claude/**'],
  },
  ...nextVitals,
  {
    files: [
      'src/components/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/models/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: SERVER_ONLY,
              allowTypeImports: true,
              message: SERVER_ONLY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // The read-only guard on the MCP surface. Same posture as the server-only
    // guard above: enforced by the linter (which `prebuild` runs, so `npm run
    // build` fails on it) rather than left to discipline.
    files: ['src/lib/mcp/**/*.ts', 'src/pages/api/anime/mcp.ts'],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/store',
              importNames: STORE_WRITES,
              allowTypeImports: true,
              message: READ_ONLY_MESSAGE,
            },
            {
              name: '@/lib/reco/data',
              importNames: ['saveRecommendationsData'],
              allowTypeImports: true,
              message: READ_ONLY_MESSAGE,
            },
            {
              // The ONE writable surface: `user/boxes.json`. `deleteBox` stays
              // blocked by name — filling a box wrong costs a few chip clicks to
              // undo, but dropping one throws away labeling that exists nowhere
              // else and that no provider can re-supply.
              name: '@/lib/reco/boxes',
              importNames: ['deleteBox'],
              allowTypeImports: true,
              message: BOX_WRITE_MESSAGE,
            },
            {
              // ⚠️ `setBoxProfile` lives in the importable `boxes.ts`, so the
              // profile block below would not reach it on its own. It is a
              // separate function from `updateBox` precisely so it can be named
              // here: attaching a profile re-weights the box's rankings.
              name: '@/lib/reco/boxes',
              importNames: ['setBoxProfile'],
              allowTypeImports: true,
              message: PROFILE_WRITE_MESSAGE,
            },
            {
              // Reco profiles: readers open, writers blocked by name — the
              // seed-mute shape, for the seed-mute reason.
              name: '@/lib/reco/profiles',
              importNames: ['createProfile', 'updateProfile', 'deleteProfile'],
              allowTypeImports: true,
              message: PROFILE_WRITE_MESSAGE,
            },
            {
              // « Mes regroupements »: the SECOND writable surface, opened on
              // request once the box tools existed to make it useful. Naming
              // what several cours have in common is exactly what a model is
              // good at, and a group changes nothing until a box DECLARES it —
              // two steps, so a grouping made for one box is never silently
              // imposed on another.
              //
              // ⚠️ `deleteGroup` stays blocked by name, `deleteBox`'s carve-out
              // in the same shape and for the same reason. Keep any future
              // opening this shape too: a named exception with a stated reason,
              // never widening the pattern list.
              name: '@/lib/reco/groups',
              importNames: ['deleteGroup'],
              allowTypeImports: true,
              message: GROUP_DELETE_MESSAGE,
            },
            {
              // Seed mutes: the READERS are the point of the tool surface (a
              // model should be able to say which of the owner's titles is
              // dominating the feed, and which are already muted), so this is a
              // name block rather than a `WRITE_MODULES` pattern — the pattern
              // would take `getSeedMutes` down with the writers.
              name: '@/lib/reco/seedMutes',
              importNames: ['addSeedMute', 'removeSeedMute'],
              allowTypeImports: true,
              message: SEED_MUTE_WRITE_MESSAGE,
            },
          ],
          patterns: [
            {
              group: WRITE_MODULES,
              allowTypeImports: true,
              message: READ_ONLY_MESSAGE,
            },
          ],
        },
      ],
    },
  },
  {
    // eslint-plugin-react-hooks v7 (pulled in by eslint-config-next 16) ships the
    // React Compiler rule set, which flags ~26 long-standing patterns in this app
    // — mostly `useEffect` bodies that kick off a fetch and setState. They are
    // advisories about cascading renders, not correctness bugs, and fixing them
    // is a behavioural refactor rather than a lint fix. Kept visible as warnings
    // so `npm run build` (which lints via prebuild) still fails on real errors,
    // notably the server-only import guard above.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
