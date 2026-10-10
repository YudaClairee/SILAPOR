// Application service-layer placeholder (Task 2).
// Routes and server functions call this layer — never the ORM directly.
// Full services land in later tasks; `ping` only establishes the boundary
// pattern used by the web-only health route.
export interface PingResult {
  readonly ok: true;
  readonly service: 'web';
}

export async function ping(): Promise<PingResult> {
  return { ok: true, service: 'web' };
}
