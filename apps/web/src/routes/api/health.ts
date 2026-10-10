// Full health route (Task 5). Replaces the Task 2 `ping()` placeholder with
// `checkHealth()` (database/storage/queue/worker, all fail-open: an offline
// dependency yields `{ ok: false, checks.*.ok: false }`, never a 500 throw).
// The route always answers 200 with the machine-readable `ok` flag so
// load-balancers stay open while operators read per-check detail.
// TODO (later phase): treat the worker file beat as a live liveness signal
// once the outbox/broker loop lands; the current beat is a placeholder.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { createLogger, withRequestId } from '@silapor/shared';
import { checkHealth } from '../../server/health';

const logger = createLogger({ service: 'web' });

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          try {
            logger.info('health check start', { route: '/api/health' });
            const result = await checkHealth();
            logger.info('health check complete', {
              route: '/api/health',
              result: result.ok ? 'ok' : 'degraded',
              durationMs: Date.now() - started,
            });
            return Response.json(result);
          } catch (error) {
            // Defensive: `checkHealth()` never throws, but the route stays
            // fail-open even on programmer error — health-shaped 200, not 500.
            const detail = error instanceof Error ? error.message : String(error);
            logger.error('health check failed', { route: '/api/health', code: 'INTERNAL' });
            return Response.json({
              ok: false,
              service: 'web',
              checks: {
                database: { ok: false, message: `health failed: ${detail}` },
                storage: { ok: false, message: `health failed: ${detail}` },
                queue: { ok: false, message: `health failed: ${detail}` },
                worker: { ok: false, message: `health failed: ${detail}` },
              },
            });
          }
        }),
    },
  },
});
