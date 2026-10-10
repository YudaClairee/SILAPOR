// Drizzle schema foundation (Task 4).
//
// Minimal tables only: `users` + `outbox_events`. The full §7 entity set
// (locations, categories, assets, reports, …) lands in Phase 2; this file
// exists to prove the migration chain works end to end.

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['REPORTER', 'ADMIN']);

export const outboxStatusEnum = pgEnum('outbox_status', ['PENDING', 'DISPATCHED', 'FAILED']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  // Login identity: NIM (students), NIP (staff), or other official campus ID.
  // No name/email stored in this phase (Phase 0 §1, simplified 2026-10-10).
  username: text('username').notNull().unique(),
  role: userRoleEnum('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [index('outbox_events_status_available_at_idx').on(table.status, table.availableAt)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
