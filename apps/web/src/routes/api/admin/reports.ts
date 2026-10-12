// Admin reports collection (Phase 3 P3-4): GET list all.
//
// Admin-only: `requireAdmin` inside the try (401 anonymous / 403 reporter);
// the service layer re-guards on the same request. Query per the reporter
// list plus `reporterId` and `search`; returns `{ items, total, limit,
// offset }`. Failures map via `toHttpResponse`. Logs carry the opaque admin
// user id and counts only — never usernames, NIMs, or descriptions.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireAdmin } from '../../../server/auth';
import { listAllReportsRoute } from '../../../server/reports';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/admin/reports';

export const Route = createFileRoute('/api/admin/reports')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireAdmin(request);
            const result = await listAllReportsRoute(request, request.url);
            logger.info('admin reports listed', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ count: result.items.length, total: result.total }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('admin reports list failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('admin reports list rejected', {
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
