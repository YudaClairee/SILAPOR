// Report attachment download (Phase 4 P4-3): GET byte stream for one file.
//
// Reporter+admin: `requireUser` inside the try (401 anonymous); the service
// layer re-guards on the same request. Downloads are campus-readable: any
// authenticated reporter may read any existing report's attachment, while
// upload stays owner-only. `:id` accepts a row UUID or a ticket number;
// missing reports/attachments → 404. Streams bytes with exact headers
// (`Content-Type` from the canonical DB MIME, `Content-Disposition: inline`,
// `nosniff`, private 60s cache) — never a redirect, presigned URL, or storage
// key. Logs carry opaque user and attachment IDs plus codes only.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { downloadAttachment, toAttachmentResponse } from '../../server/attachments';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/reports/$id/attachments/$attachmentId';

export const Route = createFileRoute('/api/reports/$id/attachments/$attachmentId')({
  server: {
    handlers: {
      GET: async ({
        request,
        params,
      }: {
        request: Request;
        params: { id: string; attachmentId: string };
      }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await downloadAttachment(request, params.id, params.attachmentId);
            logger.info('attachment downloaded', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ attachmentRef: params.attachmentId }),
            });
            return toAttachmentResponse(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('attachment download failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('attachment download rejected', {
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
