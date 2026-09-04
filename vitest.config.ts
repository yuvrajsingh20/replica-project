import { config } from 'dotenv';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '.env.local'), override: true });

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**/*.ts', 'packages/shared/src/**/*.ts'],
      exclude: [
        'packages/engine/src/types.ts',
        'packages/shared/src/index.ts',
        'packages/engine/src/index.ts',
      ],
    },
    // RLS suite is also runnable via pnpm test:rls and is required by pnpm check
    fileParallelism: false,
  },
});
