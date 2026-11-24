import { describe, expect, it, vi } from 'vitest';
import { MockPhotoModerator, moderatePhoto, type ModeratePhotoInput } from './moderate-photo.js';

const input: ModeratePhotoInput = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  mimeType: 'image/jpeg',
};

const opts = { timeoutMs: 1000, model: 'google/gemini-2.5-flash', apiKey: 'test-key' };

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
  return {
    id: 'gen-1',
    provider: 'Google',
    usage: { prompt_tokens: 120, completion_tokens: 18, cost: 0.0001 },
    choices: [{ message: { content: JSON.stringify(verdict) } }],
  };
}

describe('moderatePhoto', () => {
  it('fails open (SKIPPED) without calling fetch when credentials, model, or input are invalid', async () => {
    const fetchSpy = vi.fn(hangingFetch);
    expect(await moderatePhoto(input, { timeoutMs: 1000, model: 'google/gemini-2.5-flash', fetch: fetchSpy })).toEqual({
      kind: 'SKIPPED',
    });
    expect(await moderatePhoto(input, { timeoutMs: 1000, apiKey: 'test-key', fetch: fetchSpy })).toEqual({
      kind: 'SKIPPED',
    });
    expect(await moderatePhoto(input, { ...opts, model: 'openrouter/auto', fetch: fetchSpy })).toEqual({
      kind: 'SKIPPED',
    });
    expect(await moderatePhoto(input, { ...opts, model: 'vendor/model:latest', fetch: fetchSpy })).toEqual({
      kind: 'SKIPPED',
    });
    expect(await moderatePhoto(input, { ...opts, timeoutMs: 0, fetch: fetchSpy })).toEqual({
      kind: 'SKIPPED',
    });
    expect(await moderatePhoto({ bytes: new Uint8Array(), mimeType: 'image/jpeg' }, { ...opts, fetch: fetchSpy })).toEqual({
      kind: 'SKIPPED',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails open (SKIPPED) on timeouts, network errors, HTTP errors, and malformed responses', async () => {
    expect(await moderatePhoto(input, { ...opts, timeoutMs: 5, fetch: hangingFetch })).toEqual({
      kind: 'SKIPPED',
    });
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await moderatePhoto(input, { ...opts, fetch: failing })).toEqual({ kind: 'SKIPPED' });
    for (const status of [400, 401, 404, 429, 500, 503]) {
      expect(await moderatePhoto(input, { ...opts, fetch: jsonFetch(status, { error: 'err' }) })).toEqual({
        kind: 'SKIPPED',
      });
    }
    expect(await moderatePhoto(input, { ...opts, fetch: jsonFetch(200, {}) })).toEqual({
      kind: 'SKIPPED',
    });
    expect(
      await moderatePhoto(input, {
        ...opts,
        fetch: jsonFetch(200, { choices: [{ message: { content: 'not json' } }] }),
      }),
    ).toEqual({ kind: 'SKIPPED' });
    expect(
      await moderatePhoto(input, {
        ...opts,
        fetch: jsonFetch(200, verdictBody({ decision: 'MAYBE' })),
      }),
    ).toEqual({ kind: 'SKIPPED' });
    // Contradictory REJECT + SAFE fails open to avoid false rejections.
    expect(
      await moderatePhoto(input, {
        ...opts,
        fetch: jsonFetch(200, verdictBody({ decision: 'REJECT', category: 'SAFE', reason: 'Uncertain' })),
      }),
    ).toEqual({ kind: 'SKIPPED' });
  });

  it('returns ALLOW for valid maintenance photos (including fenced JSON)', async () => {
    const out = await moderatePhoto(input, {
      ...opts,
      fetch: jsonFetch(200, {
        id: 'gen-allow',
        choices: [{ message: { content: '```json\n{"decision":"ALLOW","category":"SAFE"}\n```' } }],
      }),
    });
    expect(out).toEqual({
      kind: 'ALLOW',
      model: 'google/gemini-2.5-flash',
      meta: { gatewayRequestId: 'gen-allow' },
    });
  });

  it('returns REJECT with category and meta for prohibited or non-report photos', async () => {
    for (const category of [
      'NSFW_OR_VIOLENCE',
      'SELFIE_OR_PORTRAIT',
      'MEME_OR_SCREENSHOT',
      'OFF_TOPIC_PERSONAL',
    ] as const) {
      const out = await moderatePhoto(input, {
        ...opts,
        fetch: jsonFetch(200, verdictBody({ decision: 'REJECT', category, reason: `Detected ${category}` })),
      });
      expect(out).toEqual({
        kind: 'REJECT',
        category,
        reason: `Detected ${category}`,
        model: 'google/gemini-2.5-flash',
        meta: {
          gatewayRequestId: 'gen-1',
          upstreamProvider: 'Google',
          inputTokens: 120,
          outputTokens: 18,
          estimatedCost: 0.0001,
        },
      });
    }
  });

  it('sends base64 image_url, deterministic JSON settings, and strict ZDR provider policy', async () => {
    let capturedHeaders: RequestInit['headers'];
    let capturedBody: Record<string, unknown> | undefined;
    const captureFetch = (async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(verdictBody({ decision: 'ALLOW', category: 'SAFE' })), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    await moderatePhoto(input, { ...opts, fetch: captureFetch });
    expect((capturedHeaders as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    expect(capturedBody?.['model']).toBe('google/gemini-2.5-flash');
    expect(capturedBody?.['temperature']).toBe(0);
    expect(capturedBody?.['response_format']).toEqual({ type: 'json_object' });
    expect(capturedBody?.['provider']).toEqual({
      data_collection: 'deny',
      zdr: true,
      require_parameters: true,
      allow_fallbacks: false,
    });
    const messages = capturedBody?.['messages'] as Array<{ role: string; content: unknown }>;
    expect(messages).toHaveLength(2);
    const userContent = messages[1]?.content as Array<{ type: string; image_url?: { url: string } }>;
    const expectedB64 = Buffer.from(input.bytes).toString('base64');
    expect(userContent[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${expectedB64}` },
    });
  });
});

describe('MockPhotoModerator', () => {
  it('replays canned outcomes and defaults to SKIPPED', async () => {
    const mock = new MockPhotoModerator([
      { kind: 'REJECT', category: 'MEME_OR_SCREENSHOT', reason: 'meme', model: 'm' },
    ]);
    expect(await mock.moderate(input, opts)).toMatchObject({ kind: 'REJECT', category: 'MEME_OR_SCREENSHOT' });
    expect(await mock.moderate(input, opts)).toEqual({ kind: 'SKIPPED' });
    expect(mock.calls).toHaveLength(2);
  });
});
