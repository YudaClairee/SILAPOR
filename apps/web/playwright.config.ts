import { defineConfig } from '@playwright/test';

// Minimal e2e (Task 6): asserts the fail-open health endpoint answers 200
// with `service: "web"`. The `ok` flag is deliberately NOT asserted — offline
// (DB down, no worker beat) yields ok:false with HTTP 200 by design.
// Run: pnpm --filter @silapor/web run test:e2e (after `npx playwright install`).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
