import { BadRequestException, ForbiddenException, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  assessCreditFile,
  COC_RULESET,
  matchSubjectToIdentity,
  type CreditFileEntryInput,
  type VerifiedIdentity,
} from '@scraper/core';
import { createIsolatedDatenkopieSandbox, type DatenkopieStructured } from '@scraper/doc-sandbox';
import { CENSUS } from '../census/census.js';
import type { CreditFileStore } from './credit-file.store.js';

const MAX_BYTES = 8 * 1024 * 1024;
const UPLOADS_PER_HOUR = 5;

/**
 * BYO-Datenkopie ingest (docs/10 §3.1) — the same-day-utility flagship.
 *
 * The order of operations IS the safety design:
 *   1. parse in the doc-sandbox (hostile input; injection ⇒ confidence 0),
 *   2. MATCH GATE: parsed name+DOB must equal the caller's VERIFIED identity — mismatch means the
 *      document is about someone else: REJECT AND PURGE, log for anomaly review, store NOTHING
 *      (the one rule; OQ-15 owns thresholds),
 *   3. only then normalise, run the deterministic CoC rules, persist (raw bytes never stored —
 *      hash only), return findings.
 *
 * Findings carry the rule-set version; until counsel signs it (OQ-13) every consumer must render
 * them as preliminary — the response says so machine-readably.
 */
@Injectable()
export class CreditFileService {
  private readonly log = new Logger('CreditFile');
  private readonly uploads = new Map<string, { n: number; resetAt: number }>();
  // PROCESS-isolated (audit H3): pdf.js runs in a scrubbed-env child, never in this process — the
  // one that holds the PrismaClient. CLAUDE.md §2's "isolated service" was previously a library
  // import wearing the name.
  private readonly sandbox = createIsolatedDatenkopieSandbox();

  constructor(private readonly store: CreditFileStore) {}

  private async throttle(userId: string): Promise<void> {
    const now = Date.now();
    const u = this.uploads.get(userId);
    if (u && u.resetAt > now && u.n >= UPLOADS_PER_HOUR) {
      // Hitting the cap is itself an anomaly signal worth a reviewable row, not only a refusal.
      await this.store.recordAnomaly({ userId, kind: 'UPLOAD_RATE_LIMITED', detail: `>${UPLOADS_PER_HOUR} uploads/hour` });
      throw new ForbiddenException({ error: 'RATE_LIMITED', message: 'Zu viele Uploads. Bitte warten Sie eine Stunde.' });
    }
    this.uploads.set(userId, u && u.resetAt > now ? { n: u.n + 1, resetAt: u.resetAt } : { n: 1, resetAt: now + 3600_000 });
  }

  async upload(userId: string, identity: VerifiedIdentity, bytes: Uint8Array) {
    if (!bytes?.length) throw new BadRequestException({ error: 'EMPTY', message: 'Bitte eine PDF-Datei senden (Content-Type application/pdf).' });
    if (bytes.length > MAX_BYTES) throw new BadRequestException({ error: 'TOO_LARGE', message: 'Die Datei ist größer als 8 MB.' });
    await this.throttle(userId);
    const rawDocumentHash = createHash('sha256').update(bytes).digest('hex');

    let parsed;
    try {
      parsed = await this.sandbox.parse({ id: rawDocumentHash, mimeType: 'application/pdf', bytes, receivedAt: new Date() }, {});
    } catch {
      throw new UnprocessableEntityException({ error: 'UNREADABLE', message: 'Die Datei konnte nicht als PDF gelesen werden.' });
    }
    if (parsed.confidence < 0.5) {
      // Injection markers or an unrecognised layout: nothing is stored, a human path is the answer.
      this.log.warn(`upload rejected (low confidence) user=${userId} hash=${rawDocumentHash.slice(0, 12)}`);
      throw new UnprocessableEntityException({
        error: 'QUALITY_TOO_LOW',
        message: 'Das Dokument war nicht sicher lesbar. Es wurde nichts gespeichert. Bitte die Original-PDF der Auskunftei verwenden.',
        nextAction: 'RETRY_WITH_ORIGINAL_PDF',
      });
    }

    const s = parsed.structured as DatenkopieStructured;

    // --- THE MATCH GATE (before anything persists) ------------------------------------------------
    const match = matchSubjectToIdentity(
      { name: s.subjectName, dateOfBirth: s.subjectDobIso ? new Date(s.subjectDobIso) : null },
      identity,
    );
    if (!match.match) {
      // Reject and purge: the parse result leaves scope here. The anomaly lands in the REVIEWABLE
      // store (audit M3) — repeatedly uploading someone else's Datenkopie is the highest-signal
      // abuse event this product can observe, and a log line nobody queues on is not review.
      this.log.warn(`upload REJECTED (subject mismatch) user=${userId} hash=${rawDocumentHash.slice(0, 12)} reason="${match.reason}"`);
      await this.store.recordAnomaly({ userId, kind: 'SUBJECT_MISMATCH', detail: `hash=${rawDocumentHash.slice(0, 12)} reason=${match.reason}` });
      throw new ForbiddenException({
        error: 'SUBJECT_MISMATCH',
        message:
          'Das Dokument gehört nicht zur verifizierten Identität dieses Kontos. Es wurde nichts gespeichert. Scraper verarbeitet nur Ihre eigene Datenkopie.',
        nextAction: 'UPLOAD_OWN_DATENKOPIE',
      });
    }

    const bureau = CENSUS.find((c) => c.slug === s.bureau);
    if (!bureau) {
      throw new UnprocessableEntityException({ error: 'UNKNOWN_BUREAU', message: 'Die Auskunftei wurde im Dokument nicht erkannt.' });
    }

    const entries = s.entries.map((e, i): CreditFileEntryInput & { raw: Record<string, unknown> } => ({
      id: `e${i + 1}`,
      entryType: e.entryType,
      reportedBy: e.reportedBy,
      reportedAt: e.reportedAtIso ? new Date(e.reportedAtIso) : null,
      settledAt: e.settledAtIso ? new Date(e.settledAtIso) : null,
      amountCents: e.amountCents,
      disputed: false,
      label: e.label,
      raw: { ...e },
    }));

    const findings = assessCreditFile(entries, new Date());
    const { snapshotId } = await this.store.saveSnapshot({
      userId,
      identityId: identity.id,
      controllerId: bureau.id,
      matchAssertedAt: new Date(),
      parseConfidence: parsed.confidence,
      rawDocumentHash,
      entries,
      findings,
    });

    return this.view(snapshotId, bureau.id, findings.map((f) => ({ ...f, entryLabel: null })), parsed.confidence);
  }

  async findings(userId: string) {
    const latest = await this.store.latestForUser(userId);
    if (!latest) return { snapshotId: null, findings: [], ruleSet: this.ruleSetView() };
    return this.view(latest.snapshotId, latest.controllerId, latest.findings, latest.parseConfidence);
  }

  private ruleSetView() {
    return {
      version: COC_RULESET.version,
      counselSignedOff: COC_RULESET.counselSignedOff,
      // OQ-13: until signed, every rendering of these findings must call them preliminary.
      preliminary: !COC_RULESET.counselSignedOff,
    };
  }

  private view(
    snapshotId: string,
    controllerId: string,
    findings: readonly (import('@scraper/core').FileFindingDraft & { entryLabel?: string | null })[],
    parseConfidence: number,
  ) {
    return {
      snapshotId,
      controllerId,
      parseConfidence,
      ruleSet: this.ruleSetView(),
      findings: findings.map((f) => ({ ...f, computedDeadlineAt: f.computedDeadlineAt ?? null })),
      nextAction: findings.length ? 'REVIEW_FINDINGS' : 'NONE',
    };
  }
}
