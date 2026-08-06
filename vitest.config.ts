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
      // Matches the tsconfig `@/*` path so an imported route resolves the same
      // files a test mocks by relative path. The trailing slash keeps this off
      // scoped package names such as `@supabase/ssr`.
      '@/': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
