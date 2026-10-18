// Reporter report timeline (Phase 5): GET sanitized entries for one of mine.
//
// Reporter-only: `requireUser` inside the try (401 anonymous); the service
// layer re-guards on the same request. `:id` accepts a row UUID or a ticket
// number (`MNT-…`); ownership and 404 semantics match the detail route.
// Returns `{ events }` SANITIZED (all progress notes, no actor/author PII,
// LAPORAN_PALSU projected to neutral text) — safe to render verbatim.
// See reports.ts for the guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { getMyTimelineRoute } from '../../server/reports';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/reports/$id/timeline';

export const Route = createFileRoute('/api/reports/$id/timeline')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await getMyTimelineRoute(request, params.id);
            logger.info('report timeline read', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ count: result.events.length }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('report timeline read failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('report timeline read rejected', {
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
