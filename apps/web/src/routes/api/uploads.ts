// Pre-submit photo staging (AI verification photo-first flow): POST
// multipart upload returning opaque storage keys for the verified submit.
//
// Reporter+admin: `requireUser` inside the try (401 anonymous); the service
// layer re-guards on the same request. Body is multipart with `files`
// (1..3 per request); success is 201 `{ keys: [...] }` with NO bytes or
// metadata ever. Keys expire after 24h unclaimed and are claimed into
// `report_attachments` by the verified submit (PASS/HELD) or removed (FAIL).
// Failures map via `toHttpResponse`. Logs carry opaque user IDs and
// counts/codes only — never filenames, bytes, keys, or PII.
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
import { stageUploads, type StagingUploadFile } from '../../server/uploads';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/uploads';

async function extractUploadFiles(request: Request): Promise<StagingUploadFile[]> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw badRequest('Invalid multipart request.');
  }
  const files: StagingUploadFile[] = [];
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

export const Route = createFileRoute('/api/uploads')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const files = await extractUploadFiles(request);
            const result = await stageUploads(request, files);
            logger.info('photos staged', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ count: result.keys.length }),
            });
            return Response.json(result, { status: 201 });
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('photo staging failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('photo staging rejected', {
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
