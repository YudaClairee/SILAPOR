// Mark one own notification read (Phase 6 P6-5b). Idempotent: an already
// read row is a no-op 200; an unknown or foreign id is the repo's
// byte-identical 404 (IDOR guard). See notifications.ts (server) for the
// guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { markMyNotificationReadRoute } from '../../server/notifications';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/notifications/$id/read';

export const Route = createFileRoute('/api/notifications/$id/read')({
  server: {
    handlers: {
      POST: async ({ request, params }: { request: Request; params: { id: string } }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            await markMyNotificationReadRoute(request, params.id);
            logger.info('notification read', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ notificationId: params.id }),
            });
            return Response.json(null, { status: 200 });
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('notification read failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('notification read rejected', {
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
