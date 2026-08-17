import { deriveSubject, sealHash, type Playbook, type RequestSnapshot, type SignoffManifest, type TransitionResult, type VerifiedIdentity } from '@scraper/core';
import { describe, expect, it } from 'vitest';
import { dispatchReadyRequest, type DispatchableRequest, type DispatchDeps } from '../src/workflows/dispatch.js';

/**
 * THE SEAL AT DISPATCH (stage 4 item 6) — the runtime mirror of "production refuses stub providers".
 *
 * `corpus:activate` already refuses to activate a playbook whose bound template is not SIGNED. That
 * is the gate that matters most, and it is not enough on its own: activation happens once, and the
 * file stays editable afterwards. A signature checked only at activation is a signature on a
 * FILENAME — which is precisely the defect `templates/.signoff.json` was built to end.
 */

const NOW = new Date('2026-08-15T10:00:00Z');
const TEMPLATE = '<!--\nDRAFT — awaiting counsel.\n-->\n\nSehr geehrte Damen und Herren,\n\n{{legalName}}\n{{primaryAddress}}\n{{today}}';
const SIGNED_TEMPLATE = '<!--\nApproved.\n-->\n\nSehr geehrte Damen und Herren,\n\n{{legalName}}\n{{primaryAddress}}\n{{today}}';

const IDENTITY: VerifiedIdentity = {
  id: 'id_1',
  userId: 'u1',
  status: 'VERIFIED',
  method: 'EID',
  legalName: 'Erika Musterfrau',
  dateOfBirth: new Date('1985-03-02T00:00:00Z'),
  providerRef: 'stub:1',
  verifiedAt: new Date('2026-01-01T00:00:00Z'),
  addresses: [
    { street: 'Musterstraße 1', postalCode: '10115', city: 'Berlin', country: 'DE', current: true, verifiedAt: new Date('2026-01-01T00:00:00Z') },
  ],
};

const PLAYBOOK: Playbook = {
  slug: 'test.seal',
  kind: 'RIGHTS_REQUEST',
  controller: 'az-direct',
  requestType: 'OBJECTION_ART21',
  version: 1,
  active: true,
  channel: { primary: 'email' },
  recipient: { email: 'datenschutz@example.de' },
  template: 'art21-test',
  subjectFields: ['legalName', 'dateOfBirth', 'addresses'],
  deadlineDays: 30,
  validation: { compliedIf: { responseContains: ['gelöscht'] }, humanReviewIfConfidenceBelow: 0.8 },
  escalation: { onDeadlineExpiry: 'NONE', onRefusal: 'DRAFT_ART77' },
} as unknown as Playbook;

const SNAPSHOT: RequestSnapshot = {
  id: 'req_1', userId: 'u1', controllerId: 'c1', requestType: 'OBJECTION_ART21',
  state: 'READY', deadlineAt: null, provisionalDeadlineAt: null,
} as unknown as RequestSnapshot;

function harness(manifest: SignoffManifest, allowUnsigned: boolean, template = TEMPLATE) {
  const queued: { requestId: string; reason: string }[] = [];
  const transitions: { id: string; result: TransitionResult }[] = [];
  const row: DispatchableRequest = {
    snapshot: SNAPSHOT,
    playbook: PLAYBOOK,
    subject: deriveSubject(IDENTITY, 'u1'),
    attachedIdentityPacketId: null,
    forceRegistered: false,
  };
  const deps = {
    load: async () => row,
    readTemplate: async () => template,
    readSignoffManifest: async () => manifest,
    allowUnsignedTemplates: allowUnsigned,
    gateway: { send: async () => ({ kind: 'ACCEPTED_NON_PROVABLE' as const, channel: 'email' as const, providerRef: 'm1', sentAt: NOW, note: 'ok' }) },
    applyTransition: async (id: string, result: TransitionResult) => void transitions.push({ id, result }),
    recordHumanQueueEntry: async (e: { requestId: string; reason: string }) => void queued.push({ requestId: e.requestId, reason: e.reason }),
    engine: { schedule: async () => undefined, cancel: async () => undefined },
    log: () => undefined,
    now: () => NOW,
  } as unknown as DispatchDeps;
  return { deps, queued, transitions };
}

const signedEntry = (body: string) => ({
  status: 'SIGNED' as const,
  sha256_stripped: sealHash(body),
  counsel: 'Dr. jur. Beispiel, Fachanwältin für IT-Recht',
  signedAt: '2026-08-01',
});

describe('outside dev posture, an unsigned letter never reaches the wire', () => {
  it('refuses a DRAFT template', async () => {
    const h = harness({ 'art21-test.md': { status: 'DRAFT', sha256_stripped: sealHash(TEMPLATE), counsel: null, signedAt: null } }, false);
    const note = await dispatchReadyRequest(h.deps, 'req_1');

    expect(note).toMatch(/human queue/);
    expect(h.queued[0]!.reason).toMatch(/not counsel-signed/);
    expect(h.queued[0]!.reason).toMatch(/status is DRAFT/);
    // NOT a transition: the request never left READY, so there is nothing sent and nothing to undo.
    expect(h.transitions).toEqual([]);
  });

  it('refuses a template with no manifest entry at all', async () => {
    const h = harness({}, false);
    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.queued[0]!.reason).toMatch(/no entry for "art21-test\.md"/);
  });

  it('fails CLOSED when the manifest itself cannot be read', async () => {
    const h = harness({}, false);
    const deps = { ...h.deps, readSignoffManifest: async () => { throw new Error('ENOENT'); } } as DispatchDeps;
    await dispatchReadyRequest(deps, 'req_1');
    expect(h.queued[0]!.reason).toMatch(/the manifest itself could not be read/);
  });

  it('THE ONE THAT MATTERS: refuses a SIGNED template whose prose changed after signature', async () => {
    // Signed against the original bytes, then edited. Activation already happened and would not
    // catch this — the file is editable afterwards, which is why the hash is re-checked per dispatch.
    const manifest = { 'art21-test.md': signedEntry(SIGNED_TEMPLATE) };
    const edited = SIGNED_TEMPLATE.replace('Sehr geehrte Damen und Herren,', 'Sehr geehrte Damen und Herren, ich fordere Schadensersatz.');
    const h = harness(manifest, false, edited);

    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.queued[0]!.reason).toMatch(/the letter changed after it was sealed/);
    expect(h.queued[0]!.reason).toMatch(/Counsel must re-sign/);
    expect(h.transitions).toEqual([]);
  });

  it('refuses a SIGNED entry with no signatory — a signature nobody put their name to', async () => {
    const manifest = { 'art21-test.md': { ...signedEntry(SIGNED_TEMPLATE), counsel: null } };
    const h = harness(manifest, false, SIGNED_TEMPLATE);
    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.queued[0]!.reason).toMatch(/no `counsel`/);
  });

  it('refuses a SIGNED template still carrying the DRAFT marker in its header', async () => {
    // The header is outside the hash, so the manifest and the file can disagree — and a letter that
    // tells its reader it is unapproved must not be the one going out.
    const manifest = { 'art21-test.md': signedEntry(TEMPLATE) };
    const h = harness(manifest, false, TEMPLATE);
    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.queued[0]!.reason).toMatch(/still carries the DRAFT marker/);
  });
});

describe('a properly signed letter dispatches', () => {
  it('sends when the manifest is SIGNED and the hash still describes the file', async () => {
    const h = harness({ 'art21-test.md': signedEntry(SIGNED_TEMPLATE) }, false, SIGNED_TEMPLATE);
    await dispatchReadyRequest(h.deps, 'req_1');

    expect(h.queued).toEqual([]);
    expect(h.transitions.map((t) => t.result.to)).toEqual(['SENT', 'AWAITING_RESPONSE_PROVISIONAL']);
  });
});

describe('in development the seal steps aside, and only there', () => {
  it('renders a DRAFT template when allowUnsignedTemplates is set', async () => {
    const h = harness({}, true);
    await dispatchReadyRequest(h.deps, 'req_1');
    expect(h.queued).toEqual([]);
    expect(h.transitions.map((t) => t.result.to)).toEqual(['SENT', 'AWAITING_RESPONSE_PROVISIONAL']);
  });
});
