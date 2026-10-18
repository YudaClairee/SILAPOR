// Mark every unread notification of the session user read (Phase 6 P6-5b).
// Returns the unread→read transition count; a second POST is a `{ updated:
// 0 }` 200 (idempotent). Static `read-all` segment — route ordering gives it
// priority over the `$id/read` dynamic route, which is two segments deeper
// and can never match `read-all`. See notifications.ts (server) for the
// guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { markMyNotificationsAllReadRoute } from '../../server/notifications';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/notifications/read-all';

export const Route = createFileRoute('/api/notifications/read-all')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await markMyNotificationsAllReadRoute(request);
            logger.info('notifications read-all', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ updated: result.updated }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('notifications read-all failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('notifications read-all rejected', {
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
