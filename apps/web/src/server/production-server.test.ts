// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'srvx';
import { createProductionServer } from './production-server';

describe('createProductionServer', () => {
  let root: string;
  let clientDir: string;
  let server: Server | undefined;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'silapor-prod-'));
    clientDir = path.join(root, 'client');
    await mkdir(path.join(clientDir, 'assets'), { recursive: true });
    await writeFile(path.join(clientDir, 'assets', 'app.js'), 'console.log(1)');
    await writeFile(path.join(root, 'secret.txt'), 'RAHASIA');
  });

  afterEach(async () => {
    await server?.close(true);
    server = undefined;
    await rm(root, { recursive: true, force: true });
  });

  async function start(): Promise<string> {
    server = createProductionServer({
      fetch: () => new Response('ssr', { status: 200 }),
      clientDir,
      port: 0,
    });
    await server.ready();
    if (server.url === undefined) throw new Error('server.url kosong');
    return server.url;
  }

  it('melayani file static dari clientDir', async () => {
    const base = await start();
    const res = await fetch(new URL('/assets/app.js', base));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log(1)');
    expect(res.headers.get('content-type') ?? '').toContain('javascript');
  });

  it('meneruskan path non-static ke handler Start', async () => {
    const base = await start();
    const res = await fetch(new URL('/login', base));
    expect(await res.text()).toBe('ssr');
  });

  it('tidak melayani file di luar clientDir', async () => {
    const base = await start();
    for (const p of ['/assets/../../secret.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt']) {
      // fetch() menormalisasi "..", jadi kirim path mentah lewat node:http
      const body = await rawGet(base, p);
      expect(body).not.toContain('RAHASIA');
    }
  });

  it('bind ke 127.0.0.1 secara default', async () => {
    const base = await start();
    expect(new URL(base).hostname).toBe('127.0.0.1');
  });
});

async function rawGet(base: string, rawPath: string): Promise<string> {
  const { request } = await import('node:http');
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path: rawPath, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => resolve(data));
      },
    );
    req.on('error', reject);
    req.end();
  });
}
