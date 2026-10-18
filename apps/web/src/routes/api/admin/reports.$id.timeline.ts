// Admin report timeline (Phase 5): GET the full merged timeline
// (events + progress notes + assignments + relations, chronological).
//
// Admin-only: `requireAdmin` inside the try (401 anonymous / 403 reporter);
// the service layer re-guards on the same request. `:id` accepts a row UUID
// or a ticket number (`MNT-…`, unscoped resolution); missing or
// unresolvable references → 404 with the identical report message. Returns
// `{ entries }` with the raw LAPORAN_PALSU condition and message (admin-only
// surface). See reports.ts for the guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireAdmin } from '../../../server/auth';
import { getAdminTimelineRoute } from '../../../server/workflow';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/admin/reports/$id/timeline';

export const Route = createFileRoute('/api/admin/reports/$id/timeline')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireAdmin(request);
            const result = await getAdminTimelineRoute(request, params.id);
            logger.info('admin timeline read', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ count: result.entries.length }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('admin timeline read failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('admin timeline read rejected', {
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
