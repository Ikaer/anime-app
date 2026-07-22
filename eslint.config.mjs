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
  '@/lib/providers/mal/**',
  '@/lib/providers/simkl/**',
  '@/lib/providers/anilist/**',
  '@/lib/reco/data',
  '@/lib/reco/feed',
  '@/lib/reco/feedback',
  '@/lib/reco/refresh',
  '@/lib/reco/similar',
].flatMap((p) => [p, p.replace(/^@\//, '**/')]);

const SERVER_ONLY_MESSAGE =
  'Server-only module (transitively reaches fs) — components and hooks must not bundle it. ' +
  'Types are fine: use `import type`. Values belong in a page, getServerSideProps or an API route; ' +
  'the client-safe helpers are @/lib/domain/**, @/lib/url/**, @/lib/i18n, ' +
  '@/lib/reco/{weights,scoring,byCredits} and @/lib/providers/{capabilities,personalState,discrepancy}.';

export default defineConfig([
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
