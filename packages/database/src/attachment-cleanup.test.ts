// Orphan-cleanup unit tests (Phase 4, task P4-4). No database, no network:
// the row source, the key enumerator, and storage are all fakes. Covers both
// directions (orphans removed vs broken refs reported, never deleted),
// dryRun, the limit cap, and the olderThanMs age gate.
import { describe, expect, it, vi } from 'vitest';
import {
  cleanupOrphanAttachments,
  type AttachmentRow,
  type AttachmentRowSource,
  type StorageKeyEntry,
} from './attachment-cleanup.js';

const OLD = new Date(Date.now() - 48 * 3600 * 1000);
const NOW = new Date();

function row(storageKey: string, reportId = 'report-1'): AttachmentRow {
  return { storageKey, reportId, createdAt: new Date('2026-01-01T00:00:00.000Z') };
}

function entry(key: string, lastModified: Date | null = OLD): StorageKeyEntry {
  return { key, lastModified };
}

function fakeDb(rows: AttachmentRow[]): AttachmentRowSource {
  return { listAttachmentRows: async () => rows };
}

describe('cleanupOrphanAttachments', () => {
  it('removes storage keys with no DB row while keeping referenced keys', async () => {
    const remove = vi.fn(async () => undefined);
    const result = await cleanupOrphanAttachments({
      db: fakeDb([row('att_keep')]),
      storage: { remove },
      listKeys: async () => [entry('att_keep'), entry('att_orphan')],
    });
    expect(result).toEqual({ checked: 2, orphans: ['att_orphan'], removed: 1, brokenRefs: [], dryRun: false });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('att_orphan');
  });

  it('reports DB rows missing in storage as brokenRefs and never deletes rows', async () => {
    const remove = vi.fn(async () => undefined);
    const result = await cleanupOrphanAttachments({
      db: fakeDb([row('att_ok', 'report-a'), row('att_gone', 'report-b')]),
      storage: { remove },
      listKeys: async () => [entry('att_ok')],
    });
    expect(result.orphans).toEqual([]);
    expect(result.removed).toBe(0);
    expect(result.brokenRefs).toEqual(['att_gone']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('dryRun lists orphans but removes nothing', async () => {
    const remove = vi.fn(async () => undefined);
    const result = await cleanupOrphanAttachments({
      db: fakeDb([]),
      storage: { remove },
      listKeys: async () => [entry('att_orphan')],
      dryRun: true,
    });
    expect(result.orphans).toEqual(['att_orphan']);
    expect(result.removed).toBe(0);
    expect(result.dryRun).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it('caps removals at limit, sorted-first for determinism', async () => {
    const remove = vi.fn(async () => undefined);
    const result = await cleanupOrphanAttachments({
      db: fakeDb([]),
      storage: { remove },
      listKeys: async () => [entry('orphan-c'), entry('orphan-a'), entry('orphan-b')],
      limit: 2,
    });
    expect(result.orphans).toEqual(['orphan-a', 'orphan-b']);
    expect(result.removed).toBe(2);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove).not.toHaveBeenCalledWith('orphan-c');
  });

  it('keeps young unreferenced keys newer than olderThanMs', async () => {
    const remove = vi.fn(async () => undefined);
    const result = await cleanupOrphanAttachments({
      db: fakeDb([]),
      storage: { remove },
      listKeys: async () => [entry('att_fresh', NOW)],
    });
    expect(result.orphans).toEqual([]);
    expect(result.removed).toBe(0);
    expect(remove).not.toHaveBeenCalled();
  });

  it('olderThanMs 0 removes young orphans', async () => {
    const remove = vi.fn(async () => undefined);
    const result = await cleanupOrphanAttachments({
      db: fakeDb([]),
      storage: { remove },
      listKeys: async () => [entry('att_fresh', NOW)],
      olderThanMs: 0,
    });
    expect(result.removed).toBe(1);
    expect(remove).toHaveBeenCalledWith('att_fresh');
  });

  it('treats unknown-age keys as orphan-eligible (removal is idempotent)', async () => {
    const remove = vi.fn(async () => undefined);
    const result = await cleanupOrphanAttachments({
      db: fakeDb([]),
      storage: { remove },
      listKeys: async () => [entry('att_unknown', null)],
    });
    expect(result.orphans).toEqual(['att_unknown']);
    expect(result.removed).toBe(1);
  });

  it('empty storage reports every row key as broken', async () => {
    const remove = vi.fn(async () => undefined);
    const result = await cleanupOrphanAttachments({
      db: fakeDb([row('att_b'), row('att_a')]),
      storage: { remove },
      listKeys: async () => [],
    });
    expect(result.checked).toBe(0);
    expect(result.orphans).toEqual([]);
    expect(result.brokenRefs).toEqual(['att_a', 'att_b']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('rejects a negative limit and negative olderThanMs with 400', async () => {
    const remove = vi.fn(async () => undefined);
    await expect(
      cleanupOrphanAttachments({ db: fakeDb([]), storage: { remove }, listKeys: async () => [], limit: -1 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      cleanupOrphanAttachments({
        db: fakeDb([]),
        storage: { remove },
        listKeys: async () => [],
        olderThanMs: -1,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(remove).not.toHaveBeenCalled();
  });
});
