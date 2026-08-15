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

/**
 * Delete-then-tombstone, blob first: a tombstone without a delete would LOOK purged.
 *
 * ONE ROW'S FAILURE IS NOT EVERY ROW'S. The sweep used to abort at the first `deleteObject` throw,
 * which was harmless while the deleter was a logged no-op. Against a real store it is not: a single
 * reference the configured store refuses — the shape an operator produces by moving from `fs` to
 * `s3` without moving the blobs — would stop every OTHER due document from being destroyed, so an
 * unrelated misconfiguration would quietly extend the retention window of everything behind it.
 *
 * So each row is isolated: a failure leaves that row untombstoned (still due, still visible on the
 * next sweep) and the others proceed. The sweep then RAISES with every failure named, because a
 * document we promised to destroy and could not is not a log line.
 */
export async function sweepDueRawPurges(deps: PurgeDeps, limit = 50): Promise<number> {
  const now = deps.now();
  let purged = 0;
  const failures: string[] = [];

  const purgeOne = async (label: string, ref: string, tombstone: () => Promise<void>, note: string): Promise<void> => {
    try {
      await deps.deleteObject(ref);
    } catch (e) {
      failures.push(`${label} (${ref}): ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    await tombstone();
    deps.log(note);
    purged += 1;
  };

  for (const r of await deps.findDueControllerResponsePurges(now, limit)) {
    await purgeOne(
      `controller-response ${r.id}`,
      r.rawDocumentRef,
      () => deps.tombstoneControllerResponseRaw(r.id),
      `controller-response ${r.id}: raw document purged (was due ${now.toISOString()})`,
    );
  }
  for (const d of await deps.findDueInboundDocumentPurges(now, limit)) {
    await purgeOne(
      `inbound-document ${d.id}`,
      d.storageRef,
      () => deps.tombstoneInboundDocumentRaw(d.id, now),
      `inbound-document ${d.id}: raw document purged`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} raw document(s) are past their retention window and could NOT be destroyed ` +
        `(CLAUDE.md §4); ${purged} other(s) were purged. ${failures.join(' · ')}`,
    );
  }
  return purged;
}
