// Reporter report detail (Phase 3 P3-4): GET one of mine.
//
// Reporter-only: `requireUser` inside the try (401 anonymous); the service
// layer re-guards on the same request. `:id` accepts a row UUID or a ticket
// number (`MNT-…`, resolved then ownership-checked); missing, foreign, and
// unresolvable references all → identical 404. Returns `{ report,
// attachments, events, relations, duplicateCandidates }`. See reports.ts
// for the guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { getMyReportRoute } from '../../server/reports';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/reports/$id';

export const Route = createFileRoute('/api/reports/$id')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await getMyReportRoute(request, params.id);
            logger.info('report read', {
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
              logger.error('report read failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('report read rejected', {
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
