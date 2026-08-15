import { appendEvidence, isQualifiedAnchor, provableSendEvidenceIdOf, UnprovableSendError, type DeliveryProof } from '@scraper/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QTSP_BASE,
  isQualifiedQtspBase,
  OpenapiTimestamper,
  QUALIFIED_QTSP_HOSTS,
} from '../src/providers/real-providers.js';

/**
 * The QTSP adapter used to return `kind: 'QUALIFIED'` unconditionally while `QTSP_BASE` defaulted to
 * the vendor's TEST host. A sandbox token plus a real carrier receipt would have minted a real
 * Art. 12(3) deadline — the exact hazard `provableSendEvidenceIdOf()` sources its two facts from two
 * different vendors to prevent.
 */

function stubQtsp(body: { id: string; timestamp: string }, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof globalThis.fetch;
}

const OK = stubQtsp({ id: 'ts_0001', timestamp: '2026-08-15T14:30:00.000Z' });

describe('which endpoints may claim to establish legal time', () => {
  it('the vendor TEST host is not one of them, and it is the default', () => {
    expect(DEFAULT_QTSP_BASE).toContain('test.');
    expect(isQualifiedQtspBase(DEFAULT_QTSP_BASE)).toBe(false);
  });

  it('an unset, unknown, local or unparseable base is not qualified', () => {
    for (const base of ['https://sandbox.example.com', 'http://localhost:9000', 'not a url', '']) {
      expect(isQualifiedQtspBase(base), base).toBe(false);
    }
  });

  it('only the reviewed list qualifies, and matching is on the host — not on a substring', () => {
    for (const host of QUALIFIED_QTSP_HOSTS) expect(isQualifiedQtspBase(`https://${host}/v1`)).toBe(true);
    // The trap a naive `base.includes('timestamp.openapi.com')` would fall into.
    expect(isQualifiedQtspBase('https://test.timestamp.openapi.com')).toBe(false);
    expect(isQualifiedQtspBase('https://timestamp.openapi.com.evil.example')).toBe(false);
  });
});

describe('OpenapiTimestamper', () => {
  it('anchors against the TEST host as SIMULATED, naming the host and the fix', async () => {
    const anchor = await new OpenapiTimestamper({ token: 't', fetchImpl: OK }).anchor('a'.repeat(64));
    expect(anchor.kind).toBe('SIMULATED');
    expect(isQualifiedAnchor(anchor)).toBe(false);
    expect(anchor.kind === 'SIMULATED' && anchor.reason).toMatch(/test\.timestamp\.openapi\.com/);
    expect(anchor.kind === 'SIMULATED' && anchor.reason).toMatch(/QTSP_BASE is unset, so this is the TEST service/);
    // The anchor is still REAL evidence of integrity — the vendor's reference is kept, not dropped.
    expect(anchor.tsaRef).toBe('ts_0001');
    expect(anchor.signedAt).toEqual(new Date('2026-08-15T14:30:00.000Z'));
  });

  it('anchors against a listed production host as QUALIFIED', async () => {
    const base = `https://${QUALIFIED_QTSP_HOSTS[0]}`;
    const anchor = await new OpenapiTimestamper({ base, token: 't', fetchImpl: OK }).anchor('a'.repeat(64));
    expect(anchor.kind).toBe('QUALIFIED');
    expect(isQualifiedAnchor(anchor)).toBe(true);
  });

  it('refuses to anchor without a token rather than returning an unsigned anchor', async () => {
    await expect(new OpenapiTimestamper({ token: undefined, fetchImpl: OK }).anchor('a'.repeat(64))).rejects.toThrow(
      /missing credentials \(QTSP_TOKEN\)/,
    );
  });

  it('raises on an HTTP error — a failed anchor is not a simulated one', async () => {
    const boom = stubQtsp({ id: '', timestamp: '' }, 503);
    await expect(new OpenapiTimestamper({ token: 't', fetchImpl: boom }).anchor('a'.repeat(64))).rejects.toThrow(/HTTP 503/);
  });
});

describe('the consequence: a sandbox anchor cannot start the Art. 12(3) clock', () => {
  const carrierProof: DeliveryProof = {
    kind: 'EINWURF_EINSCHREIBEN',
    trackingRef: 'RR123456789DE',
    deliveredAt: new Date('2026-08-14T10:00:00.000Z'),
    origin: 'CARRIER', // a REAL carrier receipt — the other half of the pair
  };

  const record = (timestamper: OpenapiTimestamper) =>
    appendEvidence(
      {
        requestId: 'req_1',
        kind: 'POSTAL_PROOF',
        content: `EINWURF_EINSCHREIBEN ${carrierProof.trackingRef}`,
        storageRef: `fs://evidence/req_1/postal-proof-${carrierProof.trackingRef}.txt`,
        prevHash: null,
        now: new Date('2026-08-15T14:30:00.000Z'),
        idFactory: () => 'ev_1',
      },
      timestamper,
    );

  it('a real carrier receipt anchored at the TEST host is REFUSED as SIMULATED_ANCHOR', async () => {
    const anchored = await record(new OpenapiTimestamper({ token: 't', fetchImpl: OK }));
    try {
      provableSendEvidenceIdOf(anchored, carrierProof);
      throw new Error('expected the send to be refused');
    } catch (e) {
      expect(e).toBeInstanceOf(UnprovableSendError);
      expect((e as UnprovableSendError).reason).toBe('SIMULATED_ANCHOR');
    }
  });

  it('the same receipt anchored at a listed production host mints the evidence id', async () => {
    const base = `https://${QUALIFIED_QTSP_HOSTS[0]}`;
    const anchored = await record(new OpenapiTimestamper({ base, token: 't', fetchImpl: OK }));
    expect(provableSendEvidenceIdOf(anchored, carrierProof)).toBe('ev_1');
  });
});
