// File-based worker beat placeholder (Task 5). Node-only pilot.
//
// The web app and the worker run as SEPARATE Node processes, so an
// in-memory export cannot be shared across them. The worker records a small
// JSON beat file (`{ beatAt, pid }` — no secrets, no payloads); the web
// health check reads it and reports fresh/stale/missing. The in-process
// `lastBeat` export on the worker side (`getWorkerHealth()` in
// `apps/worker/src/index.ts`) covers same-process consumers.
//
// Operations note: the default path is cwd-relative (`./.data/worker-beat.json`,
// git-ignored like the storage default). Run both processes from the repo
// root in the pilot, or set `WORKER_BEAT_FILE` to a shared ABSOLUTE path.
// A beat older than `WORKER_BEAT_MAX_AGE_MS` counts as stale.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const WORKER_BEAT_ENV = 'WORKER_BEAT_FILE';
export const DEFAULT_WORKER_BEAT_FILE = './.data/worker-beat.json';
// Placeholder threshold until the real broker loop defines liveness SLOs.
export const WORKER_BEAT_MAX_AGE_MS = 5 * 60 * 1000;

export interface WorkerBeat {
  readonly beatAt: string;
  readonly pid?: number;
}

export function resolveWorkerBeatFile(explicit?: string): string {
  const candidate = explicit ?? process.env[WORKER_BEAT_ENV];
  if (candidate === undefined || candidate.trim().length === 0) {
    return DEFAULT_WORKER_BEAT_FILE;
  }
  return candidate;
}

export async function recordWorkerBeat(file?: string): Promise<WorkerBeat> {
  const target = resolveWorkerBeatFile(file);
  const beat: WorkerBeat = { beatAt: new Date().toISOString(), pid: process.pid };
  await mkdir(path.dirname(path.resolve(target)), { recursive: true });
  await writeFile(target, JSON.stringify(beat), 'utf8');
  return beat;
}

// Returns `null` for missing, unreadable, or malformed beat files — never throws.
export async function readWorkerBeat(file?: string): Promise<WorkerBeat | null> {
  try {
    const raw = await readFile(resolveWorkerBeatFile(file), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const beatAt = (parsed as { beatAt?: unknown }).beatAt;
    if (typeof beatAt !== 'string' || !Number.isFinite(Date.parse(beatAt))) {
      return null;
    }
    const pid = (parsed as { pid?: unknown }).pid;
    return typeof pid === 'number' && Number.isSafeInteger(pid) ? { beatAt, pid } : { beatAt };
  } catch {
    return null;
  }
}

export function workerBeatAgeMs(beat: WorkerBeat, now: number = Date.now()): number {
  return now - Date.parse(beat.beatAt);
}
