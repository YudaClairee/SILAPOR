// Phase 3 P3-7 E2E release-gate proof: "reporter submit → memperoleh ticket
// → admin melihat ticket yang sama." All real browser, no mocks, no worker.
//
// Conventions (per P3-5/P3-6 reports): SSR loaders degrade to post-hydration
// client fetch, so every navigation waits on hydrated content via web-first
// assertions (expect(locator)…) — never sleeps. Bare /reporter/reports and
// /admin/reports 307-redirect to defaults queries; Playwright follows them.
// Descriptions carry a timestamp/random suffix so reruns never collide with
// prior tickets (dev DB already holds MNT-2026-000001/000002, counter seq 2+).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const TICKET_PATTERN = /MNT-\d{4}-\d{6}/;

function uniqueDescription(tag: string): string {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `E2E P3-7 ${tag} ${suffix} lampu mati dan AC rusak, mohon perbaikan segera`;
}

async function loginContext(browser: Browser, username: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const response = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { username },
  });
  expect(response.ok(), `login as ${username} succeeds`).toBe(true);
  return context;
}

// Fill the new-report cascade picking the first real option at each level
// (building → room → category → issue type), asset left at the default
// "Tanpa asset" option. Each select asserts its options loaded first.
async function fillReportForm(page: Page, description: string): Promise<void> {
  await page.goto('/reporter/reports/new');
  await expect(page.getByRole('heading', { name: 'Buat Laporan Baru' })).toBeVisible();

  const building = page.getByLabel('Gedung', { exact: true });
  await expect(building.locator('option').nth(1)).toBeAttached();
  await building.selectOption({ index: 1 });

  const room = page.getByLabel('Ruangan', { exact: true });
  await expect(room.locator('option').nth(1)).toBeAttached();
  await room.selectOption({ index: 1 });

  const category = page.getByLabel('Kategori', { exact: true });
  await expect(category.locator('option').nth(1)).toBeAttached();
  await category.selectOption({ index: 1 });

  const issueType = page.getByLabel('Jenis masalah', { exact: true });
  await expect(issueType.locator('option').nth(1)).toBeAttached();
  await issueType.selectOption({ index: 1 });

  await page.getByLabel('Deskripsi', { exact: true }).fill(description);
}

// Advance form → review, submit with whichever button the duplicate check
// resolves to ("Kirim laporan" when clean, "Tetap kirim — masalah berbeda"
// when candidates exist), and return the ticket from the success status.
async function submitFromReview(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Lanjut ke review' }).click();
  await expect(page.getByRole('heading', { name: 'Tinjau Laporan' })).toBeVisible();
  const submit = page.getByRole('button', { name: /Kirim laporan|Tetap kirim/ });
  await expect(submit).toBeVisible();
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Laporan berhasil dikirim' })).toBeVisible();
  const status = page.getByRole('status');
  await expect(status).toContainText(TICKET_PATTERN);
  const text = (await status.textContent()) ?? '';
  const match = text.match(TICKET_PATTERN);
  expect(match, 'success status carries a ticket number').not.toBeNull();
  if (match === null) {
    throw new Error('ticket number missing from success status');
  }
  return match[0];
}

// Shared gate state: ticketA/descriptionA created by scenario 1, ticketB by
// scenario 6. Tests in one file run serially in declaration order.
let ticketA = '';
let descriptionA = '';
let ticketB = '';

test('1 gate: reporter submits a report and receives a ticket', async ({ browser }) => {
  const context = await loginContext(browser, '230001');
  const page = await context.newPage();
  try {
    descriptionA = uniqueDescription('gate');
    await fillReportForm(page, descriptionA);
    ticketA = await submitFromReview(page);
    expect(ticketA).toMatch(TICKET_PATTERN);

    await page.getByRole('link', { name: 'Lihat detail laporan' }).click();
    await expect(page.getByRole('heading', { name: 'Detail Laporan' })).toBeVisible();
    await expect(page.getByText(ticketA).first()).toBeVisible();
    await expect(page.getByText(descriptionA)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('2 list/detail: reporter sees the ticket in the list with REPORTED status', async ({
  browser,
}) => {
  const context = await loginContext(browser, '230001');
  const page = await context.newPage();
  try {
    await page.goto('/reporter/reports');
    await expect(page.getByRole('heading', { name: 'Laporan Saya' })).toBeVisible();
    const rowLink = page.getByRole('link', { name: ticketA });
    await expect(rowLink).toBeVisible();
    await rowLink.click();

    await expect(page.getByRole('heading', { name: 'Detail Laporan' })).toBeVisible();
    await expect(page.getByText(descriptionA)).toBeVisible();
    // REPORTED renders as "Dilaporkan" (P3-5 copy); scoped to the definition
    // list so the list-page status <select> options cannot collide.
    await expect(page.locator('dd', { hasText: 'Dilaporkan' })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('3 ownership: reporter-B sees 404 for reporter-A ticket (UI + byte-identical API 404)', async ({
  browser,
}) => {
  // Fresh isolated context (separate cookie jar) is MANDATORY here.
  const context = await loginContext(browser, '230002');
  const page = await context.newPage();
  try {
    await page.goto(`/reporter/reports/${ticketA}`);
    await expect(page.getByRole('heading', { name: 'Detail Laporan' })).toBeVisible();
    await expect(page.getByText('Laporan tidak ditemukan')).toBeVisible();
    await expect(page.getByText(descriptionA)).toHaveCount(0);

    const foreign = await context.request.get(`${BASE_URL}/api/reports/${ticketA}`);
    expect(foreign.status()).toBe(404);
    const missing = await context.request.get(`${BASE_URL}/api/reports/MNT-2099-999999`);
    expect(missing.status()).toBe(404);
    // Missing vs foreign 404 bodies are byte-identical (server never 403s).
    expect(await foreign.body()).toEqual(await missing.body());
  } finally {
    await context.close();
  }
});

test('4 admin sees the same ticket and description', async ({ browser }) => {
  const context = await loginContext(browser, 'admin');
  const page = await context.newPage();
  try {
    await page.goto('/admin/reports');
    await expect(page.getByRole('heading', { name: 'Semua Laporan' })).toBeVisible();
    const rowLink = page.getByRole('link', { name: ticketA });
    await expect(rowLink).toBeVisible();
    await rowLink.click();

    await expect(page.getByRole('heading', { name: 'Detail Laporan' })).toBeVisible();
    await expect(page.getByText(ticketA).first()).toBeVisible();
    await expect(page.getByText(descriptionA)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('5 reporter blocked from admin API with 403', async ({ browser }) => {
  const context = await loginContext(browser, '230001');
  try {
    const response = await context.request.get(`${BASE_URL}/api/admin/reports`);
    expect(response.status()).toBe(403);
    const body = (await response.json()) as { error?: { code?: unknown } };
    expect(body.error?.code).toBe('FORBIDDEN');
  } finally {
    await context.close();
  }
});

test('6 double-submit guard: two fast submits create exactly one ticket', async ({
  browser,
}) => {
  const context = await loginContext(browser, '230001');
  const page = await context.newPage();
  try {
    const description = uniqueDescription('double-submit');
    await fillReportForm(page, description);
    await page.getByRole('button', { name: 'Lanjut ke review' }).click();
    await expect(page.getByRole('heading', { name: 'Tinjau Laporan' })).toBeVisible();
    const submit = page.getByRole('button', { name: /Kirim laporan|Tetap kirim/ });
    await expect(submit).toBeVisible();

    // Same form instance = same idempotency key; count the POSTs. Request
    // events fire synchronously, so the count is final once success renders.
    let postCount = 0;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/reports')) {
        postCount += 1;
      }
    });
    await submit.dblclick();
    await expect(page.getByRole('heading', { name: 'Laporan berhasil dikirim' })).toBeVisible();
    expect(postCount, 'double-click sends exactly one POST').toBe(1);

    const status = page.getByRole('status');
    await expect(status).toContainText(TICKET_PATTERN);
    const match = ((await status.textContent()) ?? '').match(TICKET_PATTERN);
    expect(match).not.toBeNull();
    if (match === null) {
      throw new Error('ticket number missing from success status');
    }
    ticketB = match[0];

    // Exactly one new row for the ticket in the reporter's list.
    await page.goto('/reporter/reports');
    await expect(page.getByRole('heading', { name: 'Laporan Saya' })).toBeVisible();
    await expect(page.getByRole('link', { name: ticketB })).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test('7 duplicate warning: same combo warns with first ticket ref, then creates a second ticket', async ({
  browser,
}) => {
  const context = await loginContext(browser, '230001');
  const page = await context.newPage();
  try {
    // Same facility/category/issue combo as scenario 6 (identical first-option
    // cascade), new unique description — never blocked, only warned.
    await fillReportForm(page, uniqueDescription('duplicate-warning'));
    await page.getByRole('button', { name: 'Lanjut ke review' }).click();
    await expect(page.getByRole('heading', { name: 'Tinjau Laporan' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Laporan serupa ditemukan' })).toBeVisible();
    await expect(page.getByRole('link', { name: ticketB })).toBeVisible();

    await page.getByRole('button', { name: 'Tetap kirim — masalah berbeda' }).click();
    await expect(page.getByRole('heading', { name: 'Laporan berhasil dikirim' })).toBeVisible();
    const status = page.getByRole('status');
    await expect(status).toContainText(TICKET_PATTERN);
    const match = ((await status.textContent()) ?? '').match(TICKET_PATTERN);
    expect(match).not.toBeNull();
    if (match === null) {
      throw new Error('ticket number missing from success status');
    }
    expect(match[0], 'second submit mints a distinct ticket').not.toBe(ticketB);
  } finally {
    await context.close();
  }
});

test('8 worker offline: release gate holds with no worker process', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    service?: unknown;
    checks?: { worker?: { ok?: unknown } };
  };
  expect(body.service).toBe('web');
  // No worker was started by the config or this suite; the flow above proves
  // submit → ticket → admin visibility works without one.
  expect(body.checks?.worker?.ok).toBe(false);
});
