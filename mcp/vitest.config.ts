import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `*.test.ts` only. This package has NO database, so there is no
    // `*.it.test.ts` here — that suffix is the repo's CI split for tests that
    // need Postgres, and a name in that lane with no Postgres fails in a way
    // that looks unrelated.
    include: ['test/**/*.test.ts'],
  },
});
