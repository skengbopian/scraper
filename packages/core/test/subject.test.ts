import { describe, expect, it } from 'vitest';
import {
  assertSubjectBelongsTo,
  deriveSubject,
  IdentityNotVerifiedError,
  isRequestSubject,
  projectSubject,
  runGuards,
  type MandateSnapshot,
  type VerifiedIdentity,
} from '../src/index.js';

const NOW = new Date('2026-08-07T10:00:00Z');

function identity(over: Partial<VerifiedIdentity> = {}): VerifiedIdentity {
  return {
    id: 'id_1',
    userId: 'u1',
    status: 'VERIFIED',
    method: 'EID',
    legalName: 'Erika Mustermann',
    dateOfBirth: new Date('1979-03-12T00:00:00Z'),
    addresses: [
      { street: 'Heidestraße 17', postalCode: '51147', city: 'Köln', country: 'DE', current: true, verifiedAt: NOW },
    ],
    verifiedAt: NOW,
    providerRef: 'idnow_abc',
    ...over,
  };
}

const mandate: MandateSnapshot = {
  id: 'm1', userId: 'u1', scope: ['ACCESS_ART15_SOURCE'], signedAt: NOW, revokedAt: null,
};

// ---------------------------------------------------------------------------------------------
// THE RULE THAT OUTRANKS ALL OTHERS.
// ---------------------------------------------------------------------------------------------
describe('GUARDRAIL — a request subject that is not the verified identity is unrepresentable', () => {
  it('there is no exported constructor for RequestSubject other than deriveSubject', async () => {
    const mod = await import('../src/identity/subject.js');
    const fns = Object.keys(mod).filter((k) => typeof (mod as never)[k] === 'function');
    // If a function is added here that builds a subject from loose fields, this test is what should
    // stop it. Update the list deliberately, never reflexively — and never to add something that
    // takes a name, DOB or address as an argument.
    expect(fns.sort()).toEqual(
      ['IdentityNotVerifiedError', 'assertSubjectBelongsTo', 'deriveSubject', 'isRequestSubject', 'projectSubject'].sort(),
    );
  });

  it('a hand-built look-alike object is rejected at the send boundary', () => {
    // The type system blocks this at compile time; this proves the runtime brand also holds, which is
    // what matters once a value has crossed a queue or a JSON boundary.
    const forged = {
      identityId: 'id_1', userId: 'u1', verifiedAt: NOW,
      legalName: 'Somebody Else', dateOfBirth: new Date('1990-01-01T00:00:00Z'),
      primaryAddress: { street: 'X 1', postalCode: '10115', city: 'Berlin', country: 'DE', current: true, verifiedAt: NOW },
      additionalAddresses: [],
    } as unknown as ReturnType<typeof deriveSubject>;
    expect(() => assertSubjectBelongsTo(forged, 'u1', 'id_1')).toThrow(/not a RequestSubject produced by deriveSubject/);
    expect(isRequestSubject(forged)).toBe(false);
    expect(isRequestSubject(deriveSubject(identity()))).toBe(true);
  });

  it('deriveSubject refuses an UNVERIFIED identity', () => {
    expect(() => deriveSubject(identity({ status: 'UNVERIFIED' }))).toThrow(IdentityNotVerifiedError);
  });

  it('deriveSubject refuses PENDING and EXPIRED identities', () => {
    for (const status of ['PENDING', 'EXPIRED'] as const) {
      expect(() => deriveSubject(identity({ status }))).toThrow(IdentityNotVerifiedError);
    }
  });

  it('deriveSubject refuses a VERIFIED identity with no verifiedAt timestamp', () => {
    expect(() => deriveSubject(identity({ verifiedAt: null }))).toThrow(IdentityNotVerifiedError);
  });

  it('refuses to render when the identity has no single current address', () => {
    expect(() => deriveSubject(identity({ addresses: [] }))).toThrow(/exactly one is required/);
    expect(() =>
      deriveSubject(identity({
        addresses: [
          { street: 'A 1', postalCode: '10115', city: 'Berlin', country: 'DE', current: true, verifiedAt: NOW },
          { street: 'B 2', postalCode: '20095', city: 'Hamburg', country: 'DE', current: true, verifiedAt: NOW },
        ],
      })),
    ).toThrow(/exactly one is required/);
  });

  it('the derived subject carries only the verified identity’s own values', () => {
    const s = deriveSubject(identity());
    expect(s.legalName).toBe('Erika Mustermann');
    expect(s.identityId).toBe('id_1');
    expect(s.userId).toBe('u1');
  });

  it('the derived subject is frozen — it cannot be retargeted after derivation', () => {
    const s = deriveSubject(identity());
    expect(Object.isFrozen(s)).toBe(true);
    expect(() => {
      (s as unknown as { legalName: string }).legalName = 'Someone Else';
    }).toThrow();
  });

  it('assertSubjectBelongsTo catches a subject paired with the wrong request', () => {
    const s = deriveSubject(identity());
    expect(() => assertSubjectBelongsTo(s, 'u2', 'id_1')).toThrow(/mismatch/);
    expect(() => assertSubjectBelongsTo(s, 'u1', 'id_9')).toThrow(/mismatch/);
    expect(() => assertSubjectBelongsTo(s, 'u1', 'id_1')).not.toThrow();
  });

  it('the guard rejects an identity belonging to a different user', () => {
    const out = runGuards({
      requestId: 'r1', userId: 'u1', controllerId: 'infoscore', requestType: 'ACCESS_ART15_SOURCE',
      identity: identity({ userId: 'u_other' }), mandates: [mandate], nonTerminalSiblings: [], now: NOW,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failed).toBe('identity');
  });

  it('projectSubject emits only the fields the playbook declared (minimisation)', () => {
    const s = deriveSubject(identity());
    expect(Object.keys(projectSubject(s, ['legalName']))).toEqual(['legalName']);
    expect(Object.keys(projectSubject(s, ['legalName', 'addresses'])).sort())
      .toEqual(['additionalAddresses', 'legalName', 'primaryAddress']);
    expect(projectSubject(s, ['legalName'])).not.toHaveProperty('dateOfBirth');
  });
});

// ---------------------------------------------------------------------------------------------
// Guards, incl. the C3 idempotency self-exclusion.
// ---------------------------------------------------------------------------------------------
describe('guards', () => {
  const baseInput = {
    requestId: 'r1', userId: 'u1', controllerId: 'infoscore',
    requestType: 'ACCESS_ART15_SOURCE' as const, identity: identity(), mandates: [mandate], now: NOW,
  };

  it('passes for a verified identity with a live in-scope mandate and no siblings', () => {
    expect(runGuards({ ...baseInput, nonTerminalSiblings: [] }).ok).toBe(true);
  });

  it('routes an unverified identity to the identity failure (recoverable)', () => {
    const out = runGuards({ ...baseInput, identity: identity({ status: 'PENDING' }), nonTerminalSiblings: [] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failed).toBe('identity');
  });

  it('rejects a revoked mandate', () => {
    const out = runGuards({
      ...baseInput, mandates: [{ ...mandate, revokedAt: NOW }], nonTerminalSiblings: [],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failed).toBe('mandate');
  });

  it('rejects a mandate that does not cover this request type', () => {
    const out = runGuards({
      ...baseInput, mandates: [{ ...mandate, scope: ['OBJECTION_ART21'] }], nonTerminalSiblings: [],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failed).toBe('mandate');
  });

  it('blocks an accidental duplicate while another request is open', () => {
    const out = runGuards({
      ...baseInput,
      nonTerminalSiblings: [{ id: 'r_other', userId: 'u1', controllerId: 'infoscore', requestType: 'ACCESS_ART15_SOURCE' }],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.failed).toBe('idempotency');
  });

  it('C3 — SELF-EXCLUSION: a resend does not block on its own open row', () => {
    // This is the exact case that would have dead-ended the flagship's chase path.
    const out = runGuards({
      ...baseInput,
      nonTerminalSiblings: [{ id: 'r1', userId: 'u1', controllerId: 'infoscore', requestType: 'ACCESS_ART15_SOURCE' }],
    });
    expect(out.ok, 'the request must not block on itself').toBe(true);
  });

  it('C3 — a different controller or request type is not a duplicate', () => {
    expect(runGuards({
      ...baseInput,
      nonTerminalSiblings: [{ id: 'r_x', userId: 'u1', controllerId: 'schufa', requestType: 'ACCESS_ART15_SOURCE' }],
    }).ok).toBe(true);
    expect(runGuards({
      ...baseInput,
      nonTerminalSiblings: [{ id: 'r_y', userId: 'u1', controllerId: 'infoscore', requestType: 'ACCESS_ART15' }],
    }).ok).toBe(true);
  });

  it('C3 — the provenance chain may re-object to a broker whose earlier cycle has closed', () => {
    // No non-terminal sibling => the M1 objection is closed => the follow-up is allowed.
    expect(runGuards({
      ...baseInput,
      controllerId: 'az-direct',
      requestType: 'OBJECTION_ART21',
      mandates: [{ ...mandate, scope: ['OBJECTION_ART21'] }],
      nonTerminalSiblings: [],
    }).ok).toBe(true);
  });
});
