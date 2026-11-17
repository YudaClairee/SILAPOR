// `pnpm --filter @silapor/web run start` — production entry for the VPS.
// Requires `pnpm --filter @silapor/web run build` first.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProductionServer } from '../src/server/production-server';

const port = Number.parseInt(process.env['PORT'] ?? '3000', 10) || 3000;
const hostname = process.env['HOST'] ?? '127.0.0.1';
const clientDir = resolve(import.meta.dirname, '../dist/client');
const serverEntry = resolve(import.meta.dirname, '../dist/server/server.js');

const mod = (await import(pathToFileURL(serverEntry).href)) as {
  default: { fetch: (request: Request) => Response | Promise<Response> };
};

const server = createProductionServer({
  fetch: (request) => mod.default.fetch(request),
  clientDir,
  port,
  hostname,
});

await server.ready();
console.log(`[silapor-web] listening on ${server.url ?? `${hostname}:${port}`}`);

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
