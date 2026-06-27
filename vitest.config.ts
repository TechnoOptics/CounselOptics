import { defineConfig } from 'vitest/config';

// Unit tests for pure logic + data integrity. Node environment (no DOM)
// keeps them fast and CI-friendly. Tests live in tests/ and import the
// lib modules by relative path, so no path-alias wiring is needed.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
