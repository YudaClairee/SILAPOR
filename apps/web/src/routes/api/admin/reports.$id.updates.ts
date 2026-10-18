// Admin progress note (Phase 5): POST one reporter-visible note, optionally
// marked LAPORAN_PALSU.
//
// Admin-only: `requireAdmin` inside the try (401 anonymous / 403 reporter);
// the service layer re-guards on the same request. `:id` accepts a row UUID
// or a ticket number (`MNT-…`, unscoped resolution); missing or
// unresolvable references → 404 with the identical report message. Body is
// JSON (camelCase or snake_case) with optional `condition`
// (`LAPORAN_PALSU`) + `message` (5–2000 chars) + `expectedVersion` (400 when
// missing, 409 on a stale version for UI conflict handling). Returns the
// created update row. Logs carry the opaque report ref + condition only —
// never the message.
// See reports.ts for the guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireAdmin } from '../../../server/auth';
import { addUpdateAdminReport } from '../../../server/workflow';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/admin/reports/$id/updates';

export const Route = createFileRoute('/api/admin/reports/$id/updates')({
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
            const result = await addUpdateAdminReport(request, params.id, body);
            logger.info('admin report update added', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ reportRef: params.id, condition: result.condition }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('admin report update failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('admin report update rejected', {
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
