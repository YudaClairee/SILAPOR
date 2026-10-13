// Orphan-enumeration listing tests (Phase 4, task P4-4).
//
// Filesystem: tmpdir fixtures (nested keys, `.meta.json` sidecars skipped,
// prefix filter, missing dir → [], traversal prefix throws before I/O,
// symlink entries skipped fail-closed). S3: stub-client pagination (MaxKeys
// 1000, continuation token), empty bucket, key hygiene. The live Garage list
// is gated on STORAGE_ENDPOINT reachability (skipped clearly when down).
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  listFilesystemKeys,
  listS3Keys,
  S3_LIST_MAX_KEYS,
  type S3ListClient,
  type S3ListPage,
} from './list.js';

let scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.allSettled(scratchDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  scratchDirs = [];
});

async function makeTree(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'silapor-list-'));
  scratchDirs.push(root);
  await writeFile(path.join(root, 'att_aaa'), 'a');
  await writeFile(path.join(root, 'att_bbb'), 'b');
  await writeFile(path.join(root, 'att_aaa.meta.json'), '{"contentType":"image/png"}');
  await writeFile(path.join(root, 'other.txt'), 'other');
  await mkdir(path.join(root, 'sub', 'nested'), { recursive: true });
  await writeFile(path.join(root, 'sub', 'att_ccc'), 'c');
  await writeFile(path.join(root, 'sub', 'nested', 'deep.png'), 'd');
  try {
    await symlink('/etc/hostname', path.join(root, 'link-out'));
  } catch {
    // Symlink creation is best-effort (restricted filesystems); the
    // skip-assertion below only runs when the link exists.
  }
  return root;
}

function stubListClient(pages: S3ListPage[]): { client: S3ListClient; commands: ListObjectsV2Command[] } {
  const commands: ListObjectsV2Command[] = [];
  let index = 0;
  const client: S3ListClient = {
    send: async (command: ListObjectsV2Command): Promise<S3ListPage> => {
      commands.push(command);
      return pages[index++] ?? {};
    },
  };
  return { client, commands };
}

describe('listFilesystemKeys', () => {
  it('lists nested keys recursively, sorted, skipping .meta.json sidecars and symlinks', async () => {
    const root = await makeTree();
    const keys = await listFilesystemKeys(root, '');
    expect(keys).toEqual(['att_aaa', 'att_bbb', 'other.txt', 'sub/att_ccc', 'sub/nested/deep.png']);
    expect(keys.some((key) => key.endsWith('.meta.json'))).toBe(false);
    expect(keys.some((key) => key.includes('link-out'))).toBe(false);
  });

  it('filters by prefix (bare and directory-style)', async () => {
    const root = await makeTree();
    await expect(listFilesystemKeys(root, 'att')).resolves.toEqual(['att_aaa', 'att_bbb']);
    await expect(listFilesystemKeys(root, 'sub/att')).resolves.toEqual(['sub/att_ccc']);
    await expect(listFilesystemKeys(root, 'sub/')).resolves.toEqual([
      'sub/att_ccc',
      'sub/nested/deep.png',
    ]);
    await expect(listFilesystemKeys(root, 'nope')).resolves.toEqual([]);
  });

  it('returns [] for a missing root directory (fresh env)', async () => {
    const missing = path.join(tmpdir(), `silapor-list-missing-${Date.now()}`);
    await expect(listFilesystemKeys(missing, '')).resolves.toEqual([]);
  });

  it('rejects traversal/absolute prefixes before touching I/O', async () => {
    const root = await makeTree();
    for (const bad of ['../x', '..', '/abs/x', 'sub/../../x']) {
      await expect(listFilesystemKeys(root, bad)).rejects.toThrow(/Invalid list prefix/);
    }
  });
});

describe('listS3Keys', () => {
  const day = new Date('2026-01-02T00:00:00.000Z');

  it('paginates with MaxKeys 1000 and continuation tokens, carrying LastModified', async () => {
    const { client, commands } = stubListClient([
      {
        Contents: [
          { Key: 'att_1', LastModified: day },
          { Key: 'att_2' },
        ],
        IsTruncated: true,
        NextContinuationToken: 'tok-1',
      },
      { Contents: [{ Key: 'att_3', LastModified: day }], IsTruncated: false },
    ]);
    const entries = await listS3Keys(client, 'silapor', 'att');
    expect(entries).toEqual([
      { key: 'att_1', lastModified: day },
      { key: 'att_2', lastModified: null },
      { key: 'att_3', lastModified: day },
    ]);
    expect(commands).toHaveLength(2);
    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(commands[0]?.input).toMatchObject({ Bucket: 'silapor', Prefix: 'att', MaxKeys: 1000 });
    expect(commands[0]?.input.ContinuationToken).toBeUndefined();
    expect(commands[1]?.input.ContinuationToken).toBe('tok-1');
  });

  it('returns [] for an empty bucket and skips empty keys', async () => {
    const { client, commands } = stubListClient([{ Contents: [{ Key: '' }, {}] }]);
    await expect(listS3Keys(client, 'silapor', '')).resolves.toEqual([]);
    expect(commands).toHaveLength(1);
  });

  it('rejects an empty bucket and traversal prefixes without network', async () => {
    const { client } = stubListClient([{}]);
    await expect(listS3Keys(client, '   ', 'att')).rejects.toThrow(/STORAGE_BUCKET/);
    await expect(listS3Keys(client, 'silapor', '../x')).rejects.toThrow(/Invalid list prefix/);
  });

  it('pins the page size to 1000', () => {
    expect(S3_LIST_MAX_KEYS).toBe(1000);
  });
});

describe('listS3Keys live Garage (gated)', () => {
  const liveEndpoint = (process.env.STORAGE_ENDPOINT ?? '').trim();
  const liveBucket = (process.env.STORAGE_BUCKET ?? '').trim() || 'silapor';

  it.skipIf(liveEndpoint.length === 0)('lists keys just stored under a unique prefix', async (ctx) => {
    try {
      await fetch(liveEndpoint, { signal: AbortSignal.timeout(2000) });
    } catch {
      ctx.skip();
      return;
    }
    const { S3Client } = await import('@aws-sdk/client-s3');
    const accessKeyId =
      (process.env.STORAGE_ACCESS_KEY_ID ?? '').trim() ||
      (process.env.GARAGE_DEFAULT_ACCESS_KEY ?? '').trim() ||
      'GKaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const secretAccessKey =
      (process.env.STORAGE_SECRET_ACCESS_KEY ?? '').trim() ||
      (process.env.GARAGE_DEFAULT_SECRET_KEY ?? '').trim() ||
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const raw = new S3Client({
      endpoint: liveEndpoint,
      region: 'garage',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    const client = raw as unknown as S3ListClient;
    const { S3AttachmentStorage } = await import('./s3.js');
    const { randomUUID } = await import('node:crypto');
    const storage = new S3AttachmentStorage({
      bucket: liveBucket,
      client: raw as never,
    });
    const prefix = `p44list_${randomUUID()}`;
    const bytes = new TextEncoder().encode('list-probe');
    await storage.put(`${prefix}_a`, bytes, 'image/png');
    await storage.put(`${prefix}_b`, bytes, 'image/png');
    try {
      const entries = await listS3Keys(client, liveBucket, prefix);
      expect(entries.map((entry) => entry.key).sort()).toEqual([`${prefix}_a`, `${prefix}_b`]);
    } finally {
      await storage.remove(`${prefix}_a`);
      await storage.remove(`${prefix}_b`);
    }
  });
});
