// Admin analytics overview (Phase 7): GET /api/admin/analytics/overview.
// Admin-only (guard + parsing live in server/analytics.ts); dates serialize as
// ISO strings via Response.json. Query contract: docs/api-contract.md §7.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { getDashboardOverviewRoute } from '../../../server/analytics';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/admin/analytics/overview';

export const Route = createFileRoute('/api/admin/analytics/overview')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const result = await getDashboardOverviewRoute(request, request.url);
            logger.info('analytics overview served', {
              route: ROUTE,
              result: 'ok',
              durationMs: Date.now() - started,
              details: redact({
                from: result.range.from,
                to: result.range.to,
                totalReports: result.cards.totalReports,
              }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('analytics overview failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('analytics overview rejected', {
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
