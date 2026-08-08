import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * lib/token-economy.ts must not be a server-action module.
 *
 * Every export of a `'use server'` module is a public HTTP endpoint. All seven
 * exports here take the identity they act on from their own arguments
 * (`userId`, `firmId`), write through the service-role client, and perform no
 * caller authentication: applyTopupPurchase credits a paid token pack against a
 * caller-supplied payment intent id, and debitTokens can empty any user's
 * balance or any firm's pool. Nothing remotely exploitable was demonstrated,
 * because no client component imports this module and so Next never emits its
 * action ids into a client bundle - but that is one import away from being
 * false, and `import 'server-only'` closes it for free by turning any such
 * import into a build error.
 *
 * This guard therefore checks two things, and neither can be satisfied by a
 * comment: comments are stripped before matching, and the directive check
 * anchors on the file's first statement rather than on the text appearing
 * somewhere.
 */

const root = join(__dirname, '..');
const TARGET = 'lib/token-economy.ts';

/** Comments removed, approximately. See tests/signing-handoff-routes.test.ts. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The first real statement of a file, comments and blank lines removed. */
function firstStatement(src: string): string {
  return (
    withoutComments(src)
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  );
}

describe('lib/token-economy.ts is not an action module', () => {
  const src = readFileSync(join(root, TARGET), 'utf8');
  const stripped = withoutComments(src);

  it('does not carry a "use server" directive', () => {
    // Anchored on the first statement: a directive is only a directive there.
    expect(firstStatement(src)).not.toMatch(/^['"]use server['"]/);
    // And nowhere else either, so a stray one cannot creep in above the import.
    const directiveLines = stripped
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^['"]use server['"];?$/.test(l));
    expect(directiveLines).toEqual([]);
  });

  it('declares itself server-only', () => {
    expect(stripped).toMatch(/^\s*import\s+['"]server-only['"];/m);
  });

  it('the guard is anchored on the directive, not on prose mentioning it', () => {
    // The file's own comments name `'use server'` to explain why it is absent.
    // If stripping were dropped, the check above would pass on that prose while
    // the directive was back. Prove the stripper actually removes it.
    expect(src).toContain("`'use server'`");
    expect(stripped).not.toContain("use server");
  });
});

/**
 * No client component may pull this module into a client bundle, directly or
 * through a re-export or a barrel.
 *
 * Edge resolution is deliberately over-inclusive (it follows dynamic `import()`
 * as well as static imports) because a false alarm costs an investigation and a
 * miss costs the endpoints back. It stops at one thing only: a `'use server'`
 * module is a bundling BOUNDARY, not an inclusion. Next replaces such an import
 * with an action reference and never ships the module's code to the browser, so
 * a client component importing lib/firm-actions.ts does not thereby bundle
 * everything firm-actions imports. Counting those edges would make this guard
 * fail on ~40 legitimate paths and it would be deleted rather than heeded.
 */
describe('no client component reaches lib/token-economy.ts', () => {
  const files = walk(root).filter((f) => {
    const rel = relative(root, f);
    return (
      !rel.startsWith(`tests${sep}`) &&
      !rel.startsWith(`scripts${sep}`) &&
      !rel.endsWith('.d.ts')
    );
  });

  /** file -> the local files it imports. */
  const graph = new Map<string, string[]>();
  const clientFiles: string[] = [];
  /** Files that are server-action modules, i.e. bundling boundaries. */
  const actionModules = new Set<string>();

  function resolveSpecifier(fromFile: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith('@/')) base = resolve(root, spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
    else return null; // a package, not our tree
    for (const cand of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, 'index.ts'),
      join(base, 'index.tsx'),
    ]) {
      try {
        if (statSync(cand).isFile()) return cand;
      } catch {
        // not this candidate
      }
    }
    return null;
  }

  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const stripped = withoutComments(src);
    if (/^\s*['"]use client['"];?\s*$/m.test(stripped)) clientFiles.push(file);
    if (firstStatement(src).match(/^['"]use server['"]/)) actionModules.add(file);
    // `import type` / `export type` are erased before bundling and carry no
    // code into any bundle, so they are not edges. Dropping the whole statement
    // is what keeps a client component that imports only a TYPE from a server
    // module off this list.
    const runtime = stripped
      .replace(/\bimport\s+type\s[^;]*?;/g, '')
      .replace(/\bexport\s+type\s[^;]*?;/g, '');
    const specs = [
      ...runtime.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
      ...runtime.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ].map((m) => m[1]);
    graph.set(
      file,
      specs
        .map((s) => resolveSpecifier(file, s))
        .filter((f): f is string => f !== null),
    );
  }

  const target = join(root, TARGET);

  /**
   * Breadth-first from every client component, reporting the actual path.
   * `stopAtActions` off is the positive control below.
   */
  function pathsToTarget(stopAtActions: boolean): string[] {
    const offenders: string[] = [];
    for (const entry of clientFiles) {
      const parent = new Map<string, string>();
      const seen = new Set<string>([entry]);
      const queue = [entry];
      let hit: string | null = null;
      while (queue.length && !hit) {
        const cur = queue.shift() as string;
        for (const next of graph.get(cur) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          parent.set(next, cur);
          if (next === target) {
            hit = next;
            break;
          }
          if (stopAtActions && actionModules.has(next)) continue; // boundary
          queue.push(next);
        }
      }
      if (hit) {
        const chain: string[] = [];
        for (let n: string | undefined = hit; n; n = parent.get(n)) {
          chain.unshift(relative(root, n));
        }
        offenders.push(chain.join(' -> '));
      }
    }
    return offenders;
  }

  it('finds client components and a live import graph (not vacuous)', () => {
    expect(clientFiles.length).toBeGreaterThan(50);
    expect(actionModules.size).toBeGreaterThan(10);
    expect(graph.get(target)).toBeDefined();
  });

  it('positive control: the traversal does reach the module when boundaries are ignored', () => {
    // Proves the BFS, the specifier resolver and the graph all work. If this
    // ever goes empty, the guard below is passing for a mechanical reason and
    // is worthless.
    expect(pathsToTarget(false).length).toBeGreaterThan(0);
  });

  it('has no client-bundle import path from any client component', () => {
    expect(pathsToTarget(true)).toEqual([]);
  });
});
