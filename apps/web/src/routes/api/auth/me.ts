// Current-user route (Phase 2 P2-3): GET /api/auth/me.
//
// Reads the session cookie, resolves it through `resolveSessionUser`
// (unexpired + unrevoked + locally active user), and returns the minimal
// public shape { user:{ id, username, role } } — no external IDs, NIMs, or
// hashes. Missing/invalid sessions get 401 { code:'UNAUTHORIZED',
// message:'Belum login' } with no further detail.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE, hashSessionToken, resolveSessionUser } from '@silapor/auth';
import { findSessionByTokenHash, getDb, users } from '@silapor/database';
import { createLogger, redact, withRequestId } from '@silapor/shared';

const logger = createLogger({ service: 'web' });

function parseSessionToken(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader === '') {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          const token = parseSessionToken(request.headers.get('cookie'));
          if (token === null) {
            return Response.json(
              { error: { code: 'UNAUTHORIZED', message: 'Belum login' } },
              { status: 401 },
            );
          }
          const conn = getDb();
          try {
            const session = await findSessionByTokenHash(conn.db, hashSessionToken(token));
            const userRows =
              session === undefined
                ? []
                : await conn.db.select().from(users).where(eq(users.id, session.userId));
            const userRow = userRows[0] ?? null;
            const resolved = resolveSessionUser(session, userRow, new Date());
            if (resolved === null) {
              logger.warn('me rejected', {
                route: '/api/auth/me',
                code: 'UNAUTHORIZED',
                durationMs: Date.now() - started,
              });
              return Response.json(
                { error: { code: 'UNAUTHORIZED', message: 'Belum login' } },
                { status: 401 },
              );
            }
            logger.info('me resolved', {
              route: '/api/auth/me',
              result: 'ok',
              durationMs: Date.now() - started,
              details: redact({ userRef: resolved.id }),
            });
            return Response.json(
              { user: { id: resolved.id, username: resolved.username, role: resolved.role } },
              { status: 200 },
            );
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            logger.error('me failed', {
              route: '/api/auth/me',
              code: 'INTERNAL',
              durationMs: Date.now() - started,
              details: { detail },
            });
            return Response.json(
              { error: { code: 'INTERNAL', message: 'Internal server error' } },
              { status: 500 },
            );
          } finally {
            await conn.close().catch(() => undefined);
          }
        }),
    },
  },
});
