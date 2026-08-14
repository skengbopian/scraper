import { PrismaClient } from '@prisma/client';
import type { CreditFileEntryInput, FileFindingDraft } from '@scraper/core';

/**
 * Persistence port for the BYO-Datenkopie ingest, with the same two-mode split as requests:
 * in-memory for the standalone alpha, Prisma for DB mode (where the 0003 triggers re-assert the
 * identity binding at the storage layer). The RAW upload is never stored in either mode — only its
 * sha256 (CLAUDE.md §4: purge raw files after normalisation).
 */
export interface SnapshotInput {
  readonly userId: string;
  readonly identityId: string;
  readonly controllerId: string;
  readonly matchAssertedAt: Date;
  readonly parseConfidence: number;
  readonly rawDocumentHash: string;
  readonly entries: readonly (CreditFileEntryInput & { readonly raw: Readonly<Record<string, unknown>> })[];
  readonly findings: readonly FileFindingDraft[];
}

export interface StoredFindings {
  readonly snapshotId: string;
  readonly receivedAt: Date;
  readonly controllerId: string;
  readonly parseConfidence: number;
  readonly findings: readonly (FileFindingDraft & { readonly entryLabel: string | null })[];
}

export interface CreditFileStore {
  saveSnapshot(input: SnapshotInput): Promise<{ snapshotId: string }>;
  latestForUser(userId: string): Promise<StoredFindings | null>;
  /**
   * CLAUDE.md C1: anomalies land in a REVIEWABLE store, not a log line (audit M3). `detail` is a
   * bounded operator note — never document content, never subject data.
   */
  recordAnomaly(event: { userId: string | null; kind: string; detail: string }): Promise<void>;
}

export class InMemoryCreditFileStore implements CreditFileStore {
  private readonly byUser = new Map<string, StoredFindings[]>();
  private readonly anomalies: { userId: string | null; kind: string; detail: string }[] = [];
  private seq = 0;

  async recordAnomaly(event: { userId: string | null; kind: string; detail: string }): Promise<void> {
    this.anomalies.push(event);
  }

  async saveSnapshot(input: SnapshotInput): Promise<{ snapshotId: string }> {
    const snapshotId = `snap_${++this.seq}`;
    const labelByEntry = new Map(input.entries.map((e) => [e.id, e.label] as const));
    const stored: StoredFindings = {
      snapshotId,
      receivedAt: new Date(),
      controllerId: input.controllerId,
      parseConfidence: input.parseConfidence,
      findings: input.findings.map((f) => ({ ...f, entryLabel: f.entryId ? labelByEntry.get(f.entryId) ?? null : null })),
    };
    const list = this.byUser.get(input.userId) ?? [];
    list.push(stored);
    this.byUser.set(input.userId, list);
    return { snapshotId };
  }

  async latestForUser(userId: string): Promise<StoredFindings | null> {
    const list = this.byUser.get(userId);
    return list?.[list.length - 1] ?? null;
  }
}

export class PrismaCreditFileStore implements CreditFileStore {
  constructor(private readonly db: PrismaClient) {}

  async recordAnomaly(event: { userId: string | null; kind: string; detail: string }): Promise<void> {
    await this.db.anomalyEvent.create({
      data: { userId: event.userId, kind: event.kind.slice(0, 100), detail: event.detail.slice(0, 1000) },
    });
  }

  async saveSnapshot(input: SnapshotInput): Promise<{ snapshotId: string }> {
    // One transaction: snapshot + entries + findings — the 0003 triggers assert the identity
    // binding on the snapshot row itself.
    return this.db.$transaction(async (tx) => {
      const snap = await tx.creditFileSnapshot.create({
        data: {
          userId: input.userId,
          identityId: input.identityId,
          controllerId: input.controllerId,
          sourceKind: 'UPLOAD',
          matchAssertedAt: input.matchAssertedAt,
          parseConfidence: input.parseConfidence,
          rawDocumentHash: input.rawDocumentHash,
        },
      });
      const idMap = new Map<string, string>();
      for (const e of input.entries) {
        const row = await tx.creditFileEntry.create({
          data: {
            snapshotId: snap.id,
            entryType: e.entryType,
            reportedBy: e.reportedBy,
            reportedAt: e.reportedAt,
            settledAt: e.settledAt,
            amountCents: e.amountCents,
            disputed: e.disputed,
            label: e.label,
            raw: e.raw as never,
          },
        });
        idMap.set(e.id, row.id);
      }
      for (const f of input.findings) {
        await tx.fileFinding.create({
          data: {
            snapshotId: snap.id,
            entryId: f.entryId ? idMap.get(f.entryId) ?? null : null,
            ruleId: f.ruleId,
            ruleSetVersion: f.ruleSetVersion,
            severity: f.severity,
            computedDeadlineAt: f.computedDeadlineAt,
            recommendedAction: f.recommendedAction,
            scoreRelevance: f.scoreRelevance,
            scoreNegativeWarning: f.scoreNegativeWarning,
            explanation: f.explanation,
          },
        });
      }
      return { snapshotId: snap.id };
    });
  }

  async latestForUser(userId: string): Promise<StoredFindings | null> {
    const snap = await this.db.creditFileSnapshot.findFirst({
      where: { userId },
      orderBy: { receivedAt: 'desc' },
      include: { findings: { include: { entry: { select: { label: true } } } } },
    });
    if (!snap) return null;
    return {
      snapshotId: snap.id,
      receivedAt: snap.receivedAt,
      controllerId: snap.controllerId,
      parseConfidence: snap.parseConfidence,
      findings: snap.findings.map((f) => ({
        entryId: f.entryId,
        ruleId: f.ruleId,
        ruleSetVersion: f.ruleSetVersion,
        severity: f.severity as 'INFO' | 'UPCOMING' | 'OVERDUE',
        computedDeadlineAt: f.computedDeadlineAt,
        recommendedAction: f.recommendedAction as never,
        scoreRelevance: f.scoreRelevance,
        scoreNegativeWarning: f.scoreNegativeWarning,
        explanation: f.explanation,
        entryLabel: f.entry?.label ?? null,
      })),
    };
  }
}
