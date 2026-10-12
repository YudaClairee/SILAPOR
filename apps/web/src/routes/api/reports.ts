// Reporter reports collection (Phase 3 P3-4): GET list mine + POST create.
//
// Reporter-only: `requireUser` inside the try (401 anonymous); the service
// layer re-guards on the same request. POST takes report fields as the body
// with the idempotency key in the `x-idempotency-key` header (400 when
// missing/empty): 201 on create (`idempotentReplay:false`), 200 with the
// same body on replay. Failures map via `toHttpResponse`. Logs carry opaque
// user/report IDs and counts only — never usernames, NIMs, or descriptions.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { createMyReport, listMyReportsRoute } from '../../server/reports';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/reports';

export const Route = createFileRoute('/api/reports')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await listMyReportsRoute(request, request.url);
            logger.info('reports listed', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ count: result.items.length, total: result.total }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('reports list failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('reports list rejected', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            }
            return Response.json(mapped.body, { status: mapped.status });
          }
        }),
      POST: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          let body: unknown = null;
          try {
            body = await request.json();
          } catch {
            body = null;
          }
          try {
            const user = await requireUser(request);
            const result = await createMyReport(
              request,
              body,
              request.headers.get('x-idempotency-key'),
            );
            logger.info('report created', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({
                reportRef: result.report.id,
                replay: result.idempotentReplay,
                candidateCount: result.duplicateCandidates.length,
              }),
            });
            return Response.json(result, { status: result.idempotentReplay ? 200 : 201 });
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('report create failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('report create rejected', {
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
