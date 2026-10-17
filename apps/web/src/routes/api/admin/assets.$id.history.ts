// Admin facility-asset maintenance history (Phase 6 P6-5c): GET all tickets
// per asset, newest first. Admin-only: `requireAdmin` inside the handler (401
// anonymous / 403 reporter); the service guard re-checks on the same request.
// 404 unknown asset and 400 non-UUID come from the DB layer, mapped via
// `toHttpResponse`. See server/facilities.ts for the guard log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireAdmin } from '../../../server/auth';
import { getAssetMaintenanceHistoryRoute } from '../../../server/facilities';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/admin/assets/$id/history';

export const Route = createFileRoute('/api/admin/assets/$id/history')({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            await requireAdmin(request);
            const result = await getAssetMaintenanceHistoryRoute(request, params.id);
            logger.info('admin asset history read', {
              route: ROUTE,
              result: 'ok',
              durationMs: Date.now() - started,
              details: redact({
                entityRef: result.asset.assetId,
                code: result.asset.assetCode,
                count: result.items.length,
              }),
            });
            return Response.json({ asset: result.asset, items: result.items });
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('admin asset history read failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('admin asset history rejected', {
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
