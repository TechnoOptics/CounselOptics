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
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
