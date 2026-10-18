// Facility status list (Phase 6 P6-5c): GET /api/facilities/status.
//
// Admin-only (plan §8 realignment 2026-10-17: facility status is reporter-
// invisible). Sanitization is by-construction in the DB layer (no reporter
// identity, no report content); dates serialize as ISO strings via
// Response.json, matching the report endpoints. See server/facilities.ts for
// the guard/query contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { listFacilityStatusRoute } from '../../server/facilities';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/facilities/status';

export const Route = createFileRoute('/api/facilities/status')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          const url = request.url;
          try {
            const result = await listFacilityStatusRoute(request, url);
            logger.info('facility status listed', {
              route: ROUTE,
              result: 'ok',
              durationMs: Date.now() - started,
              details: redact({ count: result.items.length, total: result.total }),
            });
            return Response.json({
              items: result.items,
              total: result.total,
              limit: result.limit,
              offset: result.offset,
            });
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('facility status list failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('facility status list rejected', {
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
