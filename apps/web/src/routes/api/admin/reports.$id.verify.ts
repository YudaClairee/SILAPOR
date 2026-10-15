// Held-only hand verification: unverified reported holds become verified, nothing else.
import { createFileRoute } from '@tanstack/react-router';import { randomUUID } from 'node:crypto';
import { getDb } from '@silapor/database';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireAdmin } from '../../../server/auth';
import { normalizeHeldVerifyBody, verifyHeldReport } from '../../../server/held';
import { resolveReportId } from '../../../server/reports.js';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/admin/reports/$id/verify';

export const Route = createFileRoute('/api/admin/reports/$id/verify')({
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
            const { decision, expectedVersion } = normalizeHeldVerifyBody(body);
            const conn = getDb();
            let id: string;
            try {
              id = await resolveReportId(conn.db, null, params.id);
            } finally {
              await conn.close().catch(() => undefined);
            }
            const result = await verifyHeldReport(user.id, id, decision, expectedVersion);
            logger.info('admin report verified', {
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
              logger.error('admin report verify failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('admin report verify rejected', {
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
