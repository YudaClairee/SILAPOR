// Worker entry (Task 5): Node process stub with beat + in-memory health.
//
// Consumes the QueueMessage contract from @silapor/jobs and reads runtime
// config only via @silapor/shared (never `process.env` directly, except the
// shared beat helper which owns `WORKER_BEAT_FILE`). Full broker polling,
// OpenRouter calls, and DB writes land in later phases.
//
// Beat model (pilot): the web app and the worker are SEPARATE processes, so
// liveness crosses them via a file beat (`recordWorkerBeat()` from
// `@silapor/shared`, default `./.data/worker-beat.json` — run both processes
// from the repo root, or set `WORKER_BEAT_FILE` to a shared absolute path).
// `processMessage()` refreshes both the in-memory `lastBeat` (same-process
// consumers via `getWorkerHealth()`) and the beat file (cross-process
// consumers via the web health check). Beat writes are best-effort and never
// fail message processing. Only `{ beatAt, pid }` is written — no payloads,
// no secrets.
import { randomUUID } from 'node:crypto';
import type { QueueMessage } from '@silapor/jobs';
import { createLogger, getRuntimeConfig, recordWorkerBeat } from '@silapor/shared';

const logger = createLogger({ service: 'worker' });

export interface ProcessResult {
  readonly ok: true;
  readonly messageId: string;
  readonly type: QueueMessage['type'];
}

export interface WorkerHealth {
  readonly ok: boolean;
  readonly lastBeat: string | null;
  readonly message: string;
}

let lastBeatAt: string | null = null;
let processedCount = 0;

export function getLastBeat(): string | null {
  return lastBeatAt;
}

export function getWorkerHealth(): WorkerHealth {
  if (lastBeatAt === null) {
    return {
      ok: false,
      lastBeat: null,
      message: 'worker started but no message processed yet (pilot placeholder)',
    };
  }
  return {
    ok: true,
    lastBeat: lastBeatAt,
    message: `worker alive; last beat ${lastBeatAt} (${processedCount} processed)`,
  };
}

async function beat(reason: string): Promise<void> {
  lastBeatAt = new Date().toISOString();
  try {
    await recordWorkerBeat();
  } catch {
    // Beat persistence is best-effort observability; never fail the worker.
    logger.warn('worker beat write failed', { code: 'WORKER_BEAT_WRITE_FAILED', result: reason });
  }
}

export async function processMessage(message: QueueMessage): Promise<ProcessResult> {
  const messageId = message.id.trim() !== '' ? message.id : randomUUID();
  logger.info('worker processing message', {
    route: 'worker/processMessage',
    result: message.type,
    code: messageId,
  });
  processedCount += 1;
  await beat('message');
  return { ok: true, messageId, type: message.type };
}

export interface WorkerHandle {
  readonly stop: () => Promise<void>;
  readonly getWorkerHealth: () => WorkerHealth;
}

export async function start(): Promise<WorkerHandle> {
  const config = getRuntimeConfig();
  logger.info('worker start (stub, no broker wired yet; call processMessage() directly)', {
    result: `port=${config.port}`,
  });
  await beat('start');
  return {
    stop: async () => {
      logger.info('worker stop');
    },
    getWorkerHealth,
  };
}

async function main(): Promise<void> {
  const handle = await start();
  const shutdown = async (): Promise<void> => {
    await handle.stop();
  };
  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

function wasInvokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === `file://${entry}` || import.meta.url.endsWith(entry);
}

if (wasInvokedDirectly()) {
  await main();
}
