import { defineConfig } from 'vitest/config';
import path from 'path';

// Acceptance tests for the production-hardening work. They use mocked Prisma
// clients and assert the predicates/CAS guards that enforce tenant isolation and
// atomicity. They do NOT replace integration tests against a real PostgreSQL.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/acceptance/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 10000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
