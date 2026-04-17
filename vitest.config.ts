import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/simulator/**/*.test.ts', 'tests/preprod/**/*.test.ts'],
    exclude: process.env.MIDNIGHT_PREPROD_E2E === '1' ? [] : ['tests/preprod/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    environment: 'node',
  },
});
