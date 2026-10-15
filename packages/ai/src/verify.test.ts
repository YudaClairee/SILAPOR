import { describe, expect, it, vi } from 'vitest';
import { MockVerifyAssistant, verifyReport, type VerifyInput } from './verify.js';

const input: VerifyInput = {
  description: 'Water leaking under the sink in room A101.',
  asset: { name: 'Sink faucet', category: 'PLUMBING', building: 'Gedung A', floor: '1', room: 'A101' },
  photos: [{ storageKey: 'reports/123/photo-1.jpg' }],
  categories: ['PLUMBING', 'HVAC'],
  issueTypes: ['LEAKING', 'BROKEN'],
};

const opts = { timeoutMs: 1000, model: 'anthropic/claude-3.5-sonnet', apiKey: 'test-key' };

const hangingFetch = ((_url: unknown, init?: { signal?: AbortSignal | null }) =>
  new Promise<never>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('The operation was aborted.', 'AbortError')),
    );
  })) as unknown as typeof fetch;

function jsonFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

function verdictBody(verdict: unknown): unknown {
  return { choices: [{ message: { content: JSON.stringify(verdict) } }] };
}

describe('verifyReport', () => {
  it('maps timeout to DOWN, never to FAIL', async () => {
    const out = await verifyReport(input, { timeoutMs: 5, fetch: hangingFetch });
    expect(out).toEqual({ kind: 'DOWN' });
  });

  it('maps 5xx to DOWN', async () => {
    const out = await verifyReport(input, { ...opts, fetch: jsonFetch(500, { error: 'boom' }) });
    expect(out).toEqual({ kind: 'DOWN' });
  });

  it('maps 429 to DOWN', async () => {
    const out = await verifyReport(input, { ...opts, fetch: jsonFetch(429, { error: 'slow down' }) });
    expect(out).toEqual({ kind: 'DOWN' });
  });

  it('maps network errors to DOWN', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const out = await verifyReport(input, { ...opts, fetch: failing });
    expect(out).toEqual({ kind: 'DOWN' });
  });

  it('maps 4xx and auth rejections to FAIL, never to DOWN', async () => {
    for (const status of [400, 401, 403, 404]) {
      const out = await verifyReport(input, { ...opts, fetch: jsonFetch(status, { error: 'no' }) });
      expect(out.kind).toBe('FAIL');
    }
  });

  it('maps invalid envelopes to FAIL', async () => {
    const empty = await verifyReport(input, { ...opts, fetch: jsonFetch(200, {}) });
    expect(empty.kind).toBe('FAIL');
    const garbage = await verifyReport(
      input,
      { ...opts, fetch: jsonFetch(200, { choices: [{ message: { content: 'not json' } }] }) },
    );
    expect(garbage.kind).toBe('FAIL');
  });

  it('rejects disallowed model slugs as FAIL without calling fetch', async () => {
    for (const model of ['openrouter/auto', 'some-model:latest']) {
      const fetch = vi.fn(hangingFetch);
      const out = await verifyReport(input, { ...opts, model, fetch });
      expect(out.kind).toBe('FAIL');
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('maps a blank-model upstream rejection to FAIL', async () => {
    const out = await verifyReport(input, { ...opts, model: '', fetch: jsonFetch(400, { error: 'no model' }) });
    expect(out.kind).toBe('FAIL');
  });

  it('returns raw PASS codes with model, confidence, and reasons', async () => {
    const out = await verifyReport(
      { ...input, categories: ['HVAC'] },
      {
        ...opts,
        fetch: jsonFetch(
          200,
          verdictBody({
            verdict: 'PASS',
            category: 'PLUMBING',
            issueType: 'LEAKING',
            priority: 'HIGH',
            confidence: 0.9,
            reasons: ['photo shows active leak'],
          }),
        ),
      },
    );
    expect(out).toEqual({
      kind: 'PASS',
      category: 'PLUMBING',
      issueType: 'LEAKING',
      priority: 'HIGH',
      confidence: 0.9,
      reasons: ['photo shows active leak'],
      model: opts.model,
      promptVersion: 'v1',
      schemaVersion: 'v1',
    });
  });

  it('maps model FAIL verdicts to FAIL with the model reason', async () => {
    const out = await verifyReport(
      input,
      {
        ...opts,
        fetch: jsonFetch(200, verdictBody({ verdict: 'FAIL', reason: 'Photo is blurry, retake in daylight.' })),
      },
    );
    expect(out).toEqual({ kind: 'FAIL', reason: 'Photo is blurry, retake in daylight.', model: opts.model });
  });

  it('sends ZDR routing and the pinned model without reporter PII', async () => {
    let seen: { url: unknown; body: Record<string, unknown> } | undefined;
    const spy = (async (url: unknown, init?: { body?: unknown }) => {
      seen = { url, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
      return new Response(
        JSON.stringify(verdictBody({ verdict: 'FAIL', reason: 'Unclear.' })),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    await verifyReport(input, { ...opts, fetch: spy });
    expect(String(seen?.url)).toBe('https://openrouter.ai/api/v1/chat/completions');
    const body = seen?.body as unknown as Record<string, unknown>;
    expect(body['model']).toBe(opts.model);
    expect(body['provider']).toEqual({
      data_collection: 'deny',
      zdr: true,
      require_parameters: true,
      allow_fallbacks: false,
    });
    expect(JSON.stringify(body)).not.toContain('test-key');
  });
});

describe('MockVerifyAssistant', () => {
  it('returns canned PASS, FAIL, and DOWN deterministically', async () => {
    const pass = new MockVerifyAssistant({
      kind: 'PASS',
      category: 'PLUMBING',
      issueType: 'LEAKING',
      priority: 'HIGH',
      confidence: 1,
      reasons: ['canned'],
      model: 'mock',
      promptVersion: 'v1',
      schemaVersion: 'v1',
    });
    expect((await pass.verify(input, { timeoutMs: 5 })).kind).toBe('PASS');
    const fail = new MockVerifyAssistant({ kind: 'FAIL', reason: 'canned fail' });
    expect(await fail.verify(input, { timeoutMs: 5 })).toEqual({ kind: 'FAIL', reason: 'canned fail' });
    const down = new MockVerifyAssistant({ kind: 'DOWN' });
    expect(await down.verify(input, { timeoutMs: 5 })).toEqual({ kind: 'DOWN' });
    expect(down.calls).toHaveLength(1);
  });
});
