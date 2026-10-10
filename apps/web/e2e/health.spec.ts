import { expect, test } from '@playwright/test';

test('GET /api/health answers 200 with service web', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { service?: unknown };
  expect(body.service).toBe('web');
});
