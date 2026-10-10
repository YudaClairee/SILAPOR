// Queue contract (Task 3).
//
// Pilot note: local-first. The durable outbox table (`outbox_events`) lands in
// Task 4 (Drizzle); this module only owns the message contract shared by
// producers (apps/web) and the consumer (apps/worker). Types only — no DB,
// broker, or cloud imports.

export type QueueMessageType = 'AI_REVIEW_REQUESTED' | 'NOTIFICATION_DISPATCH';

export interface QueueMessagePayload {
  readonly analysisId?: string;
  readonly reportId?: string;
  readonly eventId?: string;
}

export interface QueueMessage {
  readonly id: string;
  readonly type: QueueMessageType;
  readonly payload: QueueMessagePayload;
  readonly createdAt: string;
}

export interface QueuePort {
  publish(message: QueueMessage): Promise<void>;
}

export type OutboxStatus = 'PENDING' | 'DISPATCHED' | 'FAILED';
