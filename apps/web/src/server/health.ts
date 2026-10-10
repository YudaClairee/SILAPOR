// Full health checks: web + database + storage + queue + worker (Task 5).
//
// Fail-open by construction: every check catches its own errors and returns
// `{ ok: false, message }`, and `checkHealth()` itself never throws — an
// unreachable DATABASE_URL (or missing beat file, or unwritable dir) yields
// `ok: false` with per-check detail, never a 500. Each dependency gets a
// bounded wait (2s) so an offline environment stays fast as well as green.
//
// - database: `getDb()` + lightweight `SELECT 1` with a 2s timeout. Importing
//   `@silapor/database` never connects (postgres.js is lazy); errors surface
//   here and are reported without credentials (no URL in the message).
// - storage: real writable proof through `FilesystemAttachmentStorage`
//   (put + remove of a unique `__health__/` probe under `resolveStorageDir()`).
// - queue: pilot memory stub — publishes one message through `MemoryQueue`
//   (no broker wired; the durable outbox count arrives with the broker loop).
// - worker: reads the file-based beat written by `apps/worker`
//   (`recordWorkerBeat` in `@silapor/shared`); missing/stale beats are
//   reported, not thrown. Run web + worker from the repo root in the pilot,
//   or set `WORKER_BEAT_FILE` to a shared absolute path.

import { randomUUID } from 'node:crypto';
import { getDb } from '@silapor/database';
import { MemoryQueue } from '@silapor/jobs';
import {
  WORKER_BEAT_MAX_AGE_MS,
  readWorkerBeat,
  resolveWorkerBeatFile,
  workerBeatAgeMs,
} from '@silapor/shared';
import { FilesystemAttachmentStorage, resolveStorageDir } from '@silapor/storage';

export interface HealthCheckResult {
  readonly ok: boolean;
  readonly message: string;
  readonly latencyMs?: number;
}

export interface HealthChecks {
  readonly database: HealthCheckResult;
  readonly storage: HealthCheckResult;
  readonly queue: HealthCheckResult;
  readonly worker: HealthCheckResult;
}

export interface HealthResult {
  readonly ok: boolean;
  readonly service: 'web';
  readonly checks: HealthChecks;
}

const CHECK_TIMEOUT_MS = 2000;

async function withTimeout<T>(task: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkDatabase(): Promise<HealthCheckResult> {
  const started = Date.now();
  try {
    const conn = getDb();
    try {
      await withTimeout(conn.db.execute('SELECT 1'), CHECK_TIMEOUT_MS);
      return { ok: true, message: 'database reachable', latencyMs: Date.now() - started };
    } finally {
      await conn.close().catch(() => undefined);
    }
  } catch (error) {
    // No connection string in the message — credentials must never leak here.
    return {
      ok: false,
      message: `database unavailable: ${detailOf(error)}`,
      latencyMs: Date.now() - started,
    };
  }
}

async function checkStorage(): Promise<HealthCheckResult> {
  try {
    const dir = resolveStorageDir();
    const storage = new FilesystemAttachmentStorage(dir);
    const key = `__health__/${randomUUID()}`;
    await withTimeout(
      storage.put(key, new TextEncoder().encode('silapor-health-probe'), 'text/plain'),
      CHECK_TIMEOUT_MS,
    );
    try {
      await storage.remove(key);
    } catch {
      // Probe cleanup is best-effort; the writability proof already succeeded.
    }
    return { ok: true, message: `storage writable at ${dir}` };
  } catch (error) {
    return { ok: false, message: `storage unavailable: ${detailOf(error)}` };
  }
}

async function checkQueue(): Promise<HealthCheckResult> {
  try {
    const queue = new MemoryQueue();
    await queue.publish({
      id: `health-${randomUUID()}`,
      type: 'NOTIFICATION_DISPATCH',
      payload: {},
      createdAt: new Date().toISOString(),
    });
    return {
      ok: true,
      message: 'queue memory stub ok (no broker wired; outbox consumer deferred)',
    };
  } catch (error) {
    return { ok: false, message: `queue unavailable: ${detailOf(error)}` };
  }
}

async function checkWorker(): Promise<HealthCheckResult> {
  try {
    const file = resolveWorkerBeatFile();
    const beat = await readWorkerBeat(file);
    if (beat === null) {
      return {
        ok: false,
        message: `worker beat not found at ${file} (worker not running; pilot placeholder)`,
      };
    }
    const ageMs = workerBeatAgeMs(beat);
    if (!Number.isFinite(ageMs) || ageMs < 0) {
      return { ok: false, message: 'worker beat timestamp invalid' };
    }
    if (ageMs <= WORKER_BEAT_MAX_AGE_MS) {
      return { ok: true, message: `worker beat fresh (${Math.round(ageMs)}ms ago)` };
    }
    return {
      ok: false,
      message: `worker beat stale (${Math.round(ageMs)}ms ago; threshold ${WORKER_BEAT_MAX_AGE_MS}ms)`,
    };
  } catch (error) {
    return { ok: false, message: `worker unavailable: ${detailOf(error)}` };
  }
}

export async function checkHealth(): Promise<HealthResult> {
  try {
    const [database, storage, queue, worker] = await Promise.all([
      checkDatabase(),
      checkStorage(),
      checkQueue(),
      checkWorker(),
    ]);
    return {
      ok: database.ok && storage.ok && queue.ok && worker.ok,
      service: 'web',
      checks: { database, storage, queue, worker },
    };
  } catch (error) {
    // Absolute last resort: this module never throws, even on programmer error.
    const fallback: HealthCheckResult = { ok: false, message: `health failed: ${detailOf(error)}` };
    return {
      ok: false,
      service: 'web',
      checks: { database: fallback, storage: fallback, queue: fallback, worker: fallback },
    };
  }
}
