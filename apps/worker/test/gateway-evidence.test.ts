import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { sha256Hex, verifyStoredObject, type EvidenceRecord } from '@scraper/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ControllerGateway, type GatewaySendRequest } from '../src/gateway/controller-gateway.js';
import { FilesystemObjectStore } from '../src/providers/object-store/fs.js';
import { SimulatedTimestamper, StubMailer, StubPostalProvider } from '../src/providers/stub-providers.js';

/**
 * THE STAGE 4 DoD LINE: "a send's evidence blob verifiably exists in the object store with a
 * matching SHA-256".
 *
 * Every other object-store test exercises the store in isolation. This one drives the real
 * `ControllerGateway` against a real `FilesystemObjectStore` and then asks the question a DPA would:
 * the chain says it hashed X — is X still there, and is it still X?
 *
 * Before the store existed this could not have been written at all. The gateway wrote
 * `unconfigured://<key>` into `storageRef` and there was nothing behind it.
 */

const NOW = new Date('2026-08-15T14:30:00.000Z');
const BODY = [
  'Betreff: Widerspruch gegen die Verarbeitung zu Werbezwecken (Art. 21 Abs. 2 DSGVO)',
  '',
  'Sehr geehrte Damen und Herren,',
  '',
  'hiermit widerspreche ich gemäß Artikel 21 Absatz 2 DSGVO der Verarbeitung mich betreffender',
  'personenbezogener Daten zum Zwecke der Direktwerbung.',
  '',
  'Mit freundlichen Grüßen',
  'Erika Musterfrau',
].join('\n');

const SENDER = { name: 'Erika Musterfrau', addressLines: ['Musterstraße 1', '10115 Berlin'] };

function request(over: Partial<GatewaySendRequest> = {}): GatewaySendRequest {
  return {
    requestId: 'req_1',
    userId: 'u1',
    controllerId: 'c1',
    requestType: 'OBJECTION_ART21',
    channel: 'email',
    registered: false,
    recipient: 'datenschutz@az-direct.example',
    subject: 'Datenschutzanfrage req_1',
    body: BODY,
    sender: SENDER,
    ...over,
  };
}

let root: string;
let store: FilesystemObjectStore;
let evidence: EvidenceRecord[];

function gateway(): ControllerGateway {
  return new ControllerGateway({
    mailer: new StubMailer(),
    postal: new StubPostalProvider(),
    timestamper: new SimulatedTimestamper(),
    appendEvidenceRecord: async (record) => {
      evidence.push(record);
      return record;
    },
    latestChainHash: async () => evidence[evidence.length - 1]?.chainHash ?? null,
    hasOutboundEvidence: async () => evidence.some((e) => e.kind === 'OUTBOUND_COPY'),
    countOutboundForControllerSince: async () => 0,
    maxSendsPerControllerPerHour: 10,
    objectStorePut: (key, bytes) => store.put(key, bytes),
    idFactory: () => `ev_${evidence.length + 1}`,
    now: () => NOW,
  });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scraper-gw-'));
  store = new FilesystemObjectStore(root);
  evidence = [];
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('an email send: the blob behind the evidence record is the letter that was sent', () => {
  it('stores it, and the stored bytes hash to what the chain recorded', async () => {
    const outcome = await gateway().send(request());
    expect(outcome.kind).toBe('ACCEPTED_NON_PROVABLE');

    const outbound = evidence.find((e) => e.kind === 'OUTBOUND_COPY')!;
    expect(outbound.storageRef).toBe(`fs://evidence/req_1/outbound-copy-${NOW.getTime()}.md`);

    // The DoD question, asked exactly as a reader of the evidence chain would ask it.
    expect(await verifyStoredObject(store, outbound.storageRef, outbound.sha256)).toEqual({
      present: true,
      sha256: outbound.sha256,
      matches: true,
      reason: null,
    });
    // …and the artefact is the letter, not a summary of it.
    expect(new TextDecoder().decode((await store.get(outbound.storageRef))!)).toBe(BODY);
  });

  it('fails the send when the store cannot keep the artefact — evidence is captured BEFORE the wire', async () => {
    const mailer = new StubMailer();
    let sent = 0;
    const counting = { send: async (m: Parameters<StubMailer['send']>[0]) => (sent++, mailer.send(m)) };
    const g = new ControllerGateway({
      mailer: counting,
      postal: new StubPostalProvider(),
      timestamper: new SimulatedTimestamper(),
      appendEvidenceRecord: async (r) => r,
      latestChainHash: async () => null,
      hasOutboundEvidence: async () => false,
      countOutboundForControllerSince: async () => 0,
      maxSendsPerControllerPerHour: 10,
      objectStorePut: async () => {
        throw new Error('disk full');
      },
      idFactory: () => 'ev_1',
      now: () => NOW,
    });

    const outcome = await g.send(request());
    expect(outcome.kind).toBe('FAILED');
    if (outcome.kind === 'FAILED') expect(outcome.reason).toMatch(/evidence capture failed before send/);
    // The load-bearing assertion: nothing reached the wire, so there is no send we cannot evidence.
    expect(sent).toBe(0);
  });
});

describe('a postal send: what is hashed is the PDF, because the PDF is what the controller holds', () => {
  const POSTAL = { channel: 'postal' as const, registered: true, recipient: 'AZ Direct GmbH, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh' };

  it('anchors the rendered PDF and stores it under a .pdf key', async () => {
    await gateway().send(request(POSTAL));

    const outbound = evidence.find((e) => e.kind === 'OUTBOUND_COPY')!;
    expect(outbound.storageRef).toMatch(/\.pdf$/);

    const stored = (await store.get(outbound.storageRef))!;
    expect(sha256Hex(stored)).toBe(outbound.sha256);
    // A real PDF, not Markdown wearing a .pdf name — the defect the LetterXpress adapter shipped.
    expect(new TextDecoder().decode(stored.slice(0, 5))).toBe('%PDF-');
    expect((await PDFDocument.load(stored)).getPageCount()).toBe(1);
  });

  it('lifts the template’s Betreff into the letter’s subject rather than printing it as body text', async () => {
    await gateway().send(request(POSTAL));
    const outbound = evidence.find((e) => e.kind === 'OUTBOUND_COPY')!;
    const doc = await PDFDocument.load((await store.get(outbound.storageRef))!);
    expect(doc.getTitle()).toBe('Widerspruch gegen die Verarbeitung zu Werbezwecken (Art. 21 Abs. 2 DSGVO)');
    // NOT the technical `Datenschutzanfrage req_1`, which is the email subject and the reply handle.
    expect(doc.getTitle()).not.toContain('Datenschutzanfrage');
  });

  it('the postal proof is stored too, and its ref names the tracking reference it anchors', async () => {
    await gateway().send(request(POSTAL));
    const proof = evidence.find((e) => e.kind === 'POSTAL_PROOF')!;
    // `provableSendEvidenceIdOf` refuses a proof whose storageRef does not name its trackingRef.
    expect(proof.storageRef).toMatch(/postal-proof-stub-einwurf-\d+\.txt$/);
    expect(await verifyStoredObject(store, proof.storageRef, proof.sha256)).toMatchObject({ matches: true });
  });

  it('an unpostable address goes to the human queue and never reaches the wire', async () => {
    // No `PLZ Ort` line. A letter with a broken address comes back or never arrives, and from the
    // user's side that is indistinguishable from a controller who ignored them.
    const outcome = await gateway().send(request({ ...POSTAL, recipient: 'AZ Direct GmbH, Gütersloh' }));
    expect(outcome.kind).toBe('HUMAN_QUEUE');
    if (outcome.kind === 'HUMAN_QUEUE') expect(outcome.reason).toMatch(/no "PLZ Ort" line/);
    // Refused BEFORE evidence capture: there is no OUTBOUND_COPY claiming a send that never happened.
    expect(evidence).toHaveLength(0);
  });
});
