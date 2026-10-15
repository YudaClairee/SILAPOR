// Reporter form contract for the AI verification flow.
//
// The plan sketch renders the page, but this package has no jsdom or
// testing library (node vitest env), so the same requirements live here
// as pure helper tests plus route source assertions.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assetsForRoom,
  floorsForBuilding,
  isNewReportSubmittable,
  photoRefsForSubmit,
  roomsForParent,
  toSubmitOutcome,
  validateNewReportForm,
  type NewReportValues,
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
  it('disables submit with no photo and requires the full asset chain', () => {
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

  it('sends the picked file names as the submit photo refs', () => {
    expect(photoRefsForSubmit([photo('a.jpg'), photo('b.png', 'image/png')])).toEqual([
      'a.jpg',
      'b.png',
    ]);
  });
});

describe('route source contract', () => {
  const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'reporter.reports.new.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  it('renders no classification select at all', () => {
    expect(source).not.toMatch(/categor/i);
    expect(source).not.toMatch(/kategori/i);
    expect(source).not.toMatch(/issueType/i);
    expect(source).not.toMatch(/Jenis masalah/);
    expect(source).not.toMatch(/occurredAt/);
    expect(source).not.toMatch(/occurred_at/);
  });

  it('keeps the full chain, the photo picker, and the verified submit', () => {
    for (const id of [
      'report-building',
      'report-floor',
      'report-room',
      'report-asset',
      'report-description',
      'report-photos',
    ]) {
      expect(source).toContain(id);
    }
    expect(source).toContain('photoKeys: photoRefsForSubmit(');
    expect(source).toContain('x-idempotency-key');
    expect(source).toContain('uploadReportAttachments(');
    expect(source).toContain('toSubmitOutcome(');
  });
});
