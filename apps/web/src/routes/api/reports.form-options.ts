// Reporter form options (Phase 3 P3-4): GET active master-data subset.
//
// Reporter + admin: `requireUser` inside the try (401 anonymous); the
// service layer re-guards on the same request. Returns `{ locations,
// categories, issueTypes, assets }` — active-only rows, locations exclude
// `reporterHidden`, small payloads (id/code/name + parent links +
// tier/weight only). See reports.ts for the guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { listFormOptions } from '../../server/reports';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/reports/form-options';

export const Route = createFileRoute('/api/reports/form-options')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await listFormOptions(request);
            logger.info('report form options listed', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({
                locationCount: result.locations.length,
                categoryCount: result.categories.length,
                issueTypeCount: result.issueTypes.length,
                assetCount: result.assets.length,
              }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('report form options failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('report form options rejected', {
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
