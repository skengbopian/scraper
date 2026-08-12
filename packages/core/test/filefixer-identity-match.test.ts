import { describe, expect, it } from 'vitest';
import { matchSubjectToIdentity, normalizeName } from '../src/filefixer/identity-match.js';
import type { VerifiedIdentity } from '../src/identity/subject.js';

const ERIKA: VerifiedIdentity = {
  id: 'id1', userId: 'u1', status: 'VERIFIED', method: 'EID',
  legalName: 'Erika Mustermann', dateOfBirth: new Date('1979-03-12T00:00:00Z'),
  addresses: [{ street: 'Heidestraße 17', postalCode: '51147', city: 'Köln', country: 'DE', current: true, verifiedAt: new Date() }],
  verifiedAt: new Date(), providerRef: 'x',
};

describe('normalizeName', () => {
  it('folds case, umlauts, titles and punctuation', () => {
    expect(normalizeName('Dr. Jörg-Müller  Größe')).toBe(normalizeName('joerg mueller groesse'));
    expect(normalizeName('Erika  MUSTERMANN')).toBe('erika mustermann');
  });
});

describe('matchSubjectToIdentity — the anti-third-party gate', () => {
  it('accepts the exact verified person, tolerantly formatted', () => {
    expect(matchSubjectToIdentity({ name: '  ERIKA   Mustermann ', dateOfBirth: new Date('1979-03-12T00:00:00Z') }, ERIKA)).toEqual({ match: true });
  });
  it('rejects a different date of birth even with the same name', () => {
    const r = matchSubjectToIdentity({ name: 'Erika Mustermann', dateOfBirth: new Date('1979-03-13T00:00:00Z') }, ERIKA);
    expect(r.match).toBe(false);
  });
  it('rejects a different person outright (third-party document)', () => {
    const r = matchSubjectToIdentity({ name: 'Max Beispiel', dateOfBirth: new Date('1979-03-12T00:00:00Z') }, ERIKA);
    expect(r.match).toBe(false);
  });
  it('rejects when the document carries no DOB — never "ingest anyway"', () => {
    expect(matchSubjectToIdentity({ name: 'Erika Mustermann', dateOfBirth: null }, ERIKA).match).toBe(false);
  });
  it('rejects an unverified identity regardless of match', () => {
    const unverified = { ...ERIKA, status: 'PENDING' as const };
    expect(matchSubjectToIdentity({ name: 'Erika Mustermann', dateOfBirth: ERIKA.dateOfBirth }, unverified as VerifiedIdentity).match).toBe(false);
  });
});
