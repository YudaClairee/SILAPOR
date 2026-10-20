// Reporter KPI counters (Phase 3 reporter dashboard):
// GET /api/reports/stats -> { total, active, inRepair, done, mineTotal }.
//
// Auth-only: anonymous callers get 401 from `requireUser` in the route and
// again inside the service. Counts are campus-wide except `mineTotal`; no
// reporter identities or PII leave this endpoint. Logs carry opaque ids and
// aggregate counts only.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { getReporterStatsRoute } from '../../server/reports';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/reports/stats';

export const Route = createFileRoute('/api/reports/stats')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await getReporterStatsRoute(request);
            logger.info('report stats served', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({
                total: result.total,
                active: result.active,
                mineTotal: result.mineTotal,
              }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('report stats failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('report stats rejected', {
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
