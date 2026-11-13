import { defineConfig } from 'vitest/config';
import path from 'path';

// Sondas isoladas da auditoria. NÃO fazem parte da suíte de aceitação do produto.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['audit/*.probe.test.ts'],
    fileParallelism: false,
    testTimeout: 10000,
  },
  resolve: { alias: { '@': path.resolve(__dirname, '../src') } },
});
