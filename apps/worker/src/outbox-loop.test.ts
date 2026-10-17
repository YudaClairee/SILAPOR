import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BATCH_LIMIT,
  DEFAULT_POLL_INTERVAL_MS,
  MAX_BATCH_LIMIT,
  MIN_POLL_INTERVAL_MS,
  normalizeOutboxLoopOptions,
} from './outbox-loop.js';

describe('normalizeOutboxLoopOptions', () => {
  it('applies the documented defaults', () => {
    expect(normalizeOutboxLoopOptions()).toEqual({
      pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
      batchLimit: DEFAULT_BATCH_LIMIT,
    });
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(2_000);
    expect(DEFAULT_BATCH_LIMIT).toBe(20);
  });

  it('clamps the poll interval to a safe floor and the batch limit to 1..100', () => {
    expect(normalizeOutboxLoopOptions({ pollIntervalMs: 0 }).pollIntervalMs).toBe(
      MIN_POLL_INTERVAL_MS,
    );
    expect(normalizeOutboxLoopOptions({ pollIntervalMs: -5 }).pollIntervalMs).toBe(
      MIN_POLL_INTERVAL_MS,
    );
    expect(normalizeOutboxLoopOptions({ batchLimit: 0 }).batchLimit).toBe(1);
    expect(normalizeOutboxLoopOptions({ batchLimit: 1_000 }).batchLimit).toBe(MAX_BATCH_LIMIT);
    expect(normalizeOutboxLoopOptions({ batchLimit: 55 }).batchLimit).toBe(55);
  });

  it('falls back to defaults on non-finite input', () => {
    expect(normalizeOutboxLoopOptions({ pollIntervalMs: Number.NaN }).pollIntervalMs).toBe(
      DEFAULT_POLL_INTERVAL_MS,
    );
    expect(normalizeOutboxLoopOptions({ batchLimit: Number.NaN }).batchLimit).toBe(
      DEFAULT_BATCH_LIMIT,
    );
  });
});
