// Reporter report detail (Phase 3 P3-4 + UI No. 5): GET a sanitized campus
// ticket. Any authenticated reporter may open any ticket; the repo hides
// reporter identity, technician identity, and other reporters' attachments.
// All progress notes are visible; a LAPORAN_PALSU note is neutralized.
// Missing/unresolvable references → 404. Returns
// `{ report, isOwn, attachments, events, relations, duplicateCandidates }`.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { getCampusReportRoute } from '../../server/reports';

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
            const result = await getCampusReportRoute(request, params.id);
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
