export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export interface VerifyMeta {
  readonly gatewayRequestId?: string;
  readonly upstreamProvider?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly estimatedCost?: number;
  // HTTP status of a gateway-side rejection (no envelope parsed). Diagnostic
  // only: it explains a 422 in the logs (401 bad key, 402 no credit, 404 no
  // endpoint matching the routing policy) without leaking provider free text.
  readonly upstreamStatus?: number;
}

export function isDisallowedModel(model: string): boolean {
  const slug = model.toLowerCase();
  // Slugs match only on exact boundaries: `openrouter/auto` (the auto-router)
  // and any model whose last `/`- or `:`-separated segment is exactly
  // `latest` (unpinned alias tags like `vendor/model:latest`). Legit slugs
  // that merely contain the substring (e.g. `vendor/autonomous-x`) pass.
  const lastSegment = slug.split(/[:/]/).pop() ?? '';
  return slug === 'openrouter/auto' || lastSegment === 'latest';
}

// `response_format: json_object` is normally enough, but providers occasionally
// wrap the object in a markdown fence or a short preamble. Extract the
// outermost `{...}` before parsing so a formatting quirk does not discard an
// otherwise valid verdict; text without braces stays untouched and still fails.
export function extractJsonObject(content: string): string {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  return start === -1 || end <= start ? content : content.slice(start, end + 1);
}

export function extractContent(envelope: unknown): string | undefined {
  if (typeof envelope !== 'object' || envelope === null) {
    return undefined;
  }
  const choices = (envelope as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return undefined;
  }
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .filter(
        (part): part is { type: string; text: string } => typeof part === 'object' && part !== null,
      )
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return text === '' ? undefined : text;
  }
  return undefined;
}

export function extractMeta(envelope: unknown): VerifyMeta | undefined {
  if (typeof envelope !== 'object' || envelope === null) return undefined;
  const record = envelope as Record<string, unknown>;
  const meta: {
    gatewayRequestId?: string;
    upstreamProvider?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  } = {};
  const id = record['id'];
  if (typeof id === 'string' && id.trim() !== '') meta.gatewayRequestId = id.trim();
  const provider = record['provider'];
  if (typeof provider === 'string' && provider.trim() !== '')
    meta.upstreamProvider = provider.trim();
  const usage = record['usage'];
  if (typeof usage === 'object' && usage !== null) {
    const u = usage as Record<string, unknown>;
    const promptTokens = u['prompt_tokens'];
    if (typeof promptTokens === 'number' && Number.isFinite(promptTokens))
      meta.inputTokens = promptTokens;
    const completionTokens = u['completion_tokens'];
    if (typeof completionTokens === 'number' && Number.isFinite(completionTokens))
      meta.outputTokens = completionTokens;
    const cost = u['cost'];
    if (typeof cost === 'number' && Number.isFinite(cost)) meta.estimatedCost = cost;
  }
  return Object.keys(meta).length === 0 ? undefined : meta;
}

export interface OpenRouterChatRequest {
  readonly model: string;
  readonly messages: ReadonlyArray<Record<string, unknown>>;
  readonly timeoutMs: number;
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

export type OpenRouterJsonResult =
  | { readonly kind: 'OK'; readonly raw: unknown; readonly meta?: VerifyMeta }
  | { readonly kind: 'TRANSIENT_DOWN' }
  | { readonly kind: 'UPSTREAM_REJECTED'; readonly upstreamStatus?: number; readonly meta?: VerifyMeta };

/**
 * Calls OpenRouter chat completions with deterministic JSON output and strict ZDR routing.
 */
export async function callOpenRouterJson(req: OpenRouterChatRequest): Promise<OpenRouterJsonResult> {
  const fetchImpl = req.fetch ?? fetch;
  const endpoint = req.endpoint ?? OPENROUTER_ENDPOINT;
  const body = {
    model: req.model,
    // Deterministic structured extraction: low-variance decoding keeps JSON mode valid.
    temperature: 0,
    messages: req.messages,
    response_format: { type: 'json_object' },
    usage: { include: true },
    // Zero-retention routing required on every request.
    provider: {
      data_collection: 'deny',
      zdr: true,
      require_parameters: true,
      allow_fallbacks: false,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(req.apiKey === undefined ? {} : { Authorization: `Bearer ${req.apiKey}` }),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    return { kind: 'TRANSIENT_DOWN' };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429 || response.status >= 500) {
    return { kind: 'TRANSIENT_DOWN' };
  }
  if (!response.ok) {
    return { kind: 'UPSTREAM_REJECTED', upstreamStatus: response.status };
  }
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    return { kind: 'UPSTREAM_REJECTED' };
  }
  const meta = extractMeta(envelope);
  const content = extractContent(envelope);
  if (content === undefined) {
    return meta === undefined ? { kind: 'UPSTREAM_REJECTED' } : { kind: 'UPSTREAM_REJECTED', meta };
  }
  try {
    const raw = JSON.parse(extractJsonObject(content)) as unknown;
    return meta === undefined ? { kind: 'OK', raw } : { kind: 'OK', raw, meta };
  } catch {
    return meta === undefined ? { kind: 'UPSTREAM_REJECTED' } : { kind: 'UPSTREAM_REJECTED', meta };
  }
}
