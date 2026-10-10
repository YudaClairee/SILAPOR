import { describe, expect, it } from 'vitest';
import {
  badRequest,
  conflict,
  forbidden,
  internal,
  notFound,
  toHttpResponse,
  unauthorized,
  unavailable,
} from './errors.js';

describe('toHttpResponse', () => {
  it('maps known AppErrors to their status, code, and message', () => {
    expect(toHttpResponse(badRequest('bad input'))).toEqual({
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'bad input' } },
    });
    expect(toHttpResponse(unauthorized())).toEqual({
      status: 401,
      body: { error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } },
    });
    expect(toHttpResponse(forbidden('nope'))).toEqual({
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'nope' } },
    });
    expect(toHttpResponse(notFound())).toEqual({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Not found' } },
    });
    expect(toHttpResponse(conflict())).toEqual({
      status: 409,
      body: { error: { code: 'CONFLICT', message: 'Conflict' } },
    });
    expect(toHttpResponse(unavailable())).toEqual({
      status: 503,
      body: { error: { code: 'UNAVAILABLE', message: 'Service unavailable' } },
    });
    expect(toHttpResponse(internal('boom'))).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'boom' } },
    });
  });

  it('maps unknown throws to generic 500 without leaking internals', () => {
    const secret = new Error('super secret stack with password=hunter2');
    const fromError = toHttpResponse(secret);
    expect(fromError.status).toBe(500);
    expect(fromError.body).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
    expect(JSON.stringify(fromError)).not.toContain('super secret');

    const fromString = toHttpResponse('raw string failure with token=abc');
    expect(fromString.status).toBe(500);
    expect(JSON.stringify(fromString)).not.toContain('raw string failure');

    const fromNull = toHttpResponse(null);
    expect(fromNull).toEqual({
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'Internal server error' } },
    });
  });
});
