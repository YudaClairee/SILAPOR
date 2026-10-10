// Logout route (Phase 2 P2-3): POST /api/auth/logout.
//
// Best-effort revocation: the session cookie (if any) is hashed and the
// matching row revoked, but the response always clears the cookie and
// returns 200 { ok:true } — even with no cookie — so logout never leaks
// whether a session existed. Never logs tokens or token hashes raw.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { SESSION_COOKIE, clearSessionCookieHeader, hashSessionToken } from '@silapor/auth';
import { findSessionByTokenHash, getDb, revokeSession } from '@silapor/database';
import { createLogger, withRequestId } from '@silapor/shared';

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

export const Route = createFileRoute('/api/auth/logout')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          const token = parseSessionToken(request.headers.get('cookie'));
          if (token !== null) {
            const conn = getDb();
            try {
              const session = await findSessionByTokenHash(conn.db, hashSessionToken(token));
              if (session !== undefined && session.revokedAt === null) {
                await revokeSession(conn.db, session.id);
              }
            } catch (error) {
              // Revocation is best-effort: log and still clear the cookie.
              const detail = error instanceof Error ? error.message : String(error);
              logger.warn('logout revocation failed', {
                route: '/api/auth/logout',
                code: 'INTERNAL',
                durationMs: Date.now() - started,
                details: { detail },
              });
            } finally {
              await conn.close().catch(() => undefined);
            }
          }
          logger.info('logout complete', {
            route: '/api/auth/logout',
            result: 'ok',
            durationMs: Date.now() - started,
          });
          return Response.json(
            { ok: true },
            { status: 200, headers: { 'Set-Cookie': clearSessionCookieHeader() } },
          );
        }),
    },
  },
});
