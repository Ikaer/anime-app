/**
 * Run the app's own TypeScript modules from a plain `node scripts/*.js`.
 *
 * Measurement scripts must exercise the REAL engine (`reco/feed.ts` and the
 * kernel behind it), not a JS re-implementation of it — a harness that scores
 * differently from production measures nothing. Two things stand between node
 * and those modules, and this file is both fixes:
 *
 *  1. **The `@/` alias.** `tsconfig.json` maps it to `src/`; node does not read
 *     tsconfig. The resolve hook rewrites it, and also fills in the extension /
 *     `index.ts` that `moduleResolution: bundler` lets the source omit.
 *  2. **Type-only imports written as value imports.** `feed.ts` opens with
 *     `import { AnimeRecord, ... } from '@/models/anime'` — every one of those is
 *     an interface, so node's built-in type stripping (which cannot tell a type
 *     from a value) leaves the specifier in place and the link fails. Running the
 *     source through `ts.transpileModule` instead elides any import never used in
 *     a value position, which is exactly the set that must go.
 *
 * Uses `module.registerHooks()` (synchronous, in-process) rather than a worker
 * loader so a script can just `require`/`import` this file first.
 */

const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const SRC = path.resolve(__dirname, '../../src');
const EXTENSIONS = ['.ts', '.tsx', '.json', '/index.ts', '/index.tsx'];

/** Append whatever extension actually exists on disk; `null` if none does. */
function withExtension(filePath) {
  if (path.extname(filePath) && fs.existsSync(filePath)) return filePath;
  for (const ext of EXTENSIONS) {
    const candidate = filePath + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let target = null;
    if (specifier.startsWith('@/')) {
      target = withExtension(path.join(SRC, specifier.slice(2)));
    } else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      target = withExtension(path.resolve(parentDir, specifier));
    }
    if (target) {
      return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    // `src/locales/*.json` is imported bare (`resolveJsonModule`, no import
    // attribute) — node's ESM loader demands `with { type: 'json' }`, so hand it
    // back as a module instead of failing the whole graph.
    if (url.endsWith('.json')) {
      const json = fs.readFileSync(fileURLToPath(url), 'utf8');
      return { format: 'module', source: `export default ${json};`, shortCircuit: true };
    }
    if (!/\.tsx?$/.test(url)) return nextLoad(url, context);
    const filePath = fileURLToPath(url);
    const source = fs.readFileSync(filePath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filePath,
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
