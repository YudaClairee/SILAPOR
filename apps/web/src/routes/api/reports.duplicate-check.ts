// Reporter duplicate check (Phase 3 P3-4): GET duplicate candidates.
//
// Reporter-only: `requireUser` inside the try (401 anonymous); the service
// layer re-guards on the same request. Query params are `locationId`,
// `categoryId` (required) plus `assetId`/`issueTypeId` (optional); invalid
// or missing combos → 400 via the repo validators. Creates nothing —
// returns `{ candidates }` as a pre-submit warning. See reports.ts for the
// guard/log contract.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, redact, toHttpResponse, withRequestId } from '@silapor/shared';
import { requireUser } from '../../server/auth';
import { checkMyDuplicates } from '../../server/reports';

const logger = createLogger({ service: 'web' });
const ROUTE = '/api/reports/duplicate-check';

export const Route = createFileRoute('/api/reports/duplicate-check')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            const user = await requireUser(request);
            const result = await checkMyDuplicates(request, request.url);
            logger.info('report duplicates checked', {
              route: ROUTE,
              result: 'ok',
              userId: user.id,
              durationMs: Date.now() - started,
              details: redact({ count: result.candidates.length }),
            });
            return Response.json(result);
          } catch (error) {
            const mapped = toHttpResponse(error);
            if (mapped.status >= 500) {
              logger.error('report duplicate check failed', {
                route: ROUTE,
                code: mapped.body.error.code,
                durationMs: Date.now() - started,
              });
            } else {
              logger.warn('report duplicate check rejected', {
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
