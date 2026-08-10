/**
 * tests/support/strip-comments.ts, usable from the plain-Node guards.
 *
 * WHY THIS IS NOT A SECOND COPY. Several guards under scripts/test read source
 * as text and must not be satisfied by a comment that merely names the thing
 * being guarded. The vitest guards already have a stripper, and its own header
 * explains at length why the naive version eats live JSX. Writing the rule out
 * again here would leave two copies to drift, which this repo has been bitten
 * by before. So the .ts module is compiled with the repo's own typescript and
 * used directly, the same way scripts/test/scroll-lock-wheel.mjs loads the
 * shipped lib/scroll-lock.ts rather than mirroring it.
 *
 * typescript is a devDependency and the guards workflow runs `npm ci` before
 * `npm run test:audit-guards`, so it is present wherever these run.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ts = require('typescript');
const source = readFileSync(join(root, 'tests', 'support', 'strip-comments.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;

const module_ = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('exports', 'module', compiled)(module_.exports, module_);

/** @type {(src: string) => string} */
export const stripComments = module_.exports.stripComments;

if (typeof stripComments !== 'function') {
  throw new Error(
    'tests/support/strip-comments.ts no longer exports stripComments; the guards that rely on it would silently stop stripping.',
  );
}
