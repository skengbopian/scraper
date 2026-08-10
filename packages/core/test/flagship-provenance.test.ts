import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  apply,
  appendEvidence,
  assessSourceList,
  buildEntries,
  deriveSubject,
  escalationFor,
  matchBroker,
  proposeFollowUps,
  registeredResendChannel,
  renderRequest,
  runGuards,
  validateResponse,
  verifyChain,
  type EvidenceRecord,
  type MandateSnapshot,
  type Playbook,
  type QualifiedTimestamp,
  type RequestSnapshot,
  type Timestamper,
  type VerifiedIdentity,
} from '../src/index.js';

/**
 * THE FLAGSHIP, end to end (docs/09): an ACCESS_ART15_SOURCE provenance request to infoscore.
 *
 * request -> guards -> render -> registered send -> clock -> parse a reply in the sandbox ->
 * ProvenanceEntry rows -> broker match -> incomplete source list -> Art. 77 DRAFTED (never sent).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const NOW = new Date('2026-08-07T09:00:00Z');

function loadPlaybook(slug: string): Playbook {
  return YAML.parse(fs.readFileSync(path.join(ROOT, 'playbooks', `${slug}.yaml`), 'utf8')) as Playbook;
}
const templateBody = (name: string) => fs.readFileSync(path.join(ROOT, 'templates', `${name}.md`), 'utf8');

const identity: VerifiedIdentity = {
  id: 'id_1', userId: 'u1', status: 'VERIFIED', method: 'EID',
  legalName: 'Erika Mustermann', dateOfBirth: new Date('1979-03-12T00:00:00Z'),
  addresses: [
    { street: 'Heidestraße 17', postalCode: '51147', city: 'Köln', country: 'DE', current: true, verifiedAt: NOW },
    { street: 'Alte Gasse 3', postalCode: '60313', city: 'Frankfurt', country: 'DE', current: false, verifiedAt: NOW },
  ],
  verifiedAt: NOW, providerRef: 'idnow_abc',
};

const mandate: MandateSnapshot = {
  id: 'm1', userId: 'u1', scope: ['ACCESS_ART15_SOURCE', 'ERASURE_ART17', 'OBJECTION_ART21'],
  signedAt: NOW, revokedAt: null,
};

const stubTimestamper: Timestamper = {
  async anchor(hash): Promise<QualifiedTimestamp> {
    return { tsaRef: `qtsp_${hash.slice(0, 8)}`, signedAt: NOW, algorithm: 'SHA256withRSA' };
  },
};

function snapshot(over: Partial<RequestSnapshot> = {}): RequestSnapshot {
  return {
    id: 'req_flagship', state: 'DRAFT', userId: 'u1', controllerId: 'infoscore',
    requestType: 'ACCESS_ART15_SOURCE', provableSendConfirmedAt: null, deadlineAt: null,
    provisionalDeadlineAt: null, hasControllerResponse: false, reviewedByHuman: false,
    parseConfidence: null, humanReviewIfConfidenceBelow: 0.8, outcome: null, ...over,
  };
}

describe('FLAGSHIP — ACCESS_ART15_SOURCE to infoscore, end to end', () => {
  const pb = loadPlaybook('provenance.infoscore');

  it('the shipped playbook is the provenance flagship and is postal-registered', () => {
    expect(pb.requestType).toBe('ACCESS_ART15_SOURCE');
    expect(pb.kind).toBe('RIGHTS_REQUEST');
    expect(pb.seatDpa).toBe('LFDI_BW');
    expect(registeredResendChannel(pb)).toBe('primary');
  });

  it('1. guards pass and yield a subject derived from the verified identity', () => {
    const out = runGuards({
      requestId: 'req_flagship', userId: 'u1', controllerId: 'infoscore',
      requestType: 'ACCESS_ART15_SOURCE', identity, mandates: [mandate], nonTerminalSiblings: [], now: NOW,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.subject.legalName).toBe('Erika Mustermann');
  });

  it('2. renders the real Art. 15(1)(g) letter with verified-identity fields only', () => {
    const subject = deriveSubject(identity);
    const letter = renderRequest({
      playbook: { ...pb, active: true },           // counsel sign-off simulated for the test only
      templateBody: templateBody(pb.template),
      subject,
      attachedIdentityPacketId: 'pkt_1',           // required:true on this playbook
      now: NOW,
    });
    expect(letter.text).toContain('Erika Mustermann');
    expect(letter.text).toContain('Heidestraße 17, 51147 Köln');
    expect(letter.text).toContain('Alte Gasse 3, 60313 Frankfurt'); // historical address
    expect(letter.text).toContain('12.03.1979');
    expect(letter.text).toContain('Art. 15 Abs. 1 lit. g');
    expect(letter.text).not.toContain('{{');
    // isSchufa is false on infoscore, so the Datenlieferanten paragraph must be absent
    expect(letter.text).not.toContain('SCHUFA-Information');
    // C6: the packet was attached, so the enclosure sentence is present and TRUE
    expect(letter.identityProofEnclosed).toBe(true);
    expect(letter.text).toContain('geschwärzte Ausweiskopie bei');
  });

  it('2b. GUARDRAIL — refuses to render when identityProof is required but no packet is attached', () => {
    expect(() =>
      renderRequest({
        playbook: { ...pb, active: true },
        templateBody: templateBody(pb.template),
        subject: deriveSubject(identity),
        attachedIdentityPacketId: null,
        now: NOW,
      }),
    ).toThrow(/no IdentityPacket was attached/);
  });

  it('2c. GUARDRAIL — refuses to render an inactive playbook (no counsel sign-off)', () => {
    expect(() =>
      renderRequest({
        playbook: pb, templateBody: templateBody(pb.template), subject: deriveSubject(identity),
        attachedIdentityPacketId: 'pkt_1', now: NOW,
      }),
    ).toThrow(/active is not true/);
  });

  it('3. a registered send starts the statutory clock and writes QTSP-anchored evidence', async () => {
    const outbound = await appendEvidence(
      { requestId: 'req_flagship', kind: 'OUTBOUND_COPY', content: 'letter text', storageRef: 's3://x',
        prevHash: null, now: NOW, idFactory: () => 'ev_1' },
      stubTimestamper,
    );
    const proof = await appendEvidence(
      { requestId: 'req_flagship', kind: 'POSTAL_PROOF', content: 'Einwurf-Einschreiben RR123DE', storageRef: 's3://y',
        prevHash: outbound.chainHash, now: NOW, idFactory: () => 'ev_2' },
      stubTimestamper,
    );
    expect(proof.qualifiedTimestamp).not.toBeNull();

    const chain: EvidenceRecord[] = [outbound, proof];
    expect(verifyChain(chain).intact).toBe(true);

    // tamper with a record: the chain must break
    const tampered = [{ ...outbound, sha256: 'deadbeef' }, proof];
    expect(verifyChain(tampered).intact).toBe(false);

    const sent = apply(snapshot({ state: 'SENT' }), 'provableSendConfirmed', {
      actor: 'SYSTEM', now: NOW, deadlineDays: pb.deadlineDays!, provableSendEvidenceId: proof.id,
    });
    expect(sent.to).toBe('AWAITING_RESPONSE');
    expect(sent.patch.deadlineAt).toEqual(new Date('2026-09-06T09:00:00Z'));
  });

  it('4. an incomplete source list becomes INCOMPLETE, not REFUSED', () => {
    // Simulated doc-sandbox output. Note infoscore names AZ Direct for addresses but gives no source
    // for Zahlungserfahrungen — the BayLDA "incomplete answer is itself a violation" case.
    const entries = buildEntries(
      [
        { dataCategory: 'Anschriftendaten', statedSource: 'AZ Direct GmbH', statedLegalBasis: 'Art. 6(1)(f)', confidence: 0.94 },
        { dataCategory: 'Zahlungserfahrungen', statedSource: null, statedLegalBasis: null, confidence: 0.91 },
      ],
      pb,
    );
    expect(entries[0]!.isBroker).toBe(true);
    expect(entries[0]!.matchedWatchlistSlug).toBe('az-direct');
    expect(entries[1]!.isBroker).toBe(false);

    const verdict = assessSourceList(entries, pb);
    expect(verdict.kind).toBe('INCOMPLETE');
    if (verdict.kind === 'INCOMPLETE') expect(verdict.missingCategories).toEqual(['Zahlungserfahrungen']);

    const parsed = {
      text: 'Ihre Anschriftendaten stammen von der AZ Direct GmbH.',
      structured: { sourcesNamedPerCategory: false },
      confidence: 0.91,
      reviewedByHuman: false,
    };
    // compliedIf requires sourcesNamedPerCategory:true, which is false here.
    expect(validateResponse(pb, parsed).event).toBe('lowConfidence|ambiguous');

    // A human reviews and marks it incomplete — the C4 path that did not exist before.
    const inc = apply(snapshot({ state: 'NEEDS_HUMAN', hasControllerResponse: true }), 'humanResolve:incomplete', {
      actor: 'HUMAN_OPS', now: NOW,
    });
    expect(inc.to).toBe('INCOMPLETE');
    expect(escalationFor(pb, 'incompleteSourceList')).toBe('DRAFT_ART77');
  });

  it('5. escalation is DRAFTED, and the complaint cannot be sent without a human', () => {
    const drafted = apply(snapshot({ state: 'INCOMPLETE' }), 'escalate', { actor: 'SYSTEM', now: NOW });
    expect(drafted.to).toBe('ESCALATION_DRAFTED');

    // GUARDRAIL: the worker cannot send it.
    expect(() => apply(snapshot({ state: 'ESCALATION_DRAFTED' }), 'humanSend', { actor: 'SYSTEM', now: NOW }))
      .toThrow(/requires actor HUMAN_OPS/);

    expect(apply(snapshot({ state: 'ESCALATION_DRAFTED' }), 'humanSend', { actor: 'HUMAN_OPS', now: NOW }).to)
      .toBe('ESCALATED');
  });

  it('6. broker follow-ups are PROPOSALS requiring human confirmation, never auto-created', () => {
    const entries = buildEntries(
      [{ dataCategory: 'Anschriftendaten', statedSource: 'AZ Direct GmbH', statedLegalBasis: null, confidence: 0.94 }],
      pb,
    );
    const proposals = proposeFollowUps(entries, 'infoscore');
    expect(proposals.length).toBe(3);
    // GUARDRAIL: every proposal, without exception, needs a human.
    for (const p of proposals) expect(p.requiresHumanConfirmation).toBe(true);
    expect(proposals.map((p) => `${p.requestType}@${p.targetControllerSlug}`).sort()).toEqual([
      'ERASURE_ART17@az-direct', 'ERASURE_ART17@infoscore', 'OBJECTION_ART21@az-direct',
    ]);
  });

  it('7. an answer that contradicts infoscore’s own Art. 14 notice is flagged', () => {
    const entries = buildEntries(
      [{ dataCategory: 'Anschriftendaten', statedSource: 'eigene Erhebung', statedLegalBasis: null, confidence: 0.9 }],
      pb,
    );
    const verdict = assessSourceList(entries, pb);
    expect(verdict.kind).toBe('CONTRADICTS_ART14');
    if (verdict.kind === 'CONTRADICTS_ART14') expect(verdict.expectedSource).toBe('az-direct');
  });
});

describe('broker matching is conservative', () => {
  const watchlist = ['az-direct', 'acxiom', 'deutsche-post-direkt', 'schober', 'capaneo'];

  it('matches real company names to census slugs', () => {
    expect(matchBroker('AZ Direct GmbH', watchlist)).toBe('az-direct');
    expect(matchBroker('Acxiom Deutschland GmbH', watchlist)).toBe('acxiom');
    expect(matchBroker('Deutsche Post Direkt GmbH', watchlist)).toBe('deutsche-post-direkt');
  });

  it('does NOT match on a partial token — a false positive proposes a legal action against the wrong company', () => {
    expect(matchBroker('Direct Line Versicherung', watchlist)).toBeNull();
    expect(matchBroker('Deutsche Post AG', watchlist)).toBeNull();
    expect(matchBroker('Post Direkt', watchlist)).toBeNull();
  });

  it('returns null for an absent or empty source', () => {
    expect(matchBroker(null, watchlist)).toBeNull();
    expect(matchBroker('', watchlist)).toBeNull();
  });
});

describe('Schufa variant renders the Datenlieferanten paragraph', () => {
  it('isSchufa flips the section 2.3 block on', () => {
    const pb = loadPlaybook('provenance.schufa');
    const letter = renderRequest({
      playbook: { ...pb, active: true }, templateBody: templateBody(pb.template),
      subject: deriveSubject(identity), attachedIdentityPacketId: 'pkt_1', now: NOW,
    });
    expect(letter.text).toContain('SCHUFA-Information');
    expect(letter.text).toContain('Datenlieferanten');
  });
});
