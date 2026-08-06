import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for pure logic + data integrity. Node environment (no DOM)
// keeps them fast and CI-friendly. Tests import the lib modules by relative
// path; the `@/` alias is wired only because route handlers under app/ use it,
// and a test that drives a route loads the route's own import graph.
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
      // it. Four branches added this independently, some keyed '@' and some
      // keyed '@/'; they are collapsed here to the single slashed form.
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
  // tsconfig sets "jsx": "preserve" because Next does its own JSX
  // transform. Vite reads that and leaves the JSX in place, so a test
  // that imports a .tsx module fails to parse. Compiling it here lets
  // a server component be CALLED as the plain function it is and its
  // returned element tree asserted, with no DOM and no renderer.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
