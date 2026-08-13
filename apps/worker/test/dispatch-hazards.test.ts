import { describe, expect, it } from 'vitest';
import {
  apply,
  appendEvidence,
  provableSendEvidenceIdOf,
  TRANSITIONS,
  UnprovableSendError,
  type DeliveryProof,
  type EvidenceRecord,
  type Mailer,
  type PostalProvider,
  type RequestSnapshot,
  type TimestampAnchor,
  type Timestamper,
  type TransitionResult,
} from '@scraper/core';
import { sendLegalRequestEmail } from '../src/channels/email.js';
import { sendPostalLetter } from '../src/channels/postal.js';
import { eventFor } from '../src/channels/types.js';
import { handleDeadlineExpiry } from '../src/workflows/deadline.js';
import { INGESTIBLE_STATES } from '../src/workflows/ingest.js';
import { StubPostalProvider, SimulatedTimestamper, StubMailer } from '../src/providers/stub-providers.js';

/**
 * The four hazards port wave 5 exists to close (docs/port-plan-from-A.md; ADR-037).
 *
 * Each of these is a defect the pre-audit line's dispatch layer HAS, at a cited line, and which a
 * verbatim port would have re-imported. They are written as the failing case, not as the happy path:
 * a test that only proves email sets a provisional deadline would still pass if a second code path
 * also set a statutory one.
 */

const NOW = new Date('2026-08-13T09:00:00Z');

function snapshot(over: Partial<RequestSnapshot> = {}): RequestSnapshot {
  return {
    id: 'req_test', state: 'SENT', userId: 'u1', controllerId: 'c1', requestType: 'OBJECTION_ART21',
    provableSendConfirmedAt: null, deadlineAt: null, provisionalDeadlineAt: null,
    hasControllerResponse: false, reviewedByHuman: false, parseConfidence: null,
    humanReviewIfConfidenceBelow: 0.8, outcome: null, ...over,
  };
}

const QUALIFIED_TIMESTAMPER: Timestamper = {
  async anchor(hash): Promise<TimestampAnchor> {
    return { kind: 'QUALIFIED', tsaRef: `qtsp:${hash.slice(0, 12)}`, signedAt: NOW, algorithm: 'SHA-256' };
  },
};

const CARRIER_PROOF: DeliveryProof = {
  kind: 'EINWURF_EINSCHREIBEN', trackingRef: 'RR123456789DE', deliveredAt: NOW, origin: 'CARRIER',
};

async function postalProofRecord(timestamper: Timestamper, proof: DeliveryProof): Promise<EvidenceRecord> {
  return appendEvidence(
    {
      requestId: 'req_test', kind: 'POSTAL_PROOF', content: `receipt ${proof.trackingRef}`,
      storageRef: `s3://evidence/req_test/postal-proof-${proof.trackingRef}.txt`,
      prevHash: null, now: NOW, idFactory: () => 'ev_1',
    },
    timestamper,
  );
}

// ------------------------------------------------------------------------------------------------
// HAZARD 1 — an email send must NEVER produce a statutory deadline
//   A: apps/worker/src/channels/email.ts:22 returns `{ providerRef, provable: true }`
// ------------------------------------------------------------------------------------------------

describe('hazard 1: an email send never starts the statutory clock', () => {
  it('the email adapter cannot even express a provable outcome', async () => {
    const outcome = await sendLegalRequestEmail(new StubMailer(), { to: 'a@b.de', subject: 's', text: 't' }, NOW);
    // The stub mailer returns accepted:true AND dkimAligned:true — the exact pair that mapped onto
    // the provable edge in the pre-audit line. The best it can produce here is non-provable.
    expect(outcome.kind).toBe('ACCEPTED_NON_PROVABLE');
    expect(eventFor(outcome)).toBe('sendAccepted:nonProvable');
    // There is no `provable` field to read, and no DELIVERY_PROVEN variant in this return type.
    expect(Object.keys(outcome)).not.toContain('provable');
  });

  it('the transition an email send maps to leaves deadlineAt null and sets only the provisional hint', () => {
    const result = apply(snapshot(), 'sendAccepted:nonProvable', { actor: 'SYSTEM', now: NOW, deadlineDays: 30 });
    expect(result.to).toBe('AWAITING_RESPONSE_PROVISIONAL');
    expect(result.patch.deadlineAt).toBeNull();
    expect(result.patch.provisionalDeadlineAt).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
    expect(result.patch.provableSendConfirmedAt).toBeUndefined();
  });

  it('no email path can reach provableSendConfirmed, because the id has no other constructor', async () => {
    // The only way to obtain a ProvableSendEvidenceId is provableSendEvidenceIdOf(), which demands a
    // POSTAL_PROOF. An OUTBOUND_COPY anchor — which an email send DOES get, and which is a genuine
    // qualified timestamp — is structurally the wrong shape. This is A's subtle re-entry, closed.
    const outboundCopy = await appendEvidence(
      { requestId: 'req_test', kind: 'OUTBOUND_COPY', content: 'letter', storageRef: 's3://x', prevHash: null, now: NOW, idFactory: () => 'ev_out' },
      QUALIFIED_TIMESTAMPER,
    );
    expect(outboundCopy.qualifiedTimestamp?.kind).toBe('QUALIFIED');
    expect(() => provableSendEvidenceIdOf(outboundCopy, CARRIER_PROOF)).toThrowError(UnprovableSendError);
    try {
      provableSendEvidenceIdOf(outboundCopy, CARRIER_PROOF);
    } catch (e) {
      expect((e as UnprovableSendError).reason).toBe('WRONG_EVIDENCE_KIND');
    }
  });

  it('provableSendConfirmed is refused outright without an evidence id', () => {
    expect(() => apply(snapshot(), 'provableSendConfirmed', { actor: 'SYSTEM', now: NOW, deadlineDays: 30 })).toThrowError(
      /requires a QTSP-anchored evidence record id/,
    );
  });
});

// ------------------------------------------------------------------------------------------------
// HAZARD 2 — a stub proof must not satisfy provableSendConfirmed
//   A: StubPostalProvider returns `proofRef: 'stub:einwurf-proof-N'` for any registered:true call
// ------------------------------------------------------------------------------------------------

describe('hazard 2: a simulated proof cannot start a legal clock', () => {
  it('the stub postal provider marks its receipt SIMULATED', async () => {
    const result = await new StubPostalProvider().send({ text: 't', recipient: 'r' }, { registered: true });
    expect(result.proof).not.toBeNull();
    expect(result.proof?.origin).toBe('SIMULATED');
  });

  it('a simulated ANCHOR is refused even with a carrier receipt', async () => {
    const record = await postalProofRecord(new SimulatedTimestamper(), CARRIER_PROOF);
    expect(record.qualifiedTimestamp?.kind).toBe('SIMULATED');
    try {
      provableSendEvidenceIdOf(record, CARRIER_PROOF);
      throw new Error('expected a refusal');
    } catch (e) {
      expect(e).toBeInstanceOf(UnprovableSendError);
      expect((e as UnprovableSendError).reason).toBe('SIMULATED_ANCHOR');
    }
  });

  it('a simulated RECEIPT is refused even with a qualified anchor', async () => {
    const simulatedProof: DeliveryProof = { ...CARRIER_PROOF, origin: 'SIMULATED' };
    const record = await postalProofRecord(QUALIFIED_TIMESTAMPER, simulatedProof);
    try {
      provableSendEvidenceIdOf(record, simulatedProof);
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as UnprovableSendError).reason).toBe('SIMULATED_PROOF');
    }
  });

  it('an anchor over the wrong artefact is refused (a receipt cannot be evidenced by anchoring the letter)', async () => {
    const record = await appendEvidence(
      { requestId: 'req_test', kind: 'POSTAL_PROOF', content: 'x', storageRef: 's3://evidence/req_test/some-other-file.txt', prevHash: null, now: NOW, idFactory: () => 'ev_2' },
      QUALIFIED_TIMESTAMPER,
    );
    try {
      provableSendEvidenceIdOf(record, CARRIER_PROOF);
      throw new Error('expected a refusal');
    } catch (e) {
      expect((e as UnprovableSendError).reason).toBe('PROOF_MISMATCH');
    }
  });

  it('BOTH facts together mint the id — and only then does the statutory clock start', async () => {
    const record = await postalProofRecord(QUALIFIED_TIMESTAMPER, CARRIER_PROOF);
    const id = provableSendEvidenceIdOf(record, CARRIER_PROOF);
    const result = apply(snapshot(), 'provableSendConfirmed', {
      actor: 'SYSTEM', now: NOW, deadlineDays: 30, provableSendEvidenceId: id,
    });
    expect(result.to).toBe('AWAITING_RESPONSE');
    expect(result.patch.deadlineAt).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
    expect(result.patch.provableSendConfirmedAt).toEqual(NOW);
  });

  it('the whole stub postal channel degrades to a PROVISIONAL clock instead of inventing a legal one', async () => {
    const postal: PostalProvider = new StubPostalProvider();
    const timestamper = new SimulatedTimestamper();
    const outcome = await sendPostalLetter(
      postal, { text: 'letter', recipient: 'Musterstr. 1' }, { registered: true },
      (proof) => postalProofRecord(timestamper, proof), NOW,
    );
    expect(outcome.kind).toBe('ACCEPTED_NON_PROVABLE');
    expect(eventFor(outcome)).toBe('sendAccepted:nonProvable');
    if (outcome.kind === 'ACCEPTED_NON_PROVABLE') {
      expect(outcome.note).toMatch(/NOT provable/);
      expect(outcome.note).toMatch(/SIMULATED_(ANCHOR|PROOF)/);
    }
  });
});

// ------------------------------------------------------------------------------------------------
// HAZARD 3 — a provisional expiry must never reach ESCALATION_DRAFTED
//   A: a single expiry path that drafts an Art. 77 complaint
// ------------------------------------------------------------------------------------------------

describe('hazard 3: the two expiry paths are different destinations', () => {
  const applied: TransitionResult[] = [];
  const deps = (r: RequestSnapshot) => ({
    load: async () => r,
    applyTransition: async (_id: string, result: TransitionResult) => void applied.push(result),
    now: () => new Date(NOW.getTime() + 86_400_000),
  });

  it('a provisional expiry goes to the chase step, not to a complaint', async () => {
    applied.length = 0;
    const r = snapshot({ state: 'AWAITING_RESPONSE_PROVISIONAL', provisionalDeadlineAt: NOW });
    const note = await handleDeadlineExpiry(deps(r), { requestId: r.id, kind: 'provisional' });
    expect(applied[0]?.to).toBe('AWAITING_REGISTERED_RESEND');
    expect(applied[0]?.to).not.toBe('ESCALATION_DRAFTED');
    expect(note).toMatch(/AWAITING_REGISTERED_RESEND/);
  });

  it('the statutory expiry event is not even legal from the provisional state', () => {
    const r = snapshot({ state: 'AWAITING_RESPONSE_PROVISIONAL', provisionalDeadlineAt: NOW });
    // Invariant 3a is STRUCTURAL: `deadlineExpired` has exactly one `from`, and it is not this one.
    expect(() => apply(r, 'deadlineExpired', { actor: 'SYSTEM', now: NOW })).toThrowError(/Illegal transition/);
    expect(TRANSITIONS.filter((t) => t.event === 'deadlineExpired').map((t) => t.from)).toEqual(['AWAITING_RESPONSE']);
  });

  it('a statutory expiry drafts — and ESCALATED stays reachable only by a human', async () => {
    applied.length = 0;
    const r = snapshot({ state: 'AWAITING_RESPONSE', deadlineAt: NOW, provableSendConfirmedAt: NOW });
    await handleDeadlineExpiry(deps(r), { requestId: r.id, kind: 'statutory' });
    expect(applied[0]?.to).toBe('ESCALATION_DRAFTED');

    const drafted = snapshot({ state: 'ESCALATION_DRAFTED', provableSendConfirmedAt: NOW });
    expect(() => apply(drafted, 'humanSend', { actor: 'SYSTEM', now: NOW })).toThrowError(/requires actor HUMAN_OPS/);
    expect(TRANSITIONS.filter((t) => t.to === 'ESCALATED')).toHaveLength(1);
  });

  it('a stale timer is a no-op, and an early one does not fire', async () => {
    applied.length = 0;
    const responded = snapshot({ state: 'RESPONSE_RECEIVED' });
    expect(await handleDeadlineExpiry(deps(responded), { requestId: responded.id, kind: 'provisional' })).toMatch(/stale/);

    const future = new Date(NOW.getTime() + 10 * 86_400_000);
    const notYet = snapshot({ state: 'AWAITING_RESPONSE_PROVISIONAL', provisionalDeadlineAt: future });
    expect(await handleDeadlineExpiry(deps(notYet), { requestId: notYet.id, kind: 'provisional' })).toMatch(/not yet due/);
    expect(applied).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------
// HAZARD 4 — a reply to an emailed request must be ingested, not dropped
//   A: apps/worker/src/workflows/ingest-response.ts:109 gates on state === 'AWAITING_RESPONSE'
// ------------------------------------------------------------------------------------------------

describe('hazard 4: replies are accepted from every state that has the edge', () => {
  it('AWAITING_RESPONSE_PROVISIONAL is ingestible — the state A would have dropped', () => {
    expect(INGESTIBLE_STATES).toContain('AWAITING_RESPONSE_PROVISIONAL');
    expect(INGESTIBLE_STATES).toContain('AWAITING_RESPONSE');
  });

  it('the ingestible set is exactly the transition table\'s responseIngested edges — no hand-written list', () => {
    const fromTable = TRANSITIONS.filter((t) => t.event === 'responseIngested').map((t) => t.from).sort();
    expect([...INGESTIBLE_STATES].sort()).toEqual(fromTable);
  });

  it('includes the late-reply states, which a single-state gate also loses (H1)', () => {
    for (const late of ['INCOMPLETE', 'REFUSED', 'ESCALATION_DRAFTED', 'ESCALATED'] as const) {
      expect(INGESTIBLE_STATES).toContain(late);
    }
  });
});
