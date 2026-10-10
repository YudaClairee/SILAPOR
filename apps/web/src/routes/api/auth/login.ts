// Login route (Phase 2 P2-3): POST /api/auth/login.
//
// Composition point: pure helpers from `@silapor/auth` (SSO resolution,
// session token/cookie, rate limiting) sequenced with the drizzle session
// repository from `@silapor/database`. Auth never imports the database —
// this route injects `db` into both.
//
// Flow: validate username (generic 400) → rate-limit check (429) → SSO
// resolve → null/inactive → 401 + count failure → load-or-create local user
// (local is_active is the enforcement point) → store session hash →
// touch last login → clear attempts → Set-Cookie + 200 { user }.
//
// Secrecy rule: generic messages everywhere (no user enumeration); the
// `password` body field is accepted-but-ignored for future UPI compat and
// never logged. Logs carry only opaque user IDs and session hash prefixes
// via neutral `redact()`-safe keys — never usernames, NIMs, or tokens.
import { createFileRoute } from '@tanstack/react-router';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  SESSION_TTL_MS,
  checkLoginRateLimit,
  clearLoginAttempt,
  createSessionToken,
  getSsoProvider,
  hashSessionToken,
  loginRateLimitKey,
  noteLoginFailure,
  sessionCookieHeader,
  tokenHashPrefix,
} from '@silapor/auth';
import { createSession, getDb, touchLastLogin, users } from '@silapor/database';
import {
  badRequest,
  createLogger,
  getRuntimeConfig,
  redact,
  toHttpResponse,
  withRequestId,
} from '@silapor/shared';

const logger = createLogger({ service: 'web' });

// Single generic message for every credential problem (empty, unknown, or
// inactive) so responses cannot be used to enumerate accounts.
const INVALID_CREDENTIALS_MESSAGE = 'Kredensial salah';

function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const first = forwarded.split(',')[0]?.trim();
    if (first !== undefined && first !== '') {
      return first;
    }
  }
  return 'unknown';
}

// Secure iff the request arrived over https or the server runs in
// production (matches the session helper contract).
function isSecureRequest(request: Request): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto !== null) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  try {
    if (new URL(request.url).protocol === 'https:') {
      return true;
    }
  } catch {
    // Unparseable URL — fall through to the environment check.
  }
  return process.env['NODE_ENV'] === 'production';
}

interface LoginBody {
  readonly username: unknown;
}

function parseUsername(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw badRequest(INVALID_CREDENTIALS_MESSAGE);
  }
  const username = (body as LoginBody).username;
  if (typeof username !== 'string') {
    throw badRequest(INVALID_CREDENTIALS_MESSAGE);
  }
  const trimmed = username.trim();
  if (trimmed === '' || trimmed.length > 128) {
    throw badRequest(INVALID_CREDENTIALS_MESSAGE);
  }
  return trimmed;
}

export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) =>
        withRequestId(randomUUID(), async () => {
          const started = Date.now();
          let body: unknown = null;
          try {
            body = await request.json();
          } catch {
            body = null;
          }
          try {
            const username = parseUsername(body);
            const key = loginRateLimitKey(username, clientIp(request.headers));

            const limit = checkLoginRateLimit(key);
            if (!limit.allowed) {
              logger.warn('login rate limited', {
                route: '/api/auth/login',
                code: 'RATE_LIMITED',
                durationMs: Date.now() - started,
              });
              return Response.json(
                {
                  error: {
                    code: 'RATE_LIMITED',
                    message: 'Terlalu banyak percobaan. Coba lagi nanti.',
                  },
                },
                { status: 429 },
              );
            }

            const provider = getSsoProvider(getRuntimeConfig().authProvider);
            const identity = await provider.resolve(username);
            if (identity === null || !identity.isActive) {
              noteLoginFailure(key);
              logger.warn('login rejected', {
                route: '/api/auth/login',
                code: 'UNAUTHORIZED',
                durationMs: Date.now() - started,
              });
              return Response.json(
                { error: { code: 'UNAUTHORIZED', message: INVALID_CREDENTIALS_MESSAGE } },
                { status: 401 },
              );
            }

            const conn = getDb();
            try {
              const existing = await conn.db
                .select()
                .from(users)
                .where(eq(users.username, identity.username));
              let userRow = existing[0];
              if (userRow === undefined) {
                const inserted = await conn.db
                  .insert(users)
                  .values({
                    username: identity.username,
                    role: identity.role,
                    nim: identity.nim,
                    externalUserId: identity.externalUserId,
                    isActive: true,
                  })
                  .returning();
                const created = inserted[0];
                if (created === undefined) {
                  throw badRequest(INVALID_CREDENTIALS_MESSAGE);
                }
                userRow = created;
              } else if (
                userRow.role !== identity.role ||
                userRow.nim !== identity.nim ||
                userRow.externalUserId !== identity.externalUserId
              ) {
                // Sync mutable SSO fields; is_active stays under local
                // control and is never reactivated here.
                const updated = await conn.db
                  .update(users)
                  .set({
                    role: identity.role,
                    nim: identity.nim,
                    externalUserId: identity.externalUserId,
                    updatedAt: new Date(),
                  })
                  .where(eq(users.id, userRow.id))
                  .returning();
                const synced = updated[0];
                if (synced !== undefined) {
                  userRow = synced;
                }
              }

              if (!userRow.isActive) {
                noteLoginFailure(key);
                logger.warn('login rejected', {
                  route: '/api/auth/login',
                  code: 'UNAUTHORIZED',
                  durationMs: Date.now() - started,
                  details: redact({ userRef: userRow.id }),
                });
                return Response.json(
                  { error: { code: 'UNAUTHORIZED', message: INVALID_CREDENTIALS_MESSAGE } },
                  { status: 401 },
                );
              }

              const token = createSessionToken();
              const tokenHash = hashSessionToken(token);
              await createSession(conn.db, {
                userId: userRow.id,
                tokenHash,
                expiresAt: new Date(Date.now() + SESSION_TTL_MS),
              });
              await touchLastLogin(conn.db, userRow.id);
              clearLoginAttempt(key);

              logger.info('login succeeded', {
                route: '/api/auth/login',
                result: 'ok',
                durationMs: Date.now() - started,
                details: redact({ userRef: userRow.id, sessionRef: tokenHashPrefix(tokenHash) }),
              });
              return Response.json(
                { user: { id: userRow.id, username: userRow.username, role: userRow.role } },
                {
                  status: 200,
                  headers: {
                    'Set-Cookie': sessionCookieHeader(token, { secure: isSecureRequest(request) }),
                  },
                },
              );
            } finally {
              await conn.close().catch(() => undefined);
            }
          } catch (error) {
            const mapped = toHttpResponse(error);
            logger.error('login failed', {
              route: '/api/auth/login',
              code: mapped.body.error.code,
              durationMs: Date.now() - started,
            });
            return Response.json(mapped.body, { status: mapped.status });
          }
        }),
    },
  },
});
