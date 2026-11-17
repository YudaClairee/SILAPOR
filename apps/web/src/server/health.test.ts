// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { checkStorage } from './health';

describe('checkStorage', () => {
  const keys = ['STORAGE_ADAPTER', 'STORAGE_ENDPOINT'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('memakai adapter dari factory: s3 tanpa endpoint → ok false', async () => {
    process.env['STORAGE_ADAPTER'] = 's3';
    delete process.env['STORAGE_ENDPOINT'];
    const result = await checkStorage();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('STORAGE_ENDPOINT');
  });
});
