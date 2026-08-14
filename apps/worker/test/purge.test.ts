import { describe, expect, it } from 'vitest';
import { sweepDueRawPurges, type PurgeDeps } from '../src/workflows/purge.js';

/** CLAUDE.md §4 executor (audit M1): purgeRawAt was written everywhere and executed nowhere. */
describe('the retention sweep', () => {
  const NOW = new Date('2026-08-13T09:00:00Z');

  function deps(calls: string[], over: Partial<PurgeDeps> = {}): PurgeDeps {
    return {
      findDueControllerResponsePurges: async () => [{ id: 'cr1', rawDocumentRef: 's3://raw/1.pdf' }],
      findDueInboundDocumentPurges: async () => [{ id: 'doc1', storageRef: 's3://raw/2.pdf' }],
      deleteObject: async (ref) => void calls.push(`delete:${ref}`),
      tombstoneControllerResponseRaw: async (id) => void calls.push(`tomb-cr:${id}`),
      tombstoneInboundDocumentRaw: async (id, at) => void calls.push(`tomb-doc:${id}@${at.toISOString()}`),
      log: () => undefined,
      now: () => NOW,
      ...over,
    };
  }

  it('deletes the blob FIRST, then tombstones — for both raw stores', async () => {
    const calls: string[] = [];
    expect(await sweepDueRawPurges(deps(calls))).toBe(2);
    expect(calls).toEqual([
      'delete:s3://raw/1.pdf',
      'tomb-cr:cr1',
      'delete:s3://raw/2.pdf',
      `tomb-doc:doc1@${NOW.toISOString()}`,
    ]);
  });

  it('a blob-delete failure leaves the reference in place for the next sweep (no tombstone-without-delete)', async () => {
    const calls: string[] = [];
    const failing = deps(calls, {
      deleteObject: async () => {
        throw new Error('object store down');
      },
    });
    await expect(sweepDueRawPurges(failing)).rejects.toThrow(/object store down/);
    expect(calls).toEqual([]); // nothing tombstoned — the row stays due
  });

  it('nothing due is a quiet no-op', async () => {
    const calls: string[] = [];
    const empty = deps(calls, {
      findDueControllerResponsePurges: async () => [],
      findDueInboundDocumentPurges: async () => [],
    });
    expect(await sweepDueRawPurges(empty)).toBe(0);
    expect(calls).toEqual([]);
  });
});
