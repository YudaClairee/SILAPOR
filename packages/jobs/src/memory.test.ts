import { describe, expect, it } from 'vitest';
import { MemoryQueue } from './memory.js';
import type { QueueMessage } from './types.js';

function makeMessage(id: string): QueueMessage {
  return {
    id,
    type: 'AI_REVIEW_REQUESTED',
    payload: { reportId: id },
    createdAt: new Date().toISOString(),
  };
}

describe('MemoryQueue', () => {
  it('starts empty, tracks size on publish, and reads back in order', async () => {
    const queue = new MemoryQueue();
    expect(queue.size).toBe(0);
    expect(queue.published).toEqual([]);

    await queue.publish(makeMessage('m-1'));
    await queue.publish(makeMessage('m-2'));

    expect(queue.size).toBe(2);
    expect(queue.published.map((m) => m.id)).toEqual(['m-1', 'm-2']);
    expect(queue.published[0]?.payload).toEqual({ reportId: 'm-1' });
  });

  it('clear() empties the queue', async () => {
    const queue = new MemoryQueue();
    await queue.publish(makeMessage('m-1'));
    expect(queue.size).toBe(1);
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.published).toEqual([]);
  });
});
