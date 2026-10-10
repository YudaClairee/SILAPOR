// In-memory QueuePort for unit tests and local dev (Task 3).
// No I/O, no timers, no external services.
import type { QueueMessage, QueuePort } from './types';

export class MemoryQueue implements QueuePort {
  private readonly messages: QueueMessage[] = [];

  async publish(message: QueueMessage): Promise<void> {
    this.messages.push(message);
  }

  get published(): readonly QueueMessage[] {
    return this.messages;
  }

  get size(): number {
    return this.messages.length;
  }

  clear(): void {
    this.messages.length = 0;
  }
}
