// Admin report assign (Phase 5 P5-5): POST assign a technician to a
// VERIFIED (or reassign an in-progress) report.
//
// Admin-only: `requireAdmin` inside the try (401 anonymous / 403 reporter);
// the service layer re-guards on the same request. `:id` accepts a row UUID
// or a ticket number (`MNT-…`, unscoped resolution); missing or
// unresolvable references → 404 with the identical report message. Body is
// JSON (camelCase or snake_case) with `technicianId` + optional `reason` +
// `expectedVersion` (400 when missing, 409 on a stale version for UI
// conflict handling). Returns the updated report row. Logs carry the opaque
// report ref only — never technician names. See reports.ts for the
// guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireAdmin } from '../../../server/auth';
import { assignAdminReport } from '../../../server/workflow';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/admin/reports/$id/assign';

export const Route = createFileRoute('/api/admin/reports/$id/assign')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { id: string } }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          let body: unknown = null;
          try {
            body = await request.json();
          } catch {
            body = null;
          }
          try {
            const user = await requireAdmin(request);
            const result = await assignAdminReport(request, params.id, body);
            logger.info('admin report assigned', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ reportRef: params.id }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('admin report assign failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('admin report assign rejected', {
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
