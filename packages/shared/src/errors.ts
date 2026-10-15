// Standardized application errors + HTTP mapping (Task 5).
//
// `packages/domain` stays dependency-free: errors live in `@silapor/shared`
// and the domain may import them later (not now — no domain files are
// touched by this task).
//
// Contract:
// - service/route layers throw (or return) `AppError` with a stable `code`,
//   human-safe `message`, numeric `status`, and optional pre-sanitised
//   `details`;
// - transport (`toHttpResponse`) maps to `{ error: { code, message } }` with
//   the matching status; unknown errors become 500 INTERNAL with a generic
//   message — stack traces and raw internals go to the server log
//   (`createLogger().error(...)`) and NEVER into the HTTP body;
// - `details`, when present, must already be safe: run it through `redact()`
//   from `./logging` first and never put passwords, tokens, image bytes,
//   signed URLs, or PII in it.

export type AppErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAVAILABLE'
  | 'INTERNAL'
  // Phase 4 P4-3 attachment codes (additive): the P4-1
  // `AttachmentValidationCode` values surface verbatim as HTTP body codes
  // so clients can distinguish oversize/type/corrupt/count failures without
  // parsing messages. `toHttpResponse` passes them through unchanged.
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'UNSUPPORTED_TYPE'
  | 'MIME_MISMATCH'
  | 'CORRUPT_IMAGE'
  | 'INVALID_FILENAME'
  | 'EMPTY_FILE'
  // Task 3 duplicate-first submit (additive): the same-reporter same-asset
  // active block surfaces verbatim as the HTTP body code so Task 6 can return
  // 409 with the active ticket ref without parsing messages. `toHttpResponse`
  // passes it through unchanged (status 409, set at the throw site).
  | 'DUPLICATE_ACTIVE';

export interface AppErrorInit {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly status: number;
  readonly details?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(init: AppErrorInit) {
    super(init.message);
    this.name = 'AppError';
    this.code = init.code;
    this.status = init.status;
    if (init.details !== undefined) {
      this.details = init.details;
    }
  }
}

function make(code: AppErrorCode, status: number, message: string, details?: unknown): AppError {
  return details === undefined
    ? new AppError({ code, message, status })
    : new AppError({ code, message, status, details });
}

export function badRequest(message = 'Bad request', details?: unknown): AppError {
  return make('BAD_REQUEST', 400, message, details);
}

export function unauthorized(message = 'Unauthorized', details?: unknown): AppError {
  return make('UNAUTHORIZED', 401, message, details);
}

export function forbidden(message = 'Forbidden', details?: unknown): AppError {
  return make('FORBIDDEN', 403, message, details);
}

export function notFound(message = 'Not found', details?: unknown): AppError {
  return make('NOT_FOUND', 404, message, details);
}

export function conflict(message = 'Conflict', details?: unknown): AppError {
  return make('CONFLICT', 409, message, details);
}

// Phase 4 P4-3: the only 413 helper. Oversize attachments reject with code
// `FILE_TOO_LARGE` (not `BAD_REQUEST`) so the body names the failure;
// `toHttpResponse` maps the explicit status verbatim (no transport change).
export function payloadTooLarge(message = 'Payload too large', details?: unknown): AppError {
  return make('FILE_TOO_LARGE', 413, message, details);
}

export function unavailable(message = 'Service unavailable', details?: unknown): AppError {
  return make('UNAVAILABLE', 503, message, details);
}

export function internal(message = 'Internal server error', details?: unknown): AppError {
  return make('INTERNAL', 500, message, details);
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export interface HttpErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export interface HttpErrorResponse {
  readonly status: number;
  readonly body: HttpErrorBody;
}

// Maps any thrown value to a safe HTTP response. Known `AppError`s keep
// their code/status/message; everything else becomes a generic 500 INTERNAL
// without leaking stacks, SQL text, paths, or provider output. Log the
// original error server-side before calling this.
export function toHttpResponse(error: unknown): HttpErrorResponse {
  if (isAppError(error)) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Internal server error' } } };
}
