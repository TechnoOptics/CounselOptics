import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests for pure logic + data integrity. Node environment (no DOM)
// keeps them fast and CI-friendly. Tests live in tests/ and import the
// lib modules by relative path, so no path-alias wiring is needed.
export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" -> "./*" path alias. Tests import lib
      // modules by relative path, but those modules import each other
      // through the alias, so it has to resolve here too.
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // `server-only` is a Next build-time guard with no runtime behavior; it
      // isn't resolvable under the Node test env, so stub it so server-only lib
      // modules (e.g. lib/counsel-guest.ts) can be unit-tested.
      'server-only': fileURLToPath(
        new URL('./tests/stubs/server-only.ts', import.meta.url),
      ),
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
