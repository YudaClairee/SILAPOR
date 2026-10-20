// @vitest-environment jsdom
// Reporter ticket detail page (Figma "Detail Tiket" 90-1706). The route reads
// its payload through the loader, so the tests mount the real route in a
// memory router with a stubbed fetch — that keeps the loader, the client-side
// fallback and the rendering contract under test together.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './reporter.reports.$ticket';

const BUILDING = '11111111-1111-4111-8111-111111111111';
const FLOOR = '22222222-2222-4222-8222-222222222222';
const ROOM = '33333333-3333-4333-8333-333333333333';
const ASSET = '44444444-4444-4444-8444-444444444444';
const CATEGORY = '55555555-5555-4555-8555-555555555555';
const ISSUE = '66666666-6666-4666-8666-666666666666';
const ATTACHMENT = '77777777-7777-4777-8777-777777777777';
const RELATED = '88888888-8888-4888-8888-888888888888';

const FORM_OPTIONS = {
  locations: [
    {
      id: BUILDING,
      code: 'A',
      name: 'Gedung A',
      type: 'BUILDING',
      parentId: null,
      buildingCode: 'A',
      floorNumber: null,
      usageTier: null,
      tierScore: null,
    },
    {
      id: FLOOR,
      code: 'A-3',
      name: 'Lantai 3',
      type: 'FLOOR',
      parentId: BUILDING,
      buildingCode: 'A',
      floorNumber: 3,
      usageTier: null,
      tierScore: null,
    },
    {
      id: ROOM,
      code: 'A-302',
      name: 'Ruang 302',
      type: 'ROOM',
      parentId: FLOOR,
      buildingCode: 'A',
      floorNumber: 3,
      usageTier: 'HIGH',
      tierScore: 90,
    },
  ],
  categories: [{ id: CATEGORY, code: 'ELEC', name: 'Elektronik', weight: 3 }],
  issueTypes: [{ id: ISSUE, code: 'BROKEN', name: 'Rusak Total', weight: 3 }],
  assets: [
    { id: ASSET, assetCode: 'PRJ-302', name: 'Proyektor Epson EB-X400', locationId: ROOM },
  ],
};

const DETAIL = {
  report: {
    ticketNumber: 'MNT-2026-000007',
    status: 'IN_REPAIR',
    locationId: ROOM,
    assetId: ASSET,
    submittedCategoryId: CATEGORY,
    submittedIssueTypeId: ISSUE,
    finalCategoryId: CATEGORY,
    finalIssueTypeId: ISSUE,
    finalPriority: 'HIGH',
    reporterCount: 3,
    description: 'Proyektor ruang 302 mati total sejak pagi.',
    occurredAt: null,
    reportedAt: '2026-10-12T01:30:00.000Z',
    verifiedAt: '2026-10-12T02:15:00.000Z',
    resolvedAt: null,
    closedAt: null,
  },
  isOwn: true,
  attachments: [
    {
      id: ATTACHMENT,
      originalFilename: 'proyektor.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    },
  ],
  events: [
    { eventType: 'REPORT_CREATED', createdAt: '2026-10-12T01:30:00.000Z', metadata: null },
    { eventType: 'ASSIGNMENT_CHANGED', createdAt: '2026-10-12T03:00:00.000Z', metadata: null },
    {
      eventType: 'STATUS_CHANGED',
      createdAt: '2026-10-12T04:00:00.000Z',
      toValue: 'IN_REPAIR',
      metadata: null,
    },
    {
      eventType: 'PROGRESS_NOTE_ADDED',
      createdAt: '2026-10-12T05:00:00.000Z',
      metadata: { note: 'Lampu proyektor sedang diganti teknisi.' },
    },
  ],
  duplicateCandidates: [],
  classificationConfidence: 0.94,
  relatedReports: [
    {
      id: RELATED,
      ticketNumber: 'MNT-2026-000008',
      description: 'Proyektor ruang sebelah juga mati.',
      status: 'VERIFIED',
      relationType: 'SUPPORTING',
      reportedAt: '2026-10-12T02:10:00.000Z',
    },
  ],
};

function stubFetch(overrides?: { detailStatus?: number; detailBody?: unknown }) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/reports/form-options')) {
      return { status: 200, ok: true, json: async () => FORM_OPTIONS } as Response;
    }
    if (url.startsWith('/api/reports/')) {
      const status = overrides?.detailStatus ?? 200;
      return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => overrides?.detailBody ?? DETAIL,
      } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(ticket = 'MNT-2026-000007') {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/reporter/reports/$ticket',
    path: '/reporter/reports/$ticket',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: [`/reporter/reports/${ticket}`] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('detail tiket pelapor', () => {
  it('renders the ticket header, status, priority, and report time', async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByRole('heading', { name: '#MNT-2026-000007' })).toBeInTheDocument();
    // The status also chips the timeline and the facts table.
    expect(screen.getAllByText('Dalam perbaikan').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Prioritas Tinggi/)).toBeInTheDocument();
    expect(screen.getAllByText('12 Okt 2026, 08:30 WIB').length).toBeGreaterThanOrEqual(1);
  });

  it('points the breadcrumb and back link at the V2 monitoring page', async () => {
    stubFetch();
    renderPage();
    const back = await screen.findByRole('link', { name: /Kembali ke Pemantauan Tiket/ });
    // /reporter is the V2 "Pemantauan Tiket" page; /reporter/reports is the
    // legacy "Tiket Kampus" list and must not be the back target.
    expect(back.getAttribute('href')?.startsWith('/reporter')).toBe(true);
    expect(back.getAttribute('href')).not.toContain('/reporter/reports');
    const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const crumb = within(breadcrumb).getByRole('link', { name: 'Pemantauan Tiket' });
    expect(crumb.getAttribute('href')?.startsWith('/reporter')).toBe(true);
    expect(crumb.getAttribute('href')).not.toContain('/reporter/reports');
  });

  it('drives the stepper from the report status and events', async () => {
    stubFetch();
    renderPage();
    const rail = await screen.findByRole('list', { name: 'Alur status penanganan' });
    expect(within(rail).getAllByRole('listitem')).toHaveLength(7);
    expect(rail.querySelector('[aria-current="step"]')).toHaveTextContent('IN_REPAIR');
    expect(screen.getByText('Tahap 5 dari 7 · Perbaikan Sedang Berlangsung')).toBeInTheDocument();
  });

  it('renders the location hierarchy, asset, classification, and confidence', async () => {
    stubFetch();
    renderPage();
    await screen.findByRole('heading', { name: 'Lokasi dan Aset' });
    expect(screen.getByText('Proyektor Epson EB-X400')).toBeInTheDocument();
    expect(screen.getByText('Gedung A')).toBeInTheDocument();
    expect(screen.getByText('Lantai 3')).toBeInTheDocument();
    expect(screen.getByText('Ruang 302')).toBeInTheDocument();
    expect(screen.getByText('Elektronik')).toBeInTheDocument();
    expect(screen.getByText('Rusak Total')).toBeInTheDocument();
    expect(screen.getByText('94% (Tinggi)')).toBeInTheDocument();
  });

  it('lists supporting reports as links and keeps reporter identity hidden', async () => {
    stubFetch();
    renderPage();
    await screen.findByRole('heading', { name: 'Deskripsi Laporan & Dukungan Pelapor' });
    expect(screen.getByText('1 laporan mendukung tiket ini')).toBeInTheDocument();
    expect(screen.getByText('“Proyektor ruang sebelah juga mati.”')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'MNT-2026-000008' })).toHaveAttribute(
      'href',
      '/reporter/reports/MNT-2026-000008',
    );
    expect(screen.getByText('3 pelapor terdampak')).toBeInTheDocument();
    expect(screen.getByText(/Identitas pelapor lain dirahasiakan/)).toBeInTheDocument();
  });

  it('renders the evidence photo and the newest-first timeline', async () => {
    stubFetch();
    renderPage();
    const photo = await screen.findByAltText('proyektor.jpg');
    expect(photo.getAttribute('src')).toContain(
      `/api/reports/MNT-2026-000007/attachments/${ATTACHMENT}`,
    );
    expect(screen.getByText('1–1 dari 1 foto ditampilkan')).toBeInTheDocument();

    const timeline = screen.getByRole('region', { name: 'Linimasa Penanganan' });
    const rows = within(timeline).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Lampu proyektor sedang diganti teknisi.');
    expect(rows[0]).toHaveTextContent('Catatan Admin/UMPER');
    expect(rows[3]).toHaveTextContent('Sistem SCMS');
  });

  it('shows the not-found state for a missing ticket', async () => {
    stubFetch({ detailStatus: 404, detailBody: { error: { code: 'NOT_FOUND' } } });
    renderPage('MNT-2026-999999');
    expect(await screen.findByText('Laporan tidak ditemukan')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Alur status penanganan' })).not.toBeInTheDocument();
  });

  it('hides another reporter’s photos behind the privacy note', async () => {
    stubFetch({ detailBody: { ...DETAIL, isOwn: false, attachments: [] } });
    renderPage();
    await screen.findByRole('heading', { name: 'Foto Bukti Kerusakan' });
    expect(
      screen.getByText('Lampiran hanya dapat dilihat oleh pelapor tiket ini.'),
    ).toBeInTheDocument();
    expect(screen.queryByAltText('proyektor.jpg')).not.toBeInTheDocument();
  });
});
