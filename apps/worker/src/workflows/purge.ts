/**
 * The retention sweep (CLAUDE.md §4: "Purge raw DSAR response files after they are normalised").
 *
 * `purgeRawAt` has been written on every raw reference from day one — and executed by nothing
 * (audit M1/W10): 0005 even built the sweep's index for a sweep that did not exist. This is the
 * executor. Purging means: delete the object-store blob, then tombstone the reference. The ROWS
 * stay — the normalised record and the hashed evidence are the retained artefacts; it is the raw
 * hostile document that must not outlive its window.
 */

export interface PurgeDeps {
  readonly findDueControllerResponsePurges: (
    now: Date,
    limit: number,
  ) => Promise<readonly { id: string; rawDocumentRef: string }[]>;
  readonly findDueInboundDocumentPurges: (
    now: Date,
    limit: number,
  ) => Promise<readonly { id: string; storageRef: string }[]>;
  /** Delete the blob. Must be idempotent — a crash between delete and tombstone re-runs this. */
  readonly deleteObject: (ref: string) => Promise<void>;
  readonly tombstoneControllerResponseRaw: (id: string) => Promise<void>;
  readonly tombstoneInboundDocumentRaw: (id: string, purgedAt: Date) => Promise<void>;
  readonly log: (message: string) => void;
  readonly now: () => Date;
}

/** Delete-then-tombstone, blob first: a tombstone without a delete would LOOK purged. */
export async function sweepDueRawPurges(deps: PurgeDeps, limit = 50): Promise<number> {
  const now = deps.now();
  let purged = 0;
  for (const r of await deps.findDueControllerResponsePurges(now, limit)) {
    await deps.deleteObject(r.rawDocumentRef);
    await deps.tombstoneControllerResponseRaw(r.id);
    deps.log(`controller-response ${r.id}: raw document purged (was due ${now.toISOString()})`);
    purged += 1;
  }
  for (const d of await deps.findDueInboundDocumentPurges(now, limit)) {
    await deps.deleteObject(d.storageRef);
    await deps.tombstoneInboundDocumentRaw(d.id, now);
    deps.log(`inbound-document ${d.id}: raw document purged`);
    purged += 1;
  }
  return purged;
}
