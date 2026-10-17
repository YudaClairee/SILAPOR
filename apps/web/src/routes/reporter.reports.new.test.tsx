// @vitest-environment jsdom
// Reporter form contract for the AI verification flow.
//
// The plan sketch renders `<NewReportPage/>` directly, but the page reads
// its options through the route loader and router hooks, so the render
// tests mount the real route inside a memory router with stubbed fetch
// instead. The submit button keeps its Indonesian copy, so the disabled
// assertion matches /kirim laporan/i rather than the sketch /submit/i.
// Pure helper tests below pin the validation, cascade, and verdict units.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assetsForRoom,
  floorsForBuilding,
  isNewReportSubmittable,
  roomsForParent,
  toSubmitOutcome,
  validateNewReportForm,
  type NewReportValues,
  Route,
} from './reporter.reports.new';

const BUILDING = '11111111-1111-4111-8111-111111111111';
const FLAT_BUILDING = '22222222-2222-4222-8222-222222222222';
const FLOOR_1 = '33333333-3333-4333-8333-333333333333';
const ROOM_101 = '44444444-4444-4444-8444-444444444444';
const ROOM_LOBBY = '55555555-5555-4555-8555-555555555555';
const ASSET_AC = '66666666-6666-4666-8666-666666666666';

const LOCATIONS = [
  { id: BUILDING, code: 'G-A', name: 'Gedung A', type: 'BUILDING', parentId: null },
  { id: FLAT_BUILDING, code: 'G-B', name: 'Gedung B', type: 'BUILDING', parentId: null },
  { id: FLOOR_1, code: 'G-A-1', name: 'Lantai 1', type: 'FLOOR', parentId: BUILDING },
  { id: ROOM_101, code: 'R-101', name: 'Ruang 101', type: 'ROOM', parentId: FLOOR_1 },
  { id: ROOM_LOBBY, code: 'R-LOB', name: 'Ruang lobi', type: 'ROOM', parentId: FLAT_BUILDING },
] as const;

const ASSETS = [
  { id: ASSET_AC, assetCode: 'AC-04', name: 'AC ruang 101', locationId: ROOM_101 },
] as const;

function photo(name = 'retak.jpg', type = 'image/jpeg', size = 10_000) {
  return { size, type, name };
}

const VALID_VALUES: NewReportValues = {
  buildingId: BUILDING,
  floorId: FLOOR_1,
  locationId: ROOM_101,
  assetId: ASSET_AC,
  description: 'Dinding ruang retak memanjang dan rembes saat hujan.',
};

describe('new-flow submit gate', () => {
  it('gates submit on the full chain, description, and photos', () => {
    expect(isNewReportSubmittable(VALID_VALUES, [], true)).toBe(false);
    expect(isNewReportSubmittable({ ...VALID_VALUES, buildingId: '' }, [photo()], true)).toBe(
      false,
    );
    expect(isNewReportSubmittable({ ...VALID_VALUES, floorId: '' }, [photo()], true)).toBe(false);
    expect(isNewReportSubmittable({ ...VALID_VALUES, locationId: '' }, [photo()], true)).toBe(
      false,
    );
    expect(isNewReportSubmittable({ ...VALID_VALUES, assetId: '' }, [photo()], true)).toBe(false);
    expect(isNewReportSubmittable({ ...VALID_VALUES, description: 'pendek' }, [photo()], true)).toBe(
      false,
    );
    expect(isNewReportSubmittable(VALID_VALUES, [photo()], true)).toBe(true);
  });

  it('requires lantai only when the building has floors', () => {
    const flat: NewReportValues = {
      buildingId: FLAT_BUILDING,
      floorId: '',
      locationId: ROOM_LOBBY,
      assetId: ASSET_AC,
      description: 'Lampu lobi mati total sejak pagi.',
    };
    expect(validateNewReportForm(flat, [photo()], false)).toEqual({});
    expect(validateNewReportForm(flat, [photo()], true).floorId).toBe('Pilih lantai terlebih dahulu.');
  });

  it('rejects short, long, and non-uuid input with Indonesian messages', () => {
    expect(validateNewReportForm(VALID_VALUES, [], true).photos).toBe('Tambahkan minimal 1 foto.');
    expect(validateNewReportForm(VALID_VALUES, [photo(), photo('b.jpg'), photo('c.jpg'), photo('d.jpg')], true).photos).toBe(
      'Maksimal 3 foto per laporan.',
    );
    expect(validateNewReportForm(VALID_VALUES, [photo('x.svg', 'image/svg+xml')], true).photos).toBe(
      'Format "x.svg" tidak didukung. Gunakan JPG, PNG, atau WebP.',
    );
    expect(validateNewReportForm(VALID_VALUES, [photo('big.png', 'image/png', 6_000_000)], true).photos).toBe(
      'Ukuran "big.png" melebihi 5 MB.',
    );
    expect(validateNewReportForm({ ...VALID_VALUES, description: '  pendek  ' }, [photo()], true).description).toBe(
      'Deskripsi minimal 10 karakter.',
    );
    expect(validateNewReportForm({ ...VALID_VALUES, locationId: 'bukan-uuid' }, [photo()], true).locationId).toBe(
      'Ruangan tidak valid.',
    );
    expect(validateNewReportForm({ ...VALID_VALUES, assetId: 'bukan-uuid' }, [photo()], true).assetId).toBe(
      'Aset tidak valid.',
    );
  });
});

describe('location and asset cascade', () => {
  it('lists floors per building and rooms per parent', () => {
    expect(floorsForBuilding(LOCATIONS, BUILDING).map((floor) => floor.id)).toEqual([FLOOR_1]);
    expect(floorsForBuilding(LOCATIONS, FLAT_BUILDING)).toEqual([]);
    expect(roomsForParent(LOCATIONS, FLOOR_1).map((room) => room.id)).toEqual([ROOM_101]);
    expect(roomsForParent(LOCATIONS, FLAT_BUILDING).map((room) => room.id)).toEqual([ROOM_LOBBY]);
    expect(roomsForParent(LOCATIONS, 'tidak-ada')).toEqual([]);
  });

  it('lists assets for the chosen room only', () => {
    expect(assetsForRoom(ASSETS, ROOM_101).map((asset) => asset.id)).toEqual([ASSET_AC]);
    expect(assetsForRoom(ASSETS, ROOM_LOBBY)).toEqual([]);
  });
});

describe('submit verdict mapping', () => {
  it('maps 201, 202, 422, and 409 to their screens', () => {
    expect(toSubmitOutcome(201, { ticketNumber: 'MNT-1' })).toEqual({
      kind: 'verified',
      ticketNumber: 'MNT-1',
      replay: false,
    });
    expect(toSubmitOutcome(200, { ticketNumber: 'MNT-1', idempotentReplay: true })).toEqual({
      kind: 'verified',
      ticketNumber: 'MNT-1',
      replay: true,
    });
    expect(toSubmitOutcome(202, { ticketNumber: 'MNT-2', message: 'Menunggu.' })).toEqual({
      kind: 'held',
      ticketNumber: 'MNT-2',
      message: 'Menunggu.',
    });
    expect(toSubmitOutcome(422, { reason: 'Foto kurang jelas.' })).toEqual({
      kind: 'failed',
      reason: 'Foto kurang jelas.',
    });
    expect(
      toSubmitOutcome(409, { error: { message: 'Duplikat.' }, ticketNumber: 'MNT-9' }),
    ).toEqual({ kind: 'duplicate', ticketNumber: 'MNT-9', message: 'Duplikat.' });
    expect(toSubmitOutcome(500, null).kind).toBe('error');
    expect(toSubmitOutcome(201, null).kind).toBe('error');
  });
});

describe('reporter form render', () => {
  const FORM_OPTIONS = {
    locations: [
      { id: BUILDING, code: 'G-A', name: 'Gedung A', type: 'BUILDING', parentId: null, buildingCode: null },
      { id: FLOOR_1, code: 'G-A-1', name: 'Lantai 1', type: 'FLOOR', parentId: BUILDING, buildingCode: 'G-A' },
      { id: ROOM_101, code: 'R-101', name: 'Ruang 101', type: 'ROOM', parentId: FLOOR_1, buildingCode: 'G-A' },
    ],
    assets: [{ id: ASSET_AC, assetCode: 'AC-04', name: 'AC ruang 101', locationId: ROOM_101 }],
  };

  const rootRoute = createRootRoute();
  function stubFetch(overrides?: { reportsStatus?: number; reportsBody?: unknown }) {
    const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/reports/form-options')) {
        void init;
        return { status: 200, ok: true, json: async () => FORM_OPTIONS } as Response;
      }
      if (url.includes('/api/uploads')) {
        return { status: 201, ok: true, json: async () => ({ keys: ['staging_testkey'] }) } as Response;
      }
      if (url === '/api/reports') {
        const status = overrides?.reportsStatus ?? 201;
        const body = overrides?.reportsBody ?? { ticketNumber: 'MNT-2026-000007' };
        return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function renderPage() {
    const testRoute = Route.update({
      id: '/reporter/reports/new',
      path: '/reporter/reports/new',
      getParentRoute: () => rootRoute,
    } as never);
    const routeTree = rootRoute.addChildren([testRoute]);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/reporter/reports/new'] }),
    });
    render(<RouterProvider router={router} />);
  }

  function fillChain() {
    fireEvent.change(screen.getByLabelText('Gedung'), { target: { value: BUILDING } });
    fireEvent.change(screen.getByLabelText('Lantai'), { target: { value: FLOOR_1 } });
    fireEvent.change(screen.getByLabelText('Ruangan'), { target: { value: ROOM_101 } });
    fireEvent.change(screen.getByLabelText('Aset'), { target: { value: ASSET_AC } });
    fireEvent.change(screen.getByLabelText('Deskripsi'), {
      target: { value: 'Dinding ruang retak memanjang dan rembes saat hujan deras.' },
    });
  }

  function attachPhoto() {
    const file = new File([new Uint8Array([1, 2, 3])], 'retak.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByLabelText('Foto'), { target: { files: [file] } });
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('disables submit with no photo and requires the full asset chain', async () => {
    stubFetch();
    renderPage();
    const submit = await screen.findByRole('button', { name: /lanjut ke review/i });
    expect(submit).toBeDisabled();
    expect(screen.queryByLabelText(/kategori/i)).not.toBeInTheDocument();
    for (const label of ['Gedung', 'Lantai', 'Ruangan', 'Aset', 'Deskripsi', 'Foto']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('keeps submit disabled until the chain and a photo are complete', async () => {
    stubFetch();
    renderPage();
    await screen.findByRole('button', { name: /lanjut ke review/i });
    fillChain();
    expect(screen.getByRole('button', { name: /lanjut ke review/i })).toBeDisabled();
    attachPhoto();
    expect(screen.getByRole('button', { name: /lanjut ke review/i })).toBeEnabled();
  });

  it('stages photos first and shows the verified ticket', async () => {
    const fetchMock = stubFetch();
    renderPage();
    await screen.findByRole('button', { name: /lanjut ke review/i });
    fillChain();
    attachPhoto();
    fireEvent.click(screen.getByRole('button', { name: /lanjut ke review/i }));
    expect(await screen.findByRole('heading', { name: 'Tinjau Laporan' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /kirim laporan/i }));
    expect(await screen.findByText('MNT-2026-000007')).toBeInTheDocument();
    const submits = fetchMock.mock.calls.filter(([url]) => url === '/api/reports');
    expect(submits).toHaveLength(1);
    const body = JSON.parse(String(submits[0]?.[1]?.body)) as unknown as {
      photoKeys: unknown;
    };
    expect(body.photoKeys).toEqual(['staging_testkey']);
  });

  it('shows the fail reason with a fresh-report retry', async () => {
    stubFetch({ reportsStatus: 422, reportsBody: { reason: 'Foto kurang jelas.' } });
    renderPage();
    await screen.findByRole('button', { name: /lanjut ke review/i });
    fillChain();
    attachPhoto();
    fireEvent.click(screen.getByRole('button', { name: /lanjut ke review/i }));
    fireEvent.click(await screen.findByRole('button', { name: /kirim laporan/i }));
    expect(await screen.findByText('Foto kurang jelas.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /buat laporan baru/i }));
    expect(await screen.findByLabelText('Gedung')).toBeInTheDocument();
  });

  it('shows the held ticket with the waiting notice', async () => {
    stubFetch({
      reportsStatus: 202,
      reportsBody: { ticketNumber: 'MNT-2026-000009', message: 'Laporan menunggu pemeriksaan.' },
    });
    renderPage();
    await screen.findByRole('button', { name: /lanjut ke review/i });
    fillChain();
    attachPhoto();
    fireEvent.click(screen.getByRole('button', { name: /lanjut ke review/i }));
    fireEvent.click(await screen.findByRole('button', { name: /kirim laporan/i }));
    expect(await screen.findByText('MNT-2026-000009')).toBeInTheDocument();
    expect(await screen.findByText('Laporan menunggu pemeriksaan.')).toBeInTheDocument();
  });
});
