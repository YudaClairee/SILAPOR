// @vitest-environment jsdom
// PhotoEvidence (Reporter Detail V2): the gallery is paged two-up so a ticket
// with many photos stays scannable. Bytes are never inlined here — the <img>
// points at the authorized attachment endpoint, and a slow/failed image
// degrades to a labelled placeholder.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PhotoEvidence } from './PhotoEvidence';

const PHOTOS = [
  { id: 'a1', originalFilename: 'proyektor-1.jpg', mimeType: 'image/jpeg', sizeBytes: 1024 },
  { id: 'a2', originalFilename: 'proyektor-2.jpg', mimeType: 'image/jpeg', sizeBytes: 2048 },
  { id: 'a3', originalFilename: 'proyektor-3.jpg', mimeType: 'image/jpeg', sizeBytes: 4096 },
] as const;

afterEach(cleanup);

describe('PhotoEvidence', () => {
  it('says so when the ticket has no photos', () => {
    render(<PhotoEvidence ticketRef="MNT-2026-000007" attachments={[]} />);
    expect(screen.getByText('Tidak ada foto bukti yang dilampirkan.')).toBeInTheDocument();
  });

  it('pages photos two-up and reports the visible range', () => {
    render(<PhotoEvidence ticketRef="MNT-2026-000007" attachments={PHOTOS} />);
    expect(screen.getByText('1–2 dari 3 foto ditampilkan')).toBeInTheDocument();
    expect(screen.getByAltText('proyektor-1.jpg')).toBeInTheDocument();
    expect(screen.getByAltText('proyektor-2.jpg')).toBeInTheDocument();
    expect(screen.queryByAltText('proyektor-3.jpg')).not.toBeInTheDocument();
  });

  it('disables prev on the first page and advances to the last photo', () => {
    render(<PhotoEvidence ticketRef="MNT-2026-000007" attachments={PHOTOS} />);
    const prev = screen.getByRole('button', { name: 'Foto sebelumnya' });
    const next = screen.getByRole('button', { name: 'Foto berikutnya' });
    expect(prev).toBeDisabled();
    expect(next).toBeEnabled();

    fireEvent.click(next);
    expect(screen.getByText('3–3 dari 3 foto ditampilkan')).toBeInTheDocument();
    expect(screen.getByAltText('proyektor-3.jpg')).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(prev).toBeEnabled();

    fireEvent.click(prev);
    expect(screen.getByText('1–2 dari 3 foto ditampilkan')).toBeInTheDocument();
  });

  it('opens a lightbox on click and closes it with Escape', () => {
    render(<PhotoEvidence ticketRef="MNT-2026-000007" attachments={PHOTOS} />);
    fireEvent.click(screen.getByRole('button', { name: /Perbesar foto 1 dari 3/ }));
    const dialog = screen.getByRole('dialog', { name: 'Pratinjau proyektor-1.jpg' });
    expect(dialog).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('falls back to a labelled placeholder when an image fails', () => {
    render(<PhotoEvidence ticketRef="MNT-2026-000007" attachments={PHOTOS.slice(0, 1)} />);
    fireEvent.error(screen.getByAltText('proyektor-1.jpg'));
    expect(screen.getByRole('img', { name: 'Gambar tidak dapat dimuat' })).toBeInTheDocument();
  });

  it('uses the authorized attachment endpoint for the bytes', () => {
    render(<PhotoEvidence ticketRef="MNT-2026-000007" attachments={PHOTOS.slice(0, 1)} />);
    const img = screen.getByAltText('proyektor-1.jpg') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('/api/reports/MNT-2026-000007/attachments/a1');
  });
});
