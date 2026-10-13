// Client attachment helpers (Phase 4, task P4-4). DOM-light: pure validation
// (no React) plus a thin FormData uploader using the session cookie.
//
// The limits below MIRROR the server constants (`MAX_ATTACHMENT_BYTES` /
// `MAX_ATTACHMENTS_PER_REPORT` / `ALLOWED_ATTACHMENT_MIME_TYPES` in
// `@silapor/storage` `attachments.ts`): the client bundle must not import
// that module (it pulls `sharp`/node), so the values are pinned here and in
// `attachments.test.ts` — update all three together. Server validation stays
// authoritative (magic-byte sniff + re-encode); these checks only fail fast
// with Indonesian copy.
export const CLIENT_MAX_ATTACHMENT_BYTES = 5_242_880;
export const CLIENT_MAX_ATTACHMENTS_PER_REPORT = 3;
export const CLIENT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// Extension fallback map, used ONLY when the browser supplies no MIME type.
const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface ClientFileLike {
  readonly size: number;
  readonly type: string;
  readonly name: string;
}

// Client mirror of the server rules: ≤ 3 files total, per-file ≤ 5 MiB,
// allowlist by `file.type` with extension fallback when the type is missing.
// Returns Indonesian error strings (empty = valid).
export function validateAttachmentFiles(files: readonly ClientFileLike[]): string[] {
  if (files.length > CLIENT_MAX_ATTACHMENTS_PER_REPORT) {
    return ['Maksimal 3 foto per laporan.'];
  }
  const errors: string[] = [];
  for (const file of files) {
    if (file.size > CLIENT_MAX_ATTACHMENT_BYTES) {
      errors.push(`Ukuran "${file.name}" melebihi 5 MB.`);
      continue;
    }
    const declared = file.type.trim().toLowerCase();
    if ((CLIENT_ALLOWED_MIME_TYPES as readonly string[]).includes(declared)) {
      continue;
    }
    // Extension fallback ONLY when the browser supplied no MIME type at all;
    // a declared-but-rejected type (SVG, exe-as-octet-stream, …) stays
    // rejected here — the server sniff is authoritative either way.
    if (declared === '') {
      const ext = file.name.split('.').pop()?.trim().toLowerCase() ?? '';
      if (Object.hasOwn(EXTENSION_MIME_TYPES, ext)) {
        continue;
      }
    }
    errors.push(`Format "${file.name}" tidak didukung. Gunakan JPG, PNG, atau WebP.`);
  }
  return errors;
}

export function reportAttachmentsUrl(ticketOrId: string): string {
  return `/api/reports/${encodeURIComponent(ticketOrId)}/attachments`;
}

// Authorized GET url for one attachment's bytes (session cookie via
// `credentials: 'include'` at fetch time — never a presigned/public URL).
export function attachmentDownloadUrl(ticketOrId: string, attachmentId: string): string {
  return `${reportAttachmentsUrl(ticketOrId)}/${encodeURIComponent(attachmentId)}`;
}

export interface UploadedAttachmentSummary {
  readonly id: string;
}

interface UploadResponseBody {
  readonly attachments?: readonly UploadedAttachmentSummary[];
}

// Uploads already-validated files AFTER the ticket exists. Throws Indonesian
// Errors (the ticket itself is intact — callers keep it and may retry).
export async function uploadReportAttachments(
  ticketNumber: string,
  files: readonly File[],
): Promise<readonly UploadedAttachmentSummary[]> {
  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  let response: Response;
  try {
    response = await fetch(reportAttachmentsUrl(ticketNumber), {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
  } catch {
    throw new Error('Gagal mengunggah foto. Coba lagi.');
  }
  if (response.status === 401) {
    throw new Error('Sesi berakhir. Masuk kembali lalu coba lagi.');
  }
  if (response.status === 413) {
    throw new Error('Ukuran foto melebihi 5 MB.');
  }
  if (!response.ok) {
    throw new Error('Gagal mengunggah foto. Coba lagi.');
  }
  let data: UploadResponseBody;
  try {
    data = (await response.json()) as UploadResponseBody;
  } catch {
    throw new Error('Gagal mengunggah foto. Coba lagi.');
  }
  return Array.isArray(data.attachments) ? data.attachments : [];
}
