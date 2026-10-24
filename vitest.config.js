import { defineConfig } from 'vitest/config';

// `npm test` runs the unit tests only; the database tests need `npx supabase start`
// and run with `npm run test:db` (vitest.db.config.js).
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    include: ['tests/unit/**/*.test.js'],
  },
});
