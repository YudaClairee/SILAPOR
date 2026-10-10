import { describe, expect, it } from 'vitest';
import { redact } from './logging.js';

describe('redact', () => {
  it('masks password, token, email, and nim while keeping benign keys', () => {
    const input = {
      password: 'hunter2',
      token: 'tok-abc-123',
      email: 'reporter@upi.ac.id',
      nim: '230001',
      name: 'Reporter Satu',
      count: 42,
    };
    const out = redact(input);
    expect(out.password).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    expect(out.email).toBe('[REDACTED]');
    expect(out.nim).toBe('[REDACTED]');
    expect(out.name).toBe('Reporter Satu');
    expect(out.count).toBe(42);
  });

  it('masks nested objects and arrays without mutating benign leaves', () => {
    const input = {
      user: { name: 'Admin', email: 'admin@mock.upi.ac.id', role: 'ADMIN' },
      tags: ['operational', 'verified'],
      nested: { items: [{ accessToken: 'secret-1' }, { label: 'ok' }] },
    };
    const out = redact(input);
    expect(out.user.email).toBe('[REDACTED]');
    expect(out.user.name).toBe('Admin');
    expect(out.tags).toEqual(['operational', 'verified']);
    expect(out.nested.items[0]).toEqual({ accessToken: '[REDACTED]' });
    expect(out.nested.items[1]).toEqual({ label: 'ok' });
  });

  it('does not false-positive on benign keys containing auth as a substring', () => {
    const out = redact({ author: 'umi', name: 'ok' });
    expect(out.author).toBe('umi');
    expect(out.name).toBe('ok');
  });
});
