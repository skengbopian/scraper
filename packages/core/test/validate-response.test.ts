import { describe, expect, it } from 'vitest';
import { validateResponse, type Playbook } from '../src/index.js';

/**
 * Truth-table tests for the reply-validation seam — the gap the audit found twice over:
 *  - P1: a malformed document without a numeric confidence floor DISABLED the floor
 *    (`confidence < undefined` is false), letting hostile parser output decide;
 *  - P6: "Ihre Daten wurden nicht gelöscht" contains the compliedIf needle "gelöscht", so an
 *    erasure REJECTION auto-validated as COMPLIED until the negation needles landed in refusedIf.
 */

const VALIDATION = {
  compliedIf: { anyOf: [{ responseContains: ['gelöscht', 'deleted'] }, { 'structured.erased': true }] },
  refusedIf: {
    anyOf: [
      {
        responseContains: [
          'berechtigtes Interesse',
          'lehnen wir ab',
          'nicht gelöscht',
          'keine Löschung',
          'not deleted',
        ],
      },
    ],
  },
  humanReviewIfConfidenceBelow: 0.75,
};

function pb(validation: Record<string, unknown> = VALIDATION): Playbook {
  return {
    slug: 'test.validation',
    kind: 'RIGHTS_REQUEST',
    controller: 'zoominfo',
    requestType: 'ERASURE_ART17',
    version: 1,
    active: true,
    channel: { primary: 'email' },
    recipient: { email: 'x@example.de' },
    template: 't',
    subjectFields: ['legalName'],
    deadlineDays: 30,
    validation,
    escalation: { onDeadlineExpiry: 'NONE', onRefusal: 'DRAFT_ART77' },
  } as unknown as Playbook;
}

function reply(text: string, confidence = 0.9) {
  return { text, structured: {}, confidence, reviewedByHuman: false };
}

describe('validateResponse', () => {
  it('a clean success validates as complied', () => {
    expect(validateResponse(pb(), reply('Ihre Daten wurden gelöscht.')).event).toBe('validated:complied');
  });

  it('a clean refusal validates as refused', () => {
    expect(validateResponse(pb(), reply('Wir berufen uns auf ein berechtigtes Interesse.')).event).toBe('validated:refused');
  });

  it('a NEGATED "gelöscht" trips the contradiction path — never COMPLIED (audit P6)', () => {
    const verdict = validateResponse(pb(), reply('Ihre Daten wurden nicht gelöscht.'));
    expect(verdict.event).toBe('lowConfidence|ambiguous');
  });

  it('below the floor, nothing decides without a human', () => {
    expect(validateResponse(pb(), reply('gelöscht', 0.2)).event).toBe('lowConfidence|ambiguous');
  });

  it('a document with NO numeric floor fails CLOSED to human review (audit P1)', () => {
    const broken = pb({ compliedIf: { responseContains: ['gelöscht'] } }); // floor missing entirely
    const verdict = validateResponse(broken, reply('Ihre Daten wurden gelöscht.', 0.99));
    expect(verdict.event).toBe('lowConfidence|ambiguous');
    if (verdict.event === 'lowConfidence|ambiguous') expect(verdict.reason).toMatch(/failing closed/);
  });
});
