// Production Node runner (VPS pilot). Serves the Vite client build from
// `clientDir` and delegates every other request to the TanStack Start handler.
// Binds to 127.0.0.1 by default so the app is only reachable through the
// Cloudflare Tunnel on the same host — never directly from the internet.
import { serve, type Server } from 'srvx';
import { serveStatic } from 'srvx/static';

export interface ProductionServerOptions {
  readonly fetch: (request: Request) => Response | Promise<Response>;
  /** Absolute path, e.g. apps/web/dist/client. */
  readonly clientDir: string;
  readonly port: number;
  /** Defaults to '127.0.0.1'. */
  readonly hostname?: string;
}

export function createProductionServer(options: ProductionServerOptions): Server {
  return serve({
    port: options.port,
    hostname: options.hostname ?? '127.0.0.1',
    middleware: [serveStatic({ dir: options.clientDir })],
    fetch: options.fetch,
  });
}
