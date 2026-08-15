/**
 * Provider interfaces (docs/02). Every external dependency sits behind one of these so that
 * (a) dev runs with zero vendor accounts, and (b) **EU residency is a config choice that defaults to
 * EU** rather than a property of a hardcoded vendor.
 */

import type { VerifiedIdentity } from '../identity/subject.js';

export type Region = 'eu';

export interface IdentityProvider {
  startVerification(userId: string): Promise<{ providerRef: string; redirectUrl: string }>;
  getStatus(providerRef: string): Promise<VerifiedIdentity | null>;
  signMandate(userId: string, mandateDocumentHash: string): Promise<{ qesSignatureRef: string }>;
}

export interface PostalSendResult {
  readonly providerId: string;
  /** Present only for registered mail. This is what makes a send provable. */
  readonly proof: DeliveryProof | null;
}

/**
 * A postal delivery receipt.
 *
 * `origin` is the anti-stub marker and is REQUIRED, not optional. In the pre-audit line the stub
 * postal provider returned `proofRef: 'stub:einwurf-proof-N'` for any registered send — inert there,
 * because nothing keyed a legal deadline off it. Here the presence of a proof is one of the two
 * things that authorise `provableSendConfirmed`, so a stub that merely *looks* like a carrier would
 * start a real Art. 12(3) clock. A provider that did not receive a receipt from a carrier must say
 * `SIMULATED`, and `provableSendEvidenceIdOf()` refuses it (evidence/provable-send.ts).
 */
export interface DeliveryProof {
  readonly kind: 'EINWURF_EINSCHREIBEN';
  readonly trackingRef: string;
  readonly deliveredAt: Date;
  readonly origin: 'CARRIER' | 'SIMULATED';
}

/**
 * A recipient laid out as DIN 5008 address lines.
 *
 * A flat string cannot be posted. The pre-audit shape (`recipient: string`) went straight into the
 * hybrid-mail vendor's single `address` field, which is how a letter ends up with its Postleitzahl
 * on the wrong line — and an address a sorting machine reads wrong is indistinguishable, from the
 * user's side, from a controller who ignored them.
 */
export interface PostalRecipient {
  /** Two to six lines, the last being `PLZ Ort`. Already validated to fit the 85 mm address field. */
  readonly lines: readonly string[];
  /** ISO 3166-1 alpha-2. Germany-first (docs/07); a non-DE country prints its own line. */
  readonly country: string;
}

export interface PostalProvider {
  send(letter: { text: string; recipient: string }, opts: { registered: boolean }): Promise<PostalSendResult>;
}

export interface MailerResult {
  readonly messageId: string;
  readonly accepted: boolean;
  readonly dkimAligned: boolean;
}

export interface Mailer {
  /**
   * NOTE: a DKIM-aligned accept proves we sent, not that they received. The caller must map this to
   * `sendAccepted:nonProvable`, never to `provableSendConfirmed` (CLAUDE.md §6).
   */
  send(msg: { to: string; subject: string; text: string }): Promise<MailerResult>;
}

export interface RawDocument {
  readonly id: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly receivedAt: Date;
}

export interface InboundMail {
  poll(): Promise<readonly RawDocument[]>;
}

/** An anchor from a real qualified trust service provider. Only this kind establishes legal time. */
export interface QualifiedTimestamp {
  readonly kind: 'QUALIFIED';
  readonly tsaRef: string;
  readonly signedAt: Date;
  readonly algorithm: string;
}

/**
 * An anchor from anything that is not a QTSP — a dev stub, a vendor sandbox, a test double.
 *
 * It is a distinct TYPE rather than a boolean flag so that "is this anchor qualified?" is answered
 * by the type system at every call site, and so an implementation cannot forget to say which it is:
 * `Timestamper.anchor()` returns the union, and every consumer must narrow.
 */
export interface SimulatedTimestamp {
  readonly kind: 'SIMULATED';
  readonly tsaRef: string;
  readonly signedAt: Date;
  readonly algorithm: string;
  /** Why this is not qualified — surfaced verbatim when the machine refuses the send. */
  readonly reason: string;
}

export type TimestampAnchor = QualifiedTimestamp | SimulatedTimestamp;

export function isQualifiedAnchor(a: TimestampAnchor | null | undefined): a is QualifiedTimestamp {
  return a !== null && a !== undefined && a.kind === 'QUALIFIED';
}

export interface Timestamper {
  /** A hash chain proves integrity; only a QTSP proves time (docs/05 §6, docs/06 M13). */
  anchor(sha256Hex: string): Promise<TimestampAnchor>;
}

export interface SandboxParseResult {
  readonly structured: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly text: string;
}

export interface DocSandbox {
  /**
   * Parses ONE untrusted document in an isolated context. Contract (docs/06 C4):
   * structured-output only, no tool/function calling, one document per context, zero cross-user
   * context, and **no write access to request state**. The result is advisory.
   */
  parse(doc: RawDocument, schema: Readonly<Record<string, unknown>>): Promise<SandboxParseResult>;
}

export interface ModelProvider {
  complete(prompt: string, opts: { schema: Readonly<Record<string, unknown>>; region: Region }): Promise<unknown>;
}

/**
 * The workflow engine, abstracted so Temporal is not a hard dependency of the first milestone
 * (docs/02, ADR-004). BullMQ or an in-process runner satisfies this for M0.
 */
export interface WorkflowEngine {
  /** Durable, idempotent by `key`: submitting the same key twice must not run the work twice. */
  schedule(key: string, runAt: Date, task: { name: string; payload: Readonly<Record<string, unknown>> }): Promise<void>;
  cancel(key: string): Promise<void>;
}
