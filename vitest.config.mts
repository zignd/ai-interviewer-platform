import { defineConfig } from 'vitest/config';
import path from 'node:path';

const alias = { '@': path.resolve(import.meta.dirname) };

export default defineConfig({
  resolve: { alias },
  test: {
    exclude: ['**/node_modules/**', '.claude/**'],
    coverage: {
      provider: 'v8',
      include: ['lib/engine/**', 'lib/queue/**', 'lib/storage/**', 'lib/recorder/**'],
      // service.ts needs a database, so integration tests cover it.
      exclude: [
        'lib/engine/service.ts',
        'lib/engine/types.ts',
        'lib/queue/service.ts',
        'lib/storage/service.ts',
      ],
      thresholds: { lines: 90, statements: 90, functions: 85, branches: 75 },
      reporter: ['text', 'html'],
    },
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/global-setup.ts'],
          testTimeout: 30000,
          hookTimeout: 60000,
          fileParallelism: false,
        },
      },
    ],
  },
});
