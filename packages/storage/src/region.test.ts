import { afterEach, describe, expect, it } from 'vitest';
import { buildS3ClientConfig, resolveS3Region } from './s3';

describe('resolveS3Region', () => {
  const original = process.env['STORAGE_REGION'];
  afterEach(() => {
    if (original === undefined) delete process.env['STORAGE_REGION'];
    else process.env['STORAGE_REGION'] = original;
  });

  it('default "garage" agar dev lokal tidak berubah', () => {
    delete process.env['STORAGE_REGION'];
    expect(resolveS3Region()).toBe('garage');
  });

  it('memakai STORAGE_REGION bila diisi (R2 = "auto")', () => {
    process.env['STORAGE_REGION'] = 'auto';
    expect(resolveS3Region()).toBe('auto');
  });

  it('string kosong jatuh ke default', () => {
    process.env['STORAGE_REGION'] = '  ';
    expect(resolveS3Region()).toBe('garage');
  });

  it('argumen eksplisit menang atas env', () => {
    process.env['STORAGE_REGION'] = 'auto';
    expect(resolveS3Region('us-east-1')).toBe('us-east-1');
  });
});

describe('buildS3ClientConfig', () => {
  const original = process.env['STORAGE_REGION'];
  afterEach(() => {
    if (original === undefined) delete process.env['STORAGE_REGION'];
    else process.env['STORAGE_REGION'] = original;
  });

  it('memakai STORAGE_REGION dan checksum WHEN_REQUIRED', () => {
    process.env['STORAGE_REGION'] = 'auto';
    const config = buildS3ClientConfig({
      endpoint: 'https://example.r2.cloudflarestorage.com',
      accessKeyId: 'k',
      secretAccessKey: 's',
    });
    expect(config.region).toBe('auto');
    expect(config.forcePathStyle).toBe(true);
    expect(config.requestChecksumCalculation).toBe('WHEN_REQUIRED');
    expect(config.responseChecksumValidation).toBe('WHEN_REQUIRED');
  });
});
