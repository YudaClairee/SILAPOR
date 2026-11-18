import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // scrypt is deliberately slow; under parallel Moon runs the default 5s
    // timeout is not enough.
    testTimeout: 30_000,
  },
});
