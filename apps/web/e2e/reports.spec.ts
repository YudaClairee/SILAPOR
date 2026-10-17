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

// Minimal 1x1 PNG shared by every report submission (the current form
// requires 1–3 photos). Test 9 replaces it with its named fixture.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface E2eLocation {
  readonly id: string;
  readonly type: string;
  readonly parentId: string | null;
}

interface E2eFormOptions {
  readonly locations: E2eLocation[];
  readonly assets: ReadonlyArray<{ readonly id: string; readonly locationId: string | null }>;
}

// Fill the current cascade using a real asset from the seeded form options
// (building → optional floor → room → asset), then description + one photo.
// Picking the asset first keeps the test independent of rooms without assets.
async function fillReportForm(page: Page, description: string, assetIndex = 0): Promise<void> {
  await page.goto('/reporter/reports/new');
  await expect(page.getByRole('heading', { name: 'Buat Laporan Baru' })).toBeVisible();

  const optionsResponse = await page.request.get(`${BASE_URL}/api/reports/form-options`);
  expect(optionsResponse.ok()).toBe(true);
  const options = (await optionsResponse.json()) as E2eFormOptions;
  const assets = options.assets.filter(
    (asset): asset is { readonly id: string; readonly locationId: string } =>
      asset.locationId !== null,
  );
  const asset = assets[assetIndex];
  if (asset === undefined) {
    throw new Error(`E2E: no seeded asset at index ${assetIndex}`);
  }
  const room = options.locations.find((location) => location.id === asset.locationId);
  if (room === undefined) {
    throw new Error('E2E: asset room missing from form options');
  }
  const parent = options.locations.find((location) => location.id === room.parentId);
  const floor = parent?.type === 'FLOOR' ? parent : undefined;
  const building =
    floor === undefined
      ? parent
      : options.locations.find((location) => location.id === floor.parentId);
  if (building === undefined) {
    throw new Error('E2E: asset building missing from form options');
  }

  const buildingSelect = page.getByLabel('Gedung', { exact: true });
  await expect(buildingSelect.locator(`option[value="${building.id}"]`)).toBeAttached();
  await buildingSelect.selectOption(building.id);
  if (floor !== undefined) {
    const floorSelect = page.getByLabel('Lantai', { exact: true });
    await expect(floorSelect.locator(`option[value="${floor.id}"]`)).toBeAttached();
    await floorSelect.selectOption(floor.id);
  }
  const roomSelect = page.getByLabel('Ruangan', { exact: true });
  await expect(roomSelect.locator(`option[value="${room.id}"]`)).toBeAttached();
  await roomSelect.selectOption(room.id);
  const assetSelect = page.getByLabel('Aset', { exact: true });
  await expect(assetSelect.locator(`option[value="${asset.id}"]`)).toBeAttached();
  await assetSelect.selectOption(asset.id);

  await page.getByLabel('Deskripsi', { exact: true }).fill(description);
  await page
    .getByLabel('Foto', { exact: true })
    .setInputFiles([{ name: 'bukti.png', mimeType: 'image/png', buffer: PNG }]);
}

// Advance form → review → submit and return the ticket from the success status.
async function submitFromReview(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Lanjut ke review' }).click();
  await expect(page.getByRole('heading', { name: 'Tinjau Laporan' })).toBeVisible();
  const submit = page.getByRole('button', { name: 'Kirim laporan', exact: true });
  await expect(submit).toBeVisible();
  await submit.click();
  await expect(
    page.getByRole('heading', { name: /Laporan berhasil dikirim|Laporan menunggu pemeriksaan/ }),
  ).toBeVisible();
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
    await expect(page.getByRole('heading', { name: 'Tiket Kampus' })).toBeVisible();
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

test('3 campus visibility: reporter-B opens reporter-A ticket in sanitized form', async ({
  browser,
}) => {
  // Fresh isolated context (separate cookie jar) is MANDATORY here.
  const context = await loginContext(browser, '230002');
  const page = await context.newPage();
  try {
    await page.goto(`/reporter/reports/${ticketA}`);
    await expect(page.getByRole('heading', { name: 'Detail Laporan' })).toBeVisible();
    await expect(page.getByText(descriptionA)).toBeVisible();
    await expect(page.getByText('Lampiran hanya dapat dilihat oleh pelapor tiket ini.')).toBeVisible();
    await expect(page.getByText('Laporan tidak ditemukan')).toHaveCount(0);

    const foreign = await context.request.get(`${BASE_URL}/api/reports/${ticketA}`);
    expect(foreign.status()).toBe(200);
    const body = (await foreign.json()) as {
      isOwn?: unknown;
      attachments?: unknown;
      report?: Record<string, unknown>;
    };
    expect(body.isOwn).toBe(false);
    expect(body.attachments).toEqual([]);
    expect(body.report).not.toHaveProperty('reporterId');
    expect(body.report).not.toHaveProperty('idempotencyKey');

    const missing = await context.request.get(`${BASE_URL}/api/reports/MNT-2099-999999`);
    expect(missing.status()).toBe(404);

    // The campus list shows another reporter's ticket; the Laporan Saya
    // filter removes it for reporter-B.
    await page.goto('/reporter/reports');
    await expect(page.getByRole('link', { name: ticketA })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Filter status' })
      .getByRole('link', { name: 'Laporan Saya' })
      .click();
    await expect(page.getByRole('link', { name: ticketA })).toHaveCount(0);
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
    // Use the second asset so the active first-asset ticket from scenario 1
    // cannot block this idempotency test.
    await fillReportForm(page, description, 1);
    await page.getByRole('button', { name: 'Lanjut ke review' }).click();
    await expect(page.getByRole('heading', { name: 'Tinjau Laporan' })).toBeVisible();
    const submit = page.getByRole('button', { name: 'Kirim laporan', exact: true });
    await expect(submit).toBeVisible();

    // Same form instance = same idempotency key; count the POSTs and capture
    // the key + body. Request events fire synchronously, so the count is
    // final once success renders.
    let postCount = 0;
    let capturedKey: string | null = null;
    let capturedBody: string | null = null;
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/reports')) {
        postCount += 1;
        capturedKey = request.headers()['x-idempotency-key'] ?? null;
        capturedBody = request.postData();
      }
    });
    await submit.dblclick();
    await expect(
      page.getByRole('heading', { name: /Laporan berhasil dikirim|Laporan menunggu pemeriksaan/ }),
    ).toBeVisible();
    expect(postCount, 'double-click sends exactly one POST').toBe(1);

    const status = page.getByRole('status');
    await expect(status).toContainText(TICKET_PATTERN);
    const match = ((await status.textContent()) ?? '').match(TICKET_PATTERN);
    expect(match).not.toBeNull();
    if (match === null) {
      throw new Error('ticket number missing from success status');
    }
    ticketB = match[0];

    // Server-replay half: re-POST the SAME payload with the SAME form-instance
    // key (captured off the wire above). Both responses must carry the same
    // ticket number; the key-replay path is exercised deterministically,
    // without racing the browser.
    if (capturedKey === null || capturedBody === null) {
      throw new Error('idempotency key/body not captured from the form POST');
    }
    const replay = await context.request.post(`${BASE_URL}/api/reports`, {
      headers: { 'x-idempotency-key': capturedKey },
      data: JSON.parse(capturedBody) as Record<string, unknown>,
    });
    expect(replay.ok(), 'replay with the same idempotency key succeeds').toBe(true);
    const replayBody = (await replay.json()) as {
      report?: { ticketNumber?: unknown };
      idempotentReplay?: unknown;
    };
    expect(replayBody.report?.ticketNumber, 'replay returns the same ticket').toBe(ticketB);
    expect(replayBody.idempotentReplay, 'replay is flagged as idempotent').toBe(true);

    // Exactly one new row for the ticket in the reporter's campus list.
    await page.goto('/reporter/reports');
    await expect(page.getByRole('heading', { name: 'Tiket Kampus' })).toBeVisible();
    await expect(page.getByRole('link', { name: ticketB })).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test('7 duplicate block: same reporter + active asset is blocked with the existing ticket ref', async ({
  browser,
}) => {
  const context = await loginContext(browser, '230001');
  const page = await context.newPage();
  try {
    // Same first asset as scenario 1; the server must block before AI.
    await fillReportForm(page, uniqueDescription('duplicate-block'));
    await page.getByRole('button', { name: 'Lanjut ke review' }).click();
    await expect(page.getByRole('heading', { name: 'Tinjau Laporan' })).toBeVisible();
    await page.getByRole('button', { name: 'Kirim laporan', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Laporan serupa sudah tercatat' })).toBeVisible();
    await expect(page.getByRole('link', { name: ticketA })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Laporan berhasil dikirim|Laporan menunggu pemeriksaan/ }),
    ).toHaveCount(0);
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

// Phase 4 P4-4 upload gate: valid PNG upload via the new-report file input is
// stored (success shows the count), the reporter detail renders it as a
// thumbnail through the authorized GET endpoint, and a revoked attachment id
// degrades to the first-class broken-image placeholder (never raw errors).
//
// P4-4 env note: ran GREEN in the P4-4 release run (full e2e dir 10/10
// incl. this scenario 9); needs the dev stack (`docker compose up -d`,
// seeded DB, `pnpm dev` :3000) plus chromium system libs
// (`LD_LIBRARY_PATH=/tmp/p37libs/...` per the P3-7 report §env).
test('9 attachments: reporter uploads a photo, sees the thumbnail, broken image shows placeholder', async ({
  browser,
}) => {
  // Minimal 1x1 PNG (decodable by the server sharp pipeline, verified
  // offline): avoids shipping a binary fixture for the upload input.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const context = await loginContext(browser, '230001');
  const page = await context.newPage();
  try {
    // Use a third asset so the active tickets from earlier scenarios do not
    // trigger the same-reporter duplicate block.
    await fillReportForm(page, uniqueDescription('upload-gate'), 2);
    await page
      .getByLabel('Foto', { exact: true })
      .setInputFiles([{ name: 'lampu-rusak.png', mimeType: 'image/png', buffer: png }]);
    await expect(page.getByText('lampu-rusak.png')).toBeVisible();

    const ticket = await submitFromReview(page);
    await expect(page.getByText('1 foto terlampir.')).toBeVisible();

    await page.getByRole('link', { name: 'Lihat detail laporan' }).click();
    await expect(page.getByRole('heading', { name: 'Detail Laporan' })).toBeVisible();
    const thumb = page.getByRole('img', { name: 'lampu-rusak.png' });
    await expect(thumb).toBeVisible();
    expect(await thumb.getAttribute('src')).toContain(`/api/reports/${ticket}/attachments/`);

    // Revoke every attachment byte response (simulates a deleted/revoked
    // object id): the thumbnail must degrade to the placeholder state.
    await page.route('**/attachments/*', (route) =>
      route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{"error":{"code":"NOT_FOUND","message":"Attachment not found"}}',
      }),
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Detail Laporan' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Gambar tidak dapat dimuat' })).toBeVisible();
    await expect(page.getByText('Gambar tidak dapat dimuat')).toBeVisible();
  } finally {
    await context.close();
  }
});
