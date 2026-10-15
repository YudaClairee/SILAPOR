import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Route tests opt into jsdom per file (`// @vitest-environment jsdom`);
    // server and lib tests stay on node.
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
