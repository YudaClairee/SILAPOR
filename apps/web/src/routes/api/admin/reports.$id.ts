// Admin report detail (Phase 3 P3-4): GET one (any reporter).
//
// Admin-only: `requireAdmin` inside the try (401 anonymous / 403 reporter);
// the service layer re-guards on the same request. `:id` accepts a row UUID
// or a ticket number (`MNT-…`, unscoped resolution); missing or
// unresolvable references → 404. Returns the full detail shape
// (`{ report, attachments, events, relations, duplicateCandidates,
// aiAnalysis }`); `aiAnalysis` is the latest verifier row for the admin
// panel. See reports.ts for the guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireAdmin } from '../../../server/auth';
import { getAdminReportRoute } from '../../../server/reports';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/admin/reports/$id';

export const Route = createFileRoute('/api/admin/reports/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireAdmin(request);
            const result = await getAdminReportRoute(request, params.id);
            logger.info('admin report read', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ reportRef: result.report.id }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('admin report read failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('admin report read rejected', {
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
