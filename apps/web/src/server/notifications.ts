// Notification server transport service (Phase 6 P6-5b; mirrors `./reports.ts`).
// Thin: `requireUser` guards (defense in depth — routes guard too), one
// database connection, delegate to the repo in `@silapor/database`, close the
// connection. Repo `AppError`s propagate untouched for routes to map with
// `toHttpResponse` — an unknown or foreign notification id is the repo's
// byte-identical 404. Admins get their own (always empty) list; the mapper
// never creates admin notifications. This module logs nothing — routes log
// with opaque IDs via `redact()`.
import {
  listNotificationsForUser as repoListNotificationsForUser,
  markAllNotificationsRead as repoMarkAllNotificationsRead,
  markNotificationRead as repoMarkNotificationRead,
  getDb,
  type NotificationListResult,
} from '@silapor/database';
import { requireUser } from './auth';

export async function getMyNotificationsRoute(req: Request): Promise<NotificationListResult> {
  const user = await requireUser(req);
  const conn = getDb();
  try {
    return await repoListNotificationsForUser(conn.db, user.id);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function markMyNotificationReadRoute(
  req: Request,
  notificationId: string,
): Promise<void> {
  const user = await requireUser(req);
  const conn = getDb();
  try {
    await repoMarkNotificationRead(conn.db, user.id, notificationId);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export interface MarkAllNotificationsReadResult {
  /** Rows transitioned unread→read (0 when nothing was unread). */
  readonly updated: number;
}

export async function markMyNotificationsAllReadRoute(
  req: Request,
): Promise<MarkAllNotificationsReadResult> {
  const user = await requireUser(req);
  const conn = getDb();
  try {
    return { updated: await repoMarkAllNotificationsRead(conn.db, user.id) };
  } finally {
    await conn.close().catch(() => undefined);
  }
}
