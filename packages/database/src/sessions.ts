// Session repository (Phase 2 P2-3). Drizzle queries over the P2-1
// `sessions` table; the auth package stays dependency-free and the web
// layer injects `db` plus these functions for login/logout/me.
//
// Only hashes are stored — callers pass `hashSessionToken(raw)` output,
// never the raw token. No raw SQL; `eq()` only.

import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { internal } from '@silapor/shared';
import * as schema from './schema.js';

type Database = PostgresJsDatabase<typeof schema>;

export interface CreateSessionInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export async function createSession(
  db: Database,
  input: CreateSessionInput,
): Promise<typeof schema.sessions.$inferSelect> {
  const rows = await db
    .insert(schema.sessions)
    .values({ userId: input.userId, tokenHash: input.tokenHash, expiresAt: input.expiresAt })
    .returning();
  const row = rows[0];
  if (row === undefined) {
    throw internal('Failed to create session');
  }
  return row;
}

export async function findSessionByTokenHash(
  db: Database,
  tokenHash: string,
): Promise<typeof schema.sessions.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash));
  return rows[0];
}

export async function revokeSession(db: Database, id: string): Promise<void> {
  await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(eq(schema.sessions.id, id));
}

export async function touchLastLogin(db: Database, userId: string): Promise<void> {
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
}
