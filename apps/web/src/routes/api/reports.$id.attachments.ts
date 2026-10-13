// Report attachments collection (Phase 4 P4-3): POST multipart upload.
//
// Reporter+admin: `requireUser` inside the try (401 anonymous); the service
// layer re-guards on the same request (ownership, terminal-status, limits).
// `:id` accepts a row UUID or a ticket number (`MNT-…`); missing, foreign,
// and unresolvable references all → identical 404. Body is multipart with
// `files` (1..3 per request); success is 201 `{ attachments: [...] }` with
// NO `storageKey` ever. Failures map via `toHttpResponse`. Logs carry opaque
// user IDs and counts/codes only — never filenames, bytes, keys, or PII.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import {
  badRequest,
  createLogger,
  redact,
  toHttpResponse,
  withRequestId,
} from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { uploadAttachments, type AttachmentUploadFile } from '../../server/attachments';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/reports/$id/attachments';

async function extractUploadFiles(request: Request): Promise<AttachmentUploadFile[]> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest('Invalid multipart request.');
  }
  const files: AttachmentUploadFile[] = [];
  for (const entry of form.getAll('files')) {
    if (typeof File !== 'undefined' && entry instanceof File) {
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await entry.arrayBuffer());
      } catch {
        throw badRequest('Invalid multipart file.');
      }
      files.push({ bytes, declaredMime: entry.type, originalFilename: entry.name });
    }
  }
  return files;
}

export const Route = createFileRoute('/api/reports/$id/attachments')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { id: string } }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const files = await extractUploadFiles(request);
            const result = await uploadAttachments(request, params.id, files);
            logger.info('attachments uploaded', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ count: result.attachments.length }),
            });
            return Response.json(result, { status: 201 });
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('attachments upload failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('attachments upload rejected', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            }
            return Response.json(mapped.body, { status: mapped.status });
          }
        }),
    },
  },
});
