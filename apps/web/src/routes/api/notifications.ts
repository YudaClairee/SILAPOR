// Notification list for the session user (Phase 6 P6-5b). Any role gets its
// own (always empty for admins) list; no pagination exists in the contract.
// Dates serialize as ISO strings via Response.json, matching the report
// endpoints. See notifications.ts (server) for the guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { getMyNotificationsRoute } from '../../server/notifications';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/notifications';

export const Route = createFileRoute('/api/notifications')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await getMyNotificationsRoute(request);
            logger.info('notification list', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
            });
            return Response.json({
              items: result.items,
              total: result.total,
              unreadCount: result.unreadCount,
            });
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('notification list failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('notification list rejected', {
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
