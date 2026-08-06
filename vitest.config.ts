import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for pure logic + data integrity. Node environment (no DOM)
// keeps them fast and CI-friendly. Tests live in tests/ and import the
// lib modules by relative path, so no path-alias wiring is needed.
export default defineConfig({
  resolve: {
    alias: {
      // The project's own path alias, so a test can import an app/ module that
      // uses it. Without this, anything under app/ is untestable here, and the
      // access-ended page is a page whose COPY is a correctness requirement.
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // `server-only` is a Next build-time guard with no runtime behavior; it
      // isn't resolvable under the Node test env, so stub it so server-only lib
      // modules (e.g. lib/counsel-guest.ts) can be unit-tested.
      'server-only': fileURLToPath(
        new URL('./tests/stubs/server-only.ts', import.meta.url),
      ),
      // Route handlers import through the `@/` path alias, so a test that
      // drives one (tests/firm-export-route.test.ts) needs the same alias
      // tsconfig gives the app. The key keeps its trailing slash on purpose:
      // a bare '@' is a prefix match and would also swallow '@supabase/...'.
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
