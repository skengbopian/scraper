import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sendLegalRequestEmail } from '../src/channels/email.js';
import { fromDomainOf, publicKeyBase64, verifyDkimPublication, type ResolveTxt } from '../src/providers/mailer/dkim.js';
import { SmtpMailer, type MailTransport } from '../src/providers/mailer/smtp.js';

/**
 * `dkimAligned` decides whether a legal request is sent or fails into the ops queue. The pre-audit
 * line answered the same question with a hardcoded `true` under a TODO; a config flag would be that
 * mistake wearing a different name. These tests pin that the answer is derived from DNS and from the
 * From header, and that every way of getting it wrong fails closed.
 */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const PUBLISHED = Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).toString('base64');

const IDENTITY = { domain: 'example.de', selector: 'scraper', privateKey: PRIVATE_PEM };
const FROM = 'Scraper <widerspruch@example.de>';

/** A DNS double. Splits the record into 255-byte chunks, exactly as a real resolver returns it. */
function resolver(records: Record<string, string>): ResolveTxt {
  return async (name) => {
    const record = records[name];
    if (record === undefined) {
      const e = new Error(`queryTxt ENOTFOUND ${name}`) as Error & { code: string };
      e.code = 'ENOTFOUND';
      throw e;
    }
    return [record.match(/.{1,255}/g) ?? ['']];
  };
}

const PUBLISHED_OK = resolver({ 'scraper._domainkey.example.de': `v=DKIM1; k=rsa; p=${PUBLISHED}` });

describe('fromDomainOf', () => {
  it('reads the domain out of both header forms and rejects a non-address', () => {
    expect(fromDomainOf('Scraper <widerspruch@example.de>')).toBe('example.de');
    expect(fromDomainOf('widerspruch@Example.DE')).toBe('example.de');
    expect(fromDomainOf('not-an-address')).toBeNull();
    expect(fromDomainOf('@example.de')).toBeNull();
    expect(fromDomainOf('user@')).toBeNull();
  });
});

describe('DKIM publication', () => {
  it('aligns when the published key is the public half of the signing key', async () => {
    const verdict = await verifyDkimPublication(IDENTITY, FROM, PUBLISHED_OK);
    expect(verdict.aligned).toBe(true);
  });

  it('reassembles a record split across TXT chunks — a 2048-bit key always is', async () => {
    // The single most likely way to get a correct configuration reported as broken.
    expect(PUBLISHED.length).toBeGreaterThan(255);
    expect((await verifyDkimPublication(IDENTITY, FROM, PUBLISHED_OK)).aligned).toBe(true);
  });

  it('refuses when d= is not the From domain — valid but unaligned is still unaligned', async () => {
    const verdict = await verifyDkimPublication({ ...IDENTITY, domain: 'other.de' }, FROM, PUBLISHED_OK);
    expect(verdict.aligned).toBe(false);
    expect(verdict.aligned === false && verdict.reason).toMatch(/is not the From domain/);
  });

  it('refuses when nothing is published at the selector', async () => {
    const verdict = await verifyDkimPublication(IDENTITY, FROM, resolver({}));
    expect(verdict.aligned).toBe(false);
    expect(verdict.aligned === false && verdict.reason).toMatch(/no DKIM record at scraper\._domainkey\.example\.de/);
  });

  it('refuses a revoked key (p= empty) rather than treating it as absent', async () => {
    const verdict = await verifyDkimPublication(IDENTITY, FROM, resolver({ 'scraper._domainkey.example.de': 'v=DKIM1; k=rsa; p=' }));
    expect(verdict.aligned === false && verdict.reason).toMatch(/published as revoked/);
  });

  it('refuses when the published key belongs to a DIFFERENT private key', async () => {
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const wrong = Buffer.from(other.publicKey.export({ type: 'spki', format: 'der' })).toString('base64');
    const verdict = await verifyDkimPublication(IDENTITY, FROM, resolver({ 'scraper._domainkey.example.de': `v=DKIM1; p=${wrong}` }));
    expect(verdict.aligned).toBe(false);
    expect(verdict.aligned === false && verdict.reason).toMatch(/FAILS verification/);
  });

  it('accepts the same key re-encoded with whitespace — a cosmetic difference is not a fault', async () => {
    const wrapped = (PUBLISHED.match(/.{1,64}/g) ?? []).join(' ');
    const verdict = await verifyDkimPublication(IDENTITY, FROM, resolver({ 'scraper._domainkey.example.de': `v=DKIM1; p=${wrapped}` }));
    expect(verdict.aligned).toBe(true);
  });

  it('refuses an unreadable private key instead of throwing out of the send path', async () => {
    const verdict = await verifyDkimPublication({ ...IDENTITY, privateKey: 'not a pem' }, FROM, PUBLISHED_OK);
    expect(verdict.aligned).toBe(false);
    expect(verdict.aligned === false && verdict.reason).toMatch(/private key could not be read/);
  });
});

/** Records what was handed to the transport, so the test can assert what actually left. */
function transport(over: Partial<Awaited<ReturnType<MailTransport['sendMail']>>> = {}) {
  const sent: Parameters<MailTransport['sendMail']>[0][] = [];
  const impl: MailTransport = {
    async sendMail(message) {
      sent.push(message);
      return { messageId: '<abc@example.de>', accepted: [message.to], rejected: [], ...over };
    },
  };
  return { impl, sent };
}

describe('SmtpMailer', () => {
  it('reports accepted + aligned for a correctly configured node', async () => {
    const t = transport();
    const mailer = new SmtpMailer({ from: FROM, dkim: IDENTITY, transport: t.impl, resolveTxt: PUBLISHED_OK });
    const result = await mailer.send({ to: 'datenschutz@az-direct.example', subject: 'Widerspruch', text: 'Sehr geehrte…' });

    expect(result).toEqual({ messageId: '<abc@example.de>', accepted: true, dkimAligned: true });
    expect(t.sent[0]).toMatchObject({ from: FROM, to: 'datenschutz@az-direct.example', subject: 'Widerspruch' });
  });

  it('reports unaligned when no DKIM identity is configured at all', async () => {
    const mailer = new SmtpMailer({ from: FROM, dkim: null, transport: transport().impl });
    expect((await mailer.send({ to: 'x@y.de', subject: 's', text: 't' })).dkimAligned).toBe(false);
  });

  it('a rejected recipient is not an accepted send', async () => {
    const t = transport({ accepted: [], rejected: ['datenschutz@az-direct.example'] });
    const mailer = new SmtpMailer({ from: FROM, dkim: IDENTITY, transport: t.impl, resolveTxt: PUBLISHED_OK });
    expect((await mailer.send({ to: 'datenschutz@az-direct.example', subject: 's', text: 't' })).accepted).toBe(false);
  });

  it('re-checks the DNS verdict once it goes stale — a removed record must stop sends', async () => {
    let present = true;
    const flaky: ResolveTxt = (name) => (present ? PUBLISHED_OK(name) : resolver({})(name));
    let clock = 0;
    const mailer = new SmtpMailer({
      from: FROM,
      dkim: IDENTITY,
      transport: transport().impl,
      resolveTxt: flaky,
      alignmentTtlMs: 1000,
      now: () => clock,
    });

    expect((await mailer.send({ to: 'x@y.de', subject: 's', text: 't' })).dkimAligned).toBe(true);
    present = false;
    // Still inside the TTL: the cached verdict stands.
    clock = 999;
    expect((await mailer.send({ to: 'x@y.de', subject: 's', text: 't' })).dkimAligned).toBe(true);
    clock = 1001;
    expect((await mailer.send({ to: 'x@y.de', subject: 's', text: 't' })).dkimAligned).toBe(false);
  });
});

describe('the consequence at the channel', () => {
  const NOW = new Date('2026-08-15T14:30:00.000Z');

  it('an aligned, accepted send is ACCEPTED_NON_PROVABLE — never a provable one', async () => {
    const mailer = new SmtpMailer({ from: FROM, dkim: IDENTITY, transport: transport().impl, resolveTxt: PUBLISHED_OK });
    const outcome = await sendLegalRequestEmail(mailer, { to: 'x@y.de', subject: 's', text: 't' }, NOW);
    expect(outcome.kind).toBe('ACCEPTED_NON_PROVABLE');
    // The type has no provable variant; this asserts the runtime agrees with the compiler.
    expect(outcome).not.toHaveProperty('evidenceId');
  });

  it('an unaligned send FAILS into ops rather than burning a provisional month in a spam folder', async () => {
    const mailer = new SmtpMailer({ from: FROM, dkim: null, transport: transport().impl });
    const outcome = await sendLegalRequestEmail(mailer, { to: 'x@y.de', subject: 's', text: 't' }, NOW);
    expect(outcome.kind).toBe('FAILED');
    expect(outcome.kind === 'FAILED' && outcome.reason).toMatch(/not DKIM-aligned/);
  });
});
