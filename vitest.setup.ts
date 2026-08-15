import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * AUD-05 FIX: Global Vitest setup that ensures Prisma Client is generated before tests run.
 */
export default function setup() {
  const prismaClientPath = path.resolve(__dirname, './node_modules/.prisma/client/default.js');

  if (!fs.existsSync(prismaClientPath)) {
    console.log('[vitest.setup] Prisma Client not found — running prisma generate...');
    try {
      execSync('npx prisma generate', { stdio: 'inherit' });
      console.log('[vitest.setup] Prisma generate completed successfully.');
    } catch (error) {
      console.warn('[vitest.setup] prisma generate failed — security-regression tests may fail:', error);
    }
  }
}

