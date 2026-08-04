import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname) },
  },
  test: {
    // Node is the default; DOM tests opt in per file with `// @vitest-environment jsdom`.
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      include: ['app/**/*.{ts,tsx}', 'components/**/*.tsx', 'lib/**/*.ts', 'scripts/*.ts'],
      exclude: ['app/layout.tsx', 'scripts/build-index.ts'],
    },
  },
});
