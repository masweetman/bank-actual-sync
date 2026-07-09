import { defineConfig } from 'vitest/config';

const TEST_KEY = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'; // 64 hex chars

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts'],
    },
    env: {
      DB_PATH: ':memory:',
      ENCRYPTION_KEY: TEST_KEY,
    },
  },
});
