// Outbox poll loop (Phase 6 P6-4): thin driver over the database-package
// consumer. Pilot has no broker — the PostgreSQL outbox table IS the queue
// (plan §6.1 VPS/local profile). The loop claims a batch of PENDING rows,
// processes them atomically via `processOutboxBatch`, refreshes the worker
// beat, then sleeps. DB outages are logged and retried on the next tick —
// the loop must never crash the worker process.
//
// Only IDs and statuses cross this boundary; message payloads are loaded
// inside the consumer transaction (queue contract: no PII in logs).
import { createLogger } from '@silapor/shared';
import { processOutboxBatch, type DatabaseConnection } from '@silapor/database';

const logger = createLogger({ service: 'worker' });

export const DEFAULT_POLL_INTERVAL_MS = 2_000 as const;
export const DEFAULT_BATCH_LIMIT = 20 as const;
export const MAX_BATCH_LIMIT = 100 as const;
export const MIN_POLL_INTERVAL_MS = 250 as const;

export interface OutboxLoopOptions {
  readonly pollIntervalMs?: number | undefined;
  readonly batchLimit?: number | undefined;
}

export interface NormalizedOutboxLoopOptions {
  readonly pollIntervalMs: number;
  readonly batchLimit: number;
}

export function normalizeOutboxLoopOptions(
  options?: OutboxLoopOptions,
): NormalizedOutboxLoopOptions {
  const rawInterval = options?.pollIntervalMs;
  const pollIntervalMs =
    rawInterval === undefined || !Number.isFinite(rawInterval)
      ? DEFAULT_POLL_INTERVAL_MS
      : Math.max(Math.floor(rawInterval), MIN_POLL_INTERVAL_MS);
  const rawLimit = options?.batchLimit;
  const batchLimit =
    rawLimit === undefined || !Number.isFinite(rawLimit)
      ? DEFAULT_BATCH_LIMIT
      : Math.max(1, Math.min(Math.floor(rawLimit), MAX_BATCH_LIMIT));
  return { pollIntervalMs, batchLimit };
}

export interface OutboxLoopStats {
  readonly dispatched: number;
  readonly failed: number;
  readonly retried: number;
  readonly skipped: number;
  readonly batches: number;
}

// Internal accumulator (same shape, mutable fields).
interface MutableOutboxLoopStats {
  dispatched: number;
  failed: number;
  retried: number;
  skipped: number;
  batches: number;
}

export interface OutboxLoopHandle {
  readonly stop: () => Promise<void>;
  readonly stats: () => OutboxLoopStats;
}

type Db = DatabaseConnection['db'];

export function startOutboxLoop(
  db: Db,
  options?: OutboxLoopOptions,
  hooks?: { onBatch?: ((stats: OutboxLoopStats) => void) | undefined },
): OutboxLoopHandle {
  const config = normalizeOutboxLoopOptions(options);
  let running = true;
  const totals: MutableOutboxLoopStats = {
    dispatched: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
    batches: 0,
  };

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    });

  async function loop(): Promise<void> {
    while (running) {
      try {
        const batch = await processOutboxBatch(db, { limit: config.batchLimit });
        totals.dispatched += batch.dispatched;
        totals.failed += batch.failed;
        totals.retried += batch.retried;
        totals.skipped += batch.skipped;
        totals.batches += 1;
        if (
          batch.dispatched > 0 ||
          batch.failed > 0 ||
          batch.retried > 0 ||
          batch.skipped > 0
        ) {
          logger.info('outbox batch processed', {
            route: 'worker/outboxLoop',
            result: `dispatched=${batch.dispatched} retried=${batch.retried} failed=${batch.failed} skipped=${batch.skipped}`,
          });
        }
        hooks?.onBatch?.(totals);
      } catch (error) {
        // Never crash the loop: log a bounded, non-sensitive message.
        logger.warn('outbox batch failed; retrying next tick', {
          route: 'worker/outboxLoop',
          result: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
        });
      }
      if (!running) {
        break;
      }
      await sleep(config.pollIntervalMs);
    }
  }

  void loop();
  logger.info('outbox poll loop started', {
    route: 'worker/outboxLoop',
    result: `pollIntervalMs=${config.pollIntervalMs} batchLimit=${config.batchLimit}`,
  });

  return {
    stop: async () => {
      running = false;
    },
    stats: () => ({ ...totals }),
  };
}
