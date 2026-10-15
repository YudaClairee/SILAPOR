import { PROMPT_VERSION, SCHEMA_VERSION, parseVerdict } from './schema.js';

export interface VerifyPhoto {
  readonly storageKey: string;
  readonly contentType?: string;
}

export interface VerifyAsset {
  readonly name: string;
  readonly category: string;
  readonly building?: string;
  readonly floor?: string;
  readonly room?: string;
}

export interface VerifyInput {
  readonly description: string;
  readonly asset: VerifyAsset;
  readonly photos: ReadonlyArray<VerifyPhoto | string>;
  readonly categories: ReadonlyArray<string>;
  readonly issueTypes: ReadonlyArray<string>;
}

export interface VerifyOpts {
  readonly timeoutMs: number;
  readonly model?: string;
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
  readonly promptVersion?: string;
  readonly schemaVersion?: string;
}

export type VerifyOutcome =
  | {
      kind: 'PASS';
      category: string;
      issueType: string;
      priority: string;
      confidence: number;
      reasons: string[];
      model: string;
      promptVersion: string;
      schemaVersion: string;
    }
  | { kind: 'FAIL'; reason: string; model?: string }
  | { kind: 'DOWN' };

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function isDisallowedModel(model: string): boolean {
  const slug = model.toLowerCase();
  return slug.includes('auto') || slug.includes('latest');
}

function photoRef(photo: VerifyPhoto | string): string {
  return typeof photo === 'string' ? photo : photo.storageKey;
}

function buildUserText(input: VerifyInput): string {
  const asset = input.asset;
  const where = [asset.building, asset.floor, asset.room].filter((part) => part !== undefined && part !== '');
  const lines = [
    `Description: ${input.description}`,
    `Asset: ${asset.name} (category ${asset.category})`,
    ...(where.length > 0 ? [`Location: ${where.join(' / ')}`] : []),
    `Photos: ${input.photos.map(photoRef).join(', ')}`,
    `Allowed categories: ${input.categories.join(', ')}`,
    `Allowed issue types: ${input.issueTypes.join(', ')}`,
  ];
  return lines.join('\n');
}

function extractContent(envelope: unknown): string | undefined {
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
      .filter((part): part is { type: string; text: string } => typeof part === 'object' && part !== null)
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    return text === '' ? undefined : text;
  }
  return undefined;
}

export async function verifyReport(input: VerifyInput, opts: VerifyOpts): Promise<VerifyOutcome> {
  const timeoutMs = opts.timeoutMs;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { kind: 'FAIL', reason: 'INVALID_INPUT' };
  }
  if (
    typeof input.description !== 'string' ||
    input.description.trim() === '' ||
    input.photos.length === 0
  ) {
    return { kind: 'FAIL', reason: 'INVALID_INPUT' };
  }
  const model = opts.model ?? '';
  if (model !== '' && isDisallowedModel(model)) {
    return { kind: 'FAIL', reason: 'UNKNOWN_MODEL', model };
  }
  const fetchImpl = opts.fetch ?? fetch;
  const endpoint = opts.endpoint ?? OPENROUTER_ENDPOINT;

  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: [
          'Judge the maintenance report and answer with JSON only.',
          'PASS only when a photo is clear and relevant and the description matches the chosen asset.',
          'Otherwise FAIL with a plain reason the reporter can act on.',
          'Fields: verdict (PASS|FAIL), category, issueType, priority, confidence (0-1), reasons, reason.',
        ].join(' '),
      },
      { role: 'user', content: buildUserText(input) },
    ],
    response_format: { type: 'json_object' },
    // Zero-retention routing required on every request.
    provider: {
      data_collection: 'deny',
      zdr: true,
      require_parameters: true,
      allow_fallbacks: false,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.apiKey === undefined ? {} : { Authorization: `Bearer ${opts.apiKey}` }),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // Timeouts, 5xx, 429, and network aborts are transient, so the report is held for admin rather than rejected.
    return { kind: 'DOWN' };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429 || response.status >= 500) {
    return { kind: 'DOWN' };
  }
  if (!response.ok) {
    return { kind: 'FAIL', reason: 'UPSTREAM_REJECTED', model };
  }
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    return { kind: 'FAIL', reason: 'UPSTREAM_REJECTED', model };
  }
  const content = extractContent(envelope);
  if (content === undefined) {
    return { kind: 'FAIL', reason: 'UPSTREAM_REJECTED', model };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(content) as unknown;
  } catch {
    return { kind: 'FAIL', reason: 'UPSTREAM_REJECTED', model };
  }
  const parsed = parseVerdict(raw);
  if (!parsed.success) {
    return { kind: 'FAIL', reason: 'UPSTREAM_REJECTED', model };
  }
  if (parsed.data.verdict === 'FAIL') {
    return { kind: 'FAIL', reason: parsed.data.reason ?? 'UNCLEAR_EVIDENCE', model };
  }
  const category = parsed.data.category?.trim() ?? '';
  const issueType = parsed.data.issueType?.trim() ?? '';
  const priority = parsed.data.priority?.trim() ?? '';
  if (category === '' || issueType === '' || priority === '') {
    return { kind: 'FAIL', reason: 'UNCLEAR_EVIDENCE', model };
  }
  return {
    kind: 'PASS',
    category,
    issueType,
    priority,
    confidence: parsed.data.confidence ?? 0,
    reasons: parsed.data.reasons ?? [],
    model,
    promptVersion: opts.promptVersion ?? PROMPT_VERSION,
    schemaVersion: opts.schemaVersion ?? SCHEMA_VERSION,
  };
}

export class MockVerifyAssistant {
  private readonly queue: VerifyOutcome[];
  readonly calls: Array<{ input: VerifyInput; opts?: { timeoutMs?: number } }> = [];

  constructor(canned: VerifyOutcome | VerifyOutcome[] = { kind: 'DOWN' }) {
    this.queue = Array.isArray(canned) ? [...canned] : [canned];
  }

  enqueue(outcome: VerifyOutcome): void {
    this.queue.push(outcome);
  }

  async verify(input: VerifyInput, opts?: { timeoutMs?: number }): Promise<VerifyOutcome> {
    this.calls.push(opts === undefined ? { input } : { input, opts });
    return this.queue.shift() ?? { kind: 'DOWN' };
  }
}
