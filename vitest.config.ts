import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/api/__tests__/**'],
    setupFiles: ['src/test/setup.ts'],
  },
});
