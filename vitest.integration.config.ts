import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integration tests against a REAL PostgreSQL.
 *
 * They are skipped unless DATABASE_URL points at a database the suite may wipe
 * (it drops and recreates the `public` schema, applying prisma/migrations).
 *
 *   DATABASE_URL=postgresql://user:pass@host:5432/kiteos_test \
 *     npx vitest run --config vitest.integration.config.ts
 *
 * Files run sequentially and each file manages its own pool: concurrency
 * assertions are the whole point, so parallel workers sharing one database
 * would make them meaningless.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
