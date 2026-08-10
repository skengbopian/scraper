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
  readonly proof: { readonly kind: 'EINWURF_EINSCHREIBEN'; readonly trackingRef: string; readonly deliveredAt: Date } | null;
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

export interface QualifiedTimestamp {
  readonly tsaRef: string;
  readonly signedAt: Date;
  readonly algorithm: string;
}

export interface Timestamper {
  /** A hash chain proves integrity; only a QTSP proves time (docs/05 §6, docs/06 M13). */
  anchor(sha256Hex: string): Promise<QualifiedTimestamp>;
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
