/**
 * Fail loudly when the test suite discovers nothing.
 *
 * `node --test "tests/**\/*.test.ts"` exits **0** when the glob matches no
 * files — verified on node 22.17. That is the one failure this suite cannot
 * tolerate, because the suite's whole justification is being wired into
 * `prebuild`: rename `tests/`, switch to a `.spec.ts` convention, or lose the
 * folder to a bad checkout, and the build stays green while enforcing nothing.
 * Silent, no crash, no build error — exactly the failure shape the tests exist
 * to catch, one level up.
 *
 * Runs as `pretest`, so it guards `npm test` and therefore `npm run build`.
 * Deliberately a floor rather than an exact count: it must not need editing
 * every time a test file is added.
 */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '../tests');
/** Bump only if the suite is ever deliberately shrunk below this. */
const MINIMUM = 1;

if (!fs.existsSync(DIR)) {
  console.error(`[check-suite] No tests/ directory at ${DIR}.`);
  console.error('[check-suite] `prebuild` runs the suite; an absent suite must fail the build, not pass it.');
  process.exit(1);
}

const found = fs
  .readdirSync(DIR, { recursive: true })
  .map(String)
  .filter(name => name.endsWith('.test.ts'));

if (found.length < MINIMUM) {
  console.error(`[check-suite] Found ${found.length} *.test.ts under tests/, expected at least ${MINIMUM}.`);
  console.error('[check-suite] `node --test` exits 0 on an empty glob, so this would otherwise pass silently.');
  process.exit(1);
}
