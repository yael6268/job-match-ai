import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

// Opt-in checks against the REAL job-board APIs (`npm run test:live`). Never part of `npm test`.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['tests/live/**/*.live.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: true,
    testTimeout: 120_000,
  },
});
