import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for pure logic + data integrity. Node environment (no DOM)
// keeps them fast and CI-friendly. Tests live in tests/ and import the
// lib modules by relative path, so no path-alias wiring is needed.
export default defineConfig({
  resolve: {
    alias: {
      // `server-only` is a Next build-time guard with no runtime behavior; it
      // isn't resolvable under the Node test env, so stub it so server-only lib
      // modules (e.g. lib/counsel-guest.ts) can be unit-tested.
      'server-only': fileURLToPath(
        new URL('./tests/stubs/server-only.ts', import.meta.url),
      ),
      // The project's own path alias, mirroring tsconfig's "@/*": ["./*"], so a
      // test can drive a route handler or an app/ module that imports through
      // it. Two branches added this independently and the merge kept both, one
      // keyed '@' and one keyed '@/'; they are collapsed here to the single
      // slashed form.
      //
      // The trailing slash is deliberate but NOT for the reason one of those
      // comments gave. Vite resolves a string alias through
      // @rollup/plugin-alias, which matches only an exact hit or a `find + '/'`
      // prefix, so a bare '@' could not have swallowed '@supabase/...' either.
      // The slash is kept because it states the intent at a glance and because
      // this repo has a real `supabase/` directory at its root, which is what a
      // naive prefix replacement would have hit.
      '@/': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  // tsconfig.json sets jsx: 'preserve' for Next's own compiler, which esbuild
  // cannot parse. Transform JSX with the automatic runtime here so a server
  // component can be imported and its returned element tree inspected. Still
  // no DOM and still no testing-library: a server component returns plain
  // objects, which is all these tests read.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
