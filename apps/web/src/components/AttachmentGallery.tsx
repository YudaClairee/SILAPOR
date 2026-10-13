// AttachmentGallery (Phase 4, task P4-4). Thumbnail grid for report
// attachments served by the authorized byte endpoint (session cookie — never
// a presigned/public URL).
//
// A failed image is a first-class UI state: `onError` swaps the <img> for a
// styled placeholder box ("Gambar tidak dapat dimuat", `role="img"` +
// aria-label, never raw error text). Tokens only (DESIGN.md); empty lists
// render null (pages own their empty copy).
import { useState } from 'react';
import { attachmentDownloadUrl } from '../lib/attachments.js';

export interface GalleryAttachment {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface AttachmentGalleryProps {
  readonly ticketRef: string;
  readonly attachments: readonly GalleryAttachment[];
}

const thumbBoxClasses =
  'h-28 w-full rounded-md border border-border bg-background';

function AttachmentImage({
  ticketRef,
  attachment,
}: {
  readonly ticketRef: string;
  readonly attachment: GalleryAttachment;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        role="img"
        aria-label="Gambar tidak dapat dimuat"
        className={`flex items-center justify-center p-2 text-center text-sm text-muted ${thumbBoxClasses}`}
      >
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
      className={`object-cover ${thumbBoxClasses}`}
    />
  );
}

export function AttachmentGallery({ ticketRef, attachments }: AttachmentGalleryProps) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <figure>
            <AttachmentImage ticketRef={ticketRef} attachment={attachment} />
            <figcaption
              className="mt-1 truncate text-xs text-muted"
              title={`${attachment.originalFilename} (${attachment.mimeType}, ${attachment.sizeBytes} byte)`}
            >
              {attachment.originalFilename} ({attachment.sizeBytes} byte)
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
