// Reporter reports collection (Phase 3 P3-4 + Task 6 verified submit):
// GET campus-wide sanitized list (+ `mine=1`) and POST synchronous
// AI-verified create.
//
// Reporter-only: `requireUser` inside the try (401 anonymous); the service
// layer re-guards on the same request. POST takes location + asset +
// description + 1-3 photo keys as the body with the idempotency key in the
// `x-idempotency-key` header (400 when missing/empty): 201 on verified
// create, 202 when the AI is down (held REPORTED + ticket + waiting notice),
// 422 `{ reason }` when verification fails (no row, no ticket), 409 with
// the active ticket ref on a same-reporter duplicate block. Failures map via
// `toHttpResponse`. Logs carry opaque IDs and counts only — never usernames,
// NIMs, or descriptions.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import {
  createLogger,
  isAppError,
  redact,
  toHttpResponse,
  withRequestId,
} from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { listCampusReportsRoute, submitVerifiedReport } from '../../server/reports';

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
            const result = await listCampusReportsRoute(request, request.url);
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
            const result = await submitVerifiedReport(
              request,
              body,
              request.headers.get('x-idempotency-key'),
            );
            const { status, ...responseBody } = result;
            logger.info('report submitted', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({
                status,
                ticketNumber: status === 422 ? undefined : result.ticketNumber,
              }),
            });
            return Response.json(responseBody, { status });
          } catch (error) {
            // `toHttpResponse` strips `details`, so the duplicate block reads
            // the active ticket ref off the error directly (Task 6 contract).
            if (isAppError(error) && error.code === 'DUPLICATE_ACTIVE') {
              const details = (error.details ?? {}) as { ticketNumber?: unknown };
              const ticketNumber =
                typeof details.ticketNumber === 'string' ? details.ticketNumber : undefined;
              logger.warn('report submit rejected', {
                route: ROUTE,
                code: error.code,
                durationMs: Date.now() - started,
              });
              return Response.json(
                { error: { code: error.code, message: error.message }, ticketNumber },
                { status: 409 },
              );
            }
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
