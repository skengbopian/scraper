import { describe, expect, it } from 'vitest';
import {
  deriveSubject,
  type EvidenceRecord,
  type Playbook,
  type PostalLetter,
  type PostalProvider,
  type RequestSnapshot,
  type TimestampAnchor,
  type Timestamper,
  type TransitionResult,
  type VerifiedIdentity,
} from '@scraper/core';
import { ControllerGateway } from '../src/gateway/controller-gateway.js';
import { StubMailer, StubPostalProvider, SimulatedTimestamper } from '../src/providers/stub-providers.js';
import { dispatchReadyRequest, prepareDispatch, type DispatchableRequest, type DispatchDeps } from '../src/workflows/dispatch.js';
import type { LetterSender } from '../src/providers/letter/din5008.js';

/** Only ever derived from the verified identity in real dispatch — see `gatewayRequest()`. */
const SENDER: LetterSender = { name: 'Erika Musterfrau', addressLines: ['Musterstraße 1', '10115 Berlin'] };

/**
 * The dispatch workflow end to end against fakes: READY → SENT → the channel → the right clock.
 *
 * Two properties this file is really testing, beyond "it works":
 *   - the COUNSEL GATE holds. Every playbook in this repo is `active: false`, and a dispatch of one
 *     must reach the ops queue rather than the wire. That is the "nothing may leave the process"
 *     rule, tested rather than asserted.
 *   - the clock follows the OUTCOME TYPE, not the channel name. There is no branch anywhere in
 *     dispatch.ts that reads 'email' and decides a deadline.
 */

const NOW = new Date('2026-08-13T09:00:00Z');

const IDENTITY: VerifiedIdentity = {
  id: 'id_1', userId: 'u1', status: 'VERIFIED', method: 'EID',
  legalName: 'Erika Mustermann', dateOfBirth: new Date('1979-03-12T00:00:00Z'),
  addresses: [{ street: 'Heidestraße 17', postalCode: '51147', city: 'Köln', country: 'DE', current: true, verifiedAt: NOW }],
  verifiedAt: NOW, providerRef: 'test',
};

function playbook(over: Partial<Playbook> = {}): Playbook {
  return {
    slug: 'test.email', kind: 'RIGHTS_REQUEST', controller: 'az-direct', requestType: 'OBJECTION_ART21',
    version: 1, active: true,
    channel: { primary: 'email' }, recipient: { email: 'datenschutz@example.de' },
    template: 'test-template', subjectFields: ['legalName', 'dateOfBirth', 'addresses'], deadlineDays: 30,
    validation: { compliedIf: { responseContains: ['gelöscht'] }, humanReviewIfConfidenceBelow: 0.8 },
    escalation: { onDeadlineExpiry: 'NONE', onRefusal: 'DRAFT_ART77' },
    ...over,
  } as Playbook;
}

function row(pb: Playbook, over: Partial<DispatchableRequest> = {}): DispatchableRequest {
  const snapshot: RequestSnapshot = {
    id: 'req_1', state: 'READY', userId: 'u1', controllerId: 'c1', requestType: 'OBJECTION_ART21',
    provableSendConfirmedAt: null, deadlineAt: null, provisionalDeadlineAt: null, proofDueAt: null,
    hasControllerResponse: false, reviewedByHuman: false, parseConfidence: null,
    humanReviewIfConfidenceBelow: 0.8, outcome: null,
  };
  return { snapshot, playbook: pb, subject: deriveSubject(IDENTITY), attachedIdentityPacketId: null, forceRegistered: false, ...over };
}

const TEMPLATE = 'Sehr geehrte Damen und Herren,\n\n{{legalName}}, geboren am {{dateOfBirth}}.\n{{primaryAddress}}\n\n{{today}}';

interface Harness {
  readonly deps: DispatchDeps;
  readonly transitions: { id: string; result: TransitionResult }[];
  readonly queued: { requestId: string; reason: string }[];
  readonly scheduled: { key: string; at: Date }[];
  readonly evidence: EvidenceRecord[];
  /** Swap what the next load() returns — the chase path re-dispatches the SAME request row. */
  readonly setRow: (next: DispatchableRequest) => void;
  /**
   * Mirror of a new entry into READY. The wire guard is per dispatch ATTEMPT (state machine §5b),
   * scoped by the most recent entry into READY — a lifetime check would block the registered
   * re-send forever (the F1 audit finding).
   */
  readonly markReadyEntry: () => void;
}

function harness(
  r: DispatchableRequest,
  timestamper: Timestamper = new SimulatedTimestamper(),
  postal: PostalProvider = new StubPostalProvider(),
): Harness {
  const transitions: Harness['transitions'] = [];
  const queued: Harness['queued'] = [];
  const scheduled: Harness['scheduled'] = [];
  const evidence: EvidenceRecord[] = [];
  const current = { row: r, attemptStart: 0 };

  const gateway = new ControllerGateway({
    mailer: new StubMailer(),
    postal,
    timestamper,
    appendEvidenceRecord: async (rec) => { evidence.push(rec); return rec; },
    latestChainHash: async () => evidence.at(-1)?.chainHash ?? null,
    hasOutboundEvidence: async () => evidence.slice(current.attemptStart).some((e) => e.kind === 'OUTBOUND_COPY'),
    countOutboundForControllerSince: async () => evidence.filter((e) => e.kind === 'OUTBOUND_COPY').length,
    maxSendsPerControllerPerHour: 10,
    objectStorePut: async (key) => `mem://${key}`,
    idFactory: () => `ev_${evidence.length + 1}`,
    now: () => NOW,
  });

  return {
    transitions, queued, scheduled, evidence,
    setRow: (next) => { current.row = next; },
    markReadyEntry: () => { current.attemptStart = evidence.length; },
    deps: {
      load: async () => current.row,
      readTemplate: async () => TEMPLATE,
      // These suites are about the send path, not the seal, so they run in the dev posture the
      // seal itself allows. `describe('the template seal at dispatch')` below exercises the other
      // side, where an unsigned letter is refused.
      readSignoffManifest: async () => ({}),
      allowUnsignedTemplates: true,
      gateway,
      applyTransition: async (id, result) => void transitions.push({ id, result }),
      recordHumanQueueEntry: async (e) => void queued.push({ requestId: e.requestId, reason: e.reason }),
      engine: { schedule: async (key, at) => void scheduled.push({ key, at }), cancel: async () => undefined },
      log: () => undefined,
      now: () => NOW,
    },
  };
}

describe('email dispatch', () => {
  it('READY → SENT → AWAITING_RESPONSE_PROVISIONAL, with only the provisional clock armed', async () => {
    const h = harness(row(playbook()));
    const note = await dispatchReadyRequest(h.deps, 'req_1');

    expect(h.transitions.map((t) => t.result.to)).toEqual(['SENT', 'AWAITING_RESPONSE_PROVISIONAL']);
    const send = h.transitions[1]!.result;
    expect(send.patch.deadlineAt).toBeNull();
    expect(send.patch.provisionalDeadlineAt).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
    expect(note).toMatch(/NOT a statutory deadline/);

    // Exactly one timer, and it is the provisional one.
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]!.key).toMatch(/:provisional:/);
  });

  it('captures the rendered copy as anchored OUTBOUND_COPY evidence before the send', async () => {
    const h = harness(row(playbook()));
    await dispatchReadyRequest(h.deps, 'req_1');
    const outbound = h.evidence.find((e) => e.kind === 'OUTBOUND_COPY');
    expect(outbound).toBeDefined();
    // The anchor IS taken on an email send — it evidences OUR send time — and it still cannot
    // authorise anything, because provableSendEvidenceIdOf() requires a POSTAL_PROOF.
    expect(outbound!.qualifiedTimestamp).not.toBeNull();
    expect(h.transitions[1]!.result.to).toBe('AWAITING_RESPONSE_PROVISIONAL');
  });

  it('refuses a second wire attempt once outbound evidence exists (Art. 12(5) duplicate risk)', async () => {
    const h = harness(row(playbook()));
    await dispatchReadyRequest(h.deps, 'req_1');
    h.transitions.length = 0;

    // A replayed job on a request that is somehow READY again — the guard is at the wire, not the state.
    const outcome = await h.deps.gateway.send({
      requestId: 'req_1', userId: 'u1', controllerId: 'c1', requestType: 'OBJECTION_ART21',
      channel: 'email', registered: false, recipient: 'x@y.de', subject: 's', body: 'b', sender: SENDER,
    });
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind === 'FAILED') expect(outcome.reason).toMatch(/already exists/);
  });
});

describe('registered dispatch', () => {
  it('with stub providers it degrades to a provisional clock and NEVER a statutory one', async () => {
    const pb = playbook({
      slug: 'test.postal', channel: { primary: 'postal', registered: { primary: true } },
      recipient: { postal: 'AZ Direct GmbH, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh' },
    });
    const h = harness(row(pb, { forceRegistered: true }));
    await dispatchReadyRequest(h.deps, 'req_1');

    expect(h.transitions.map((t) => t.result.to)).toEqual(['SENT', 'AWAITING_RESPONSE_PROVISIONAL']);
    expect(h.transitions[1]!.result.patch.deadlineAt).toBeNull();
    expect(h.scheduled[0]!.key).toMatch(/:provisional:/);
  });

  it('with a real carrier receipt AND a qualified anchor it starts the Art. 12(3) clock', async () => {
    const qualified: Timestamper = {
      async anchor(hash): Promise<TimestampAnchor> {
        return { kind: 'QUALIFIED', tsaRef: `qtsp:${hash.slice(0, 8)}`, signedAt: NOW, algorithm: 'SHA-256' };
      },
    };
    class CarrierPostal extends StubPostalProvider {
      override async send(letter: PostalLetter, opts: { registered: boolean }) {
        const base = await super.send(letter, opts);
        // `deliveredAt: NOW`, not the stub's wall-clock `new Date()`. The machine refuses a receipt
        // that claims a delivery in the future (F3a), and against a frozen test clock the wall clock
        // IS the future — so a fixture that left it real was asserting an impossible receipt.
        return base.proof
          ? { ...base, proof: { ...base.proof, origin: 'CARRIER' as const, deliveredAt: NOW } }
          : base;
      }
    }
    const pb = playbook({
      slug: 'test.postal', channel: { primary: 'postal', registered: { primary: true } },
      recipient: { postal: 'AZ Direct GmbH, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh' },
    });
    const r = row(pb, { forceRegistered: true });
    const h = harness(r, qualified);
    // Swap in the carrier provider on the gateway the harness built.
    const gateway = new ControllerGateway({
      mailer: new StubMailer(), postal: new CarrierPostal(), timestamper: qualified,
      appendEvidenceRecord: async (rec) => { h.evidence.push(rec); return rec; },
      latestChainHash: async () => h.evidence.at(-1)?.chainHash ?? null,
      hasOutboundEvidence: async () => h.evidence.some((e) => e.kind === 'OUTBOUND_COPY'),
      countOutboundForControllerSince: async () => 0,
      maxSendsPerControllerPerHour: 10,
      objectStorePut: async (key) => `mem://${key}`,
      idFactory: () => `ev_${h.evidence.length + 1}`,
      now: () => NOW,
    });
    await dispatchReadyRequest({ ...h.deps, gateway }, 'req_1');

    expect(h.transitions.map((t) => t.result.to)).toEqual(['SENT', 'AWAITING_RESPONSE']);
    // One CALENDAR month from 13 Aug: 13 Sep 2026 is a Sunday → end of Mon 14 Sep, Berlin midnight.
    expect(h.transitions[1]!.result.patch.deadlineAt).toEqual(new Date('2026-09-14T22:00:00Z'));
    expect(h.scheduled[0]!.key).toMatch(/:statutory:/);
    // The id that authorised the clock is the POSTAL_PROOF record's — not the OUTBOUND_COPY's.
    const proof = h.evidence.find((e) => e.kind === 'POSTAL_PROOF');
    expect(proof?.qualifiedTimestamp?.kind).toBe('QUALIFIED');
  });

  it('the chase path: the registered re-send after an email attempt reaches the wire (§5b is per ATTEMPT)', async () => {
    // Regression for audit F1: a lifetime-scoped wire guard blocked the same row's second dispatch,
    // so the user-authorised registered re-send looped FAILED → NEEDS_HUMAN forever and the
    // Art. 12(3) clock was unreachable after any email send.
    const qualified: Timestamper = {
      async anchor(hash): Promise<TimestampAnchor> {
        return { kind: 'QUALIFIED', tsaRef: `qtsp:${hash.slice(0, 8)}`, signedAt: NOW, algorithm: 'SHA-256' };
      },
    };
    class CarrierPostal extends StubPostalProvider {
      override async send(letter: PostalLetter, opts: { registered: boolean }) {
        const base = await super.send(letter, opts);
        // `deliveredAt: NOW`, not the stub's wall-clock `new Date()`. The machine refuses a receipt
        // that claims a delivery in the future (F3a), and against a frozen test clock the wall clock
        // IS the future — so a fixture that left it real was asserting an impossible receipt.
        return base.proof
          ? { ...base, proof: { ...base.proof, origin: 'CARRIER' as const, deliveredAt: NOW } }
          : base;
      }
    }
    const pb = playbook({
      slug: 'test.chase',
      channel: { primary: 'email', fallback: 'postal', registered: { primary: false, fallback: true } },
      recipient: { email: 'datenschutz@example.de', postal: 'AZ Direct GmbH, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh' },
      escalation: { onDeadlineExpiry: 'DRAFT_ART77', onRefusal: 'DRAFT_ART77' },
    });
    const first = row(pb);
    const h = harness(first, qualified, new CarrierPostal());

    // Attempt 1: email. Captures OUTBOUND_COPY, arms only the provisional clock.
    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.transitions.map((t) => t.result.to)).toEqual(['SENT', 'AWAITING_RESPONSE_PROVISIONAL']);
    expect(h.evidence.filter((e) => e.kind === 'OUTBOUND_COPY')).toHaveLength(1);

    // Silence → AWAITING_REGISTERED_RESEND → userConfirmsResend → a NEW entry into READY.
    h.transitions.length = 0;
    h.scheduled.length = 0;
    h.markReadyEntry();
    h.setRow({ ...first, forceRegistered: true });

    const note = await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.queued).toHaveLength(0);
    expect(note).toMatch(/provable send confirmed/);
    expect(h.transitions.map((t) => t.result.to)).toEqual(['SENT', 'AWAITING_RESPONSE']);
    expect(h.transitions[1]!.result.patch.deadlineAt).not.toBeNull();
    expect(h.evidence.filter((e) => e.kind === 'OUTBOUND_COPY')).toHaveLength(2);
    expect(h.scheduled[0]!.key).toMatch(/:statutory:/);

    // Within the SAME attempt, a replayed wire call is still refused — that guard must survive.
    const replay = await h.deps.gateway.send({
      requestId: 'req_1', userId: 'u1', controllerId: 'c1', requestType: 'OBJECTION_ART21',
      // Deliberately an unpostable recipient: the at-most-once wire guard runs BEFORE the letter is
      // laid out, so this must still come back FAILED for the duplicate reason and never for the
      // address. If that order ever inverts, this test says so.
      channel: 'postal', registered: true, recipient: 'x', subject: 's', body: 'b', sender: SENDER,
    });
    expect(replay.kind).toBe('FAILED');
    if (replay.kind === 'FAILED') expect(replay.reason).toMatch(/already exists/);
  });
});

describe('the counsel gate and the human queue', () => {
  it('an inactive playbook never reaches the wire — the request stays READY', async () => {
    const h = harness(row(playbook({ active: false })));
    const note = await dispatchReadyRequest(h.deps, 'req_1');

    expect(h.transitions).toHaveLength(0); // not even READY → SENT
    expect(h.evidence).toHaveLength(0);
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0]!.reason).toMatch(/counsel signs it off/);
    expect(note).toMatch(/human queue/);
  });

  it('a web-form playbook goes to the human queue: Phase 0 does not automate forms', async () => {
    const pb = playbook({ channel: { primary: 'web_form' }, recipient: { webForm: 'https://example.de/dsgvo' } });
    const h = harness(row(pb));
    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.transitions).toHaveLength(0);
    expect(h.queued[0]!.reason).toMatch(/does not automate/);
  });

  it('a forced registered re-send with no postal+registered channel is queued, not faked', async () => {
    const h = harness(row(playbook(), { forceRegistered: true }));
    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.queued[0]!.reason).toMatch(/no provable send is reachable/);
    expect(h.transitions).toHaveLength(0);
  });

  it('a request that is not READY is skipped rather than re-dispatched', async () => {
    const r = row(playbook());
    const h = harness({ ...r, snapshot: { ...r.snapshot, state: 'AWAITING_RESPONSE_PROVISIONAL' } });
    expect(await dispatchReadyRequest(h.deps, 'req_1')).toMatch(/not READY/);
    expect(h.transitions).toHaveLength(0);
  });
});

describe('the per-controller flood brake', () => {
  it('refuses the wire once the hourly cap is reached (CLAUDE.md C1 — anomaly, not throughput)', async () => {
    const h = harness(row(playbook()));
    // The harness counts ALL prior OUTBOUND_COPY records; force the cap to zero remaining.
    const gateway = h.deps.gateway;
    const capped = {
      ...h.deps,
      gateway: {
        send: async (r: Parameters<typeof gateway.send>[0]) => {
          const g = new ControllerGateway({
            mailer: new StubMailer(), postal: new StubPostalProvider(), timestamper: new SimulatedTimestamper(),
            appendEvidenceRecord: async (rec) => { h.evidence.push(rec); return rec; },
            latestChainHash: async () => null,
            hasOutboundEvidence: async () => false,
            countOutboundForControllerSince: async () => 10,
            maxSendsPerControllerPerHour: 10,
            objectStorePut: async (key) => `mem://${key}`,
            idFactory: () => 'ev_x',
            now: () => NOW,
          });
          return g.send(r);
        },
      },
    };
    const note = await dispatchReadyRequest(capped, 'req_1');
    expect(note).toMatch(/NEEDS_HUMAN/);
    expect(note).toMatch(/send cap/);
    // Nothing was captured for the wire: the brake fires before evidence capture.
    expect(h.evidence.filter((e) => e.kind === 'OUTBOUND_COPY')).toHaveLength(0);
  });
});

describe('prepareDispatch is pure', () => {
  it('renders without performing any I/O, and reports the deadline days the playbook declares', () => {
    const prepared = prepareDispatch(row(playbook({ deadlineDays: 14 })), TEMPLATE, NOW);
    expect(prepared.kind).toBe('SEND');
    if (prepared.kind === 'SEND') {
      expect(prepared.deadlineDays).toBe(14);
      expect(prepared.body).toContain('Erika Mustermann');
      expect(prepared.plan.expectedEvent).toBe('sendAccepted:nonProvable');
    }
  });
});

// ---------------------------------------------------------------------------------------------
// F3a — the asynchronous provable send, end to end through the worker.
//
// The default StubPostalProvider returns a receipt for every registered send, which is not what a
// carrier does. `LodgingPostal` is the honest one: it accepts the letter and returns `proof: null`,
// exactly like the corrected LetterXpress adapter (audit F3b). Before AWAITING_DELIVERY_PROOF
// existed this shape took the PROVISIONAL clock and could never be upgraded — so the Art. 12(3)
// clock was unreachable for every real registered send in production.
// ---------------------------------------------------------------------------------------------
class LodgingPostal extends StubPostalProvider {
  override async send(letter: PostalLetter, opts: { registered: boolean }) {
    const base = await super.send(letter, opts);
    return { ...base, proof: null };
  }
}

describe('registered lodgement (the honest carrier)', () => {
  const POSTAL = playbook({
    slug: 'test.lodged',
    channel: { primary: 'postal', registered: { primary: true } },
    recipient: { postal: 'AZ Direct GmbH, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh' },
  });

  it('a lodged registered send parks in AWAITING_DELIVERY_PROOF with NO clock', async () => {
    const h = harness(row(POSTAL, { forceRegistered: true }), new SimulatedTimestamper(), new LodgingPostal());
    const note = await dispatchReadyRequest(h.deps, 'req_1');

    expect(h.transitions.map((t) => t.result.to)).toEqual(['SENT', 'AWAITING_DELIVERY_PROOF']);
    const lodged = h.transitions[1]!.result;
    expect(lodged.event).toBe('registeredSendLodged');
    expect(lodged.patch.deadlineAt).toBeNull();
    expect(lodged.patch.provisionalDeadlineAt).toBeNull();
    expect(lodged.patch.proofDueAt).toEqual(new Date(NOW.getTime() + 14 * 86_400_000));
    expect(note).toMatch(/no clock runs/);
  });

  it('arms a PROOF timer, not a deadline timer', async () => {
    const h = harness(row(POSTAL, { forceRegistered: true }), new SimulatedTimestamper(), new LodgingPostal());
    await dispatchReadyRequest(h.deps, 'req_1');

    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0]!.key).toMatch(/:proof:/);
    expect(h.scheduled[0]!.key).not.toMatch(/:statutory:|:provisional:/);
  });

  it('the outbound letter is still captured as evidence — the send DID happen', async () => {
    const h = harness(row(POSTAL, { forceRegistered: true }), new SimulatedTimestamper(), new LodgingPostal());
    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.evidence.filter((e) => e.kind === 'OUTBOUND_COPY')).toHaveLength(1);
    // ...but no POSTAL_PROOF, because no receipt came back. That asymmetry is the whole state.
    expect(h.evidence.filter((e) => e.kind === 'POSTAL_PROOF')).toHaveLength(0);
  });
});
