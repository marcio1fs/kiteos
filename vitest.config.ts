import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Integration tests run against a real PostgreSQL and DROP the public schema,
    // so they are never part of the default suite. Run them explicitly:
    //   DATABASE_URL=... npx vitest run --config vitest.integration.config.ts
    exclude: ['**/node_modules/**', 'src/__tests__/integration/**'],
    // AUD-05 FIX: Run global setup to ensure Prisma Client is generated before tests
    globalSetup: './vitest.setup.ts',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
