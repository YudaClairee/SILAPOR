// PhotoEvidence (Reporter Detail V2). Two-up pager over the report's photo
// attachments: the gallery is paged instead of dumped, so the ticket page
// stays scannable with 5+ photos. Bytes still come from the authorized
// endpoint (session cookie), never a public/presigned URL.
//
// Failed images degrade to a labelled placeholder; a click opens an in-page
// lightbox (Escape / close button) instead of leaving the app.
import { useCallback, useEffect, useState } from 'react';
import { attachmentDownloadUrl } from '../lib/attachments.js';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, ImageIcon } from './Icon';

export interface PhotoEvidenceAttachment {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface PhotoEvidenceProps {
  readonly ticketRef: string;
  readonly attachments: readonly PhotoEvidenceAttachment[];
  /** Photos per page; the design shows a 2-up grid. */
  readonly pageSize?: number;
}

const imageBoxClasses = 'absolute inset-0 h-full w-full object-cover';

function PhotoImage({
  ticketRef,
  attachment,
  className,
}: {
  readonly ticketRef: string;
  readonly attachment: PhotoEvidenceAttachment;
  readonly className: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        role="img"
        aria-label="Gambar tidak dapat dimuat"
        className={`flex flex-col items-center justify-center gap-1 bg-background p-3 text-center text-xs text-muted ${className}`}
      >
        <ImageIcon className="h-5 w-5" />
        Gambar tidak dapat dimuat
      </div>
    );
  }
  return (
    <img
      src={attachmentDownloadUrl(ticketRef, attachment.id)}
      alt={attachment.originalFilename}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

function Lightbox({
  ticketRef,
  attachment,
  onClose,
}: {
  readonly ticketRef: string;
  readonly attachment: PhotoEvidenceAttachment;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pratinjau ${attachment.originalFilename}`}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4"
    >
      <div className="flex items-center justify-between gap-3 text-white">
        <p className="truncate font-mono text-xs">{attachment.originalFilename}</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-white/10 p-2 text-white hover:bg-white/20"
          aria-label="Tutup pratinjau"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 flex min-h-0 flex-1 items-center justify-center">
        <img
          src={attachmentDownloadUrl(ticketRef, attachment.id)}
          alt={attachment.originalFilename}
          className="max-h-full max-w-full rounded-md object-contain"
        />
      </div>
    </div>
  );
}

export function PhotoEvidence({ ticketRef, attachments, pageSize = 2 }: PhotoEvidenceProps) {
  const [start, setStart] = useState(0);
  const [preview, setPreview] = useState<PhotoEvidenceAttachment | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);

  if (attachments.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <ImageIcon className="h-4 w-4" />
        Tidak ada foto bukti yang dilampirkan.
      </p>
    );
  }

  const total = attachments.length;
  const first = Math.min(start, Math.max(0, total - 1));
  const visible = attachments.slice(first, first + pageSize);
  const last = first + visible.length;
  const atStart = first === 0;
  const atEnd = last >= total;

  return (
    <div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {visible.map((attachment, index) => {
          const photoNumber = first + index + 1;
          return (
            <li key={attachment.id}>
              <button
                type="button"
                onClick={() => setPreview(attachment)}
                aria-label={`Perbesar foto ${photoNumber} dari ${total}: ${attachment.originalFilename}`}
                className="relative block aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-background text-left"
              >
                <PhotoImage
                  ticketRef={ticketRef}
                  attachment={attachment}
                  className={imageBoxClasses}
                />
                <span className="absolute left-2 top-2 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-black/60 px-1.5 font-mono text-[11px] font-semibold text-white">
                  {photoNumber}
                </span>
                <span className="absolute bottom-0 left-0 right-0 truncate bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4 text-[11px] text-white">
                  {attachment.originalFilename}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-muted">
          {first + 1}–{last} dari {total} foto ditampilkan
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStart(Math.max(0, first - pageSize))}
            disabled={atStart}
            aria-label="Foto sebelumnya"
            className="rounded-md border border-border bg-surface p-1.5 text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setStart(first + pageSize)}
            disabled={atEnd}
            aria-label="Foto berikutnya"
            className="rounded-md border border-border bg-surface p-1.5 text-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {preview === null ? null : (
        <Lightbox ticketRef={ticketRef} attachment={preview} onClose={closePreview} />
      )}
    </div>
  );
}
