import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['frontend/tests/**/*.test.ts', 'backend/tests/**/*.test.ts'],
  },
});
