import { readFileSync } from 'node:fs';
import { resolveTxt as dnsResolveTxt } from 'node:dns/promises';
import nodemailer from 'nodemailer';
import type { Mailer, MailerResult } from '@scraper/core';
import { verifyDkimPublication, type DkimAlignment, type DkimIdentity, type ResolveTxt } from './dkim.js';

/**
 * The SMTP mailer — the first real `Mailer` in the tree (`grep 'implements Mailer'` found only
 * `StubMailer`).
 *
 * Email is the cheapest rung that produces a legally effective Art. 21(2) objection (docs/08), and
 * it is the channel PLAN §2's first real send uses. It also cannot ever start a statutory clock: a
 * DKIM-aligned accept proves WE SENT, not that they received (CLAUDE.md §6), and the channel
 * adapter's return type has no provable variant, so that stays true no matter what this class
 * reports.
 *
 * WHAT IT DOES NOT DO. It does not log the message body, and it must not: the body carries the
 * user's legal name and postal address, derived from their verified identity. It also refuses to
 * talk to a server without TLS — a legal request in plaintext across the internet is a data breach
 * with a Message-ID.
 */

/** The slice of a transport this adapter uses, so nodemailer stays swappable and the suite needs no server. */
export interface MailTransport {
  sendMail(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{
    messageId?: string;
    accepted?: readonly unknown[];
    rejected?: readonly unknown[];
    response?: string;
  }>;
}

export interface SmtpMailerOptions {
  readonly from: string;
  readonly dkim: DkimIdentity | null;
  readonly transport: MailTransport;
  readonly resolveTxt?: ResolveTxt;
  /** How long a DKIM publication verdict is trusted. A record can be rotated or removed at any time. */
  readonly alignmentTtlMs?: number;
  readonly now?: () => number;
}

const DEFAULT_ALIGNMENT_TTL_MS = 15 * 60 * 1000;

export class SmtpMailer implements Mailer {
  private readonly resolveTxt: ResolveTxt;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private cached: { at: number; alignment: DkimAlignment } | null = null;

  constructor(private readonly opts: SmtpMailerOptions) {
    this.resolveTxt = opts.resolveTxt ?? dnsResolveTxt;
    this.ttlMs = opts.alignmentTtlMs ?? DEFAULT_ALIGNMENT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  async send(msg: { to: string; subject: string; text: string }): Promise<MailerResult> {
    const alignment = await this.alignment();

    const info = await this.opts.transport.sendMail({
      from: this.opts.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
    });

    // `accepted`/`rejected` are per-recipient. One recipient, so "accepted" means exactly that this
    // address was accepted by the server we handed it to — not that it was delivered, and not that
    // it was read. The channel adapter is where that distinction is enforced; here it is only
    // reported honestly.
    const accepted = (info.accepted?.length ?? 0) > 0 && (info.rejected?.length ?? 0) === 0;
    return {
      messageId: info.messageId ?? '',
      accepted,
      dkimAligned: alignment.aligned,
    };
  }

  /** The last DKIM verdict, re-checked when it goes stale. Exposed for the boot log and the probe. */
  async alignment(): Promise<DkimAlignment> {
    if (this.opts.dkim === null) {
      return {
        aligned: false,
        reason:
          'no DKIM identity is configured (MAILER_DKIM_DOMAIN / MAILER_DKIM_SELECTOR / ' +
          'MAILER_DKIM_PRIVATE_KEY_FILE) — an unsigned legal request is likely to be filtered',
      };
    }
    const now = this.now();
    if (this.cached !== null && now - this.cached.at < this.ttlMs) return this.cached.alignment;
    const alignment = await verifyDkimPublication(this.opts.dkim, this.opts.from, this.resolveTxt);
    this.cached = { at: now, alignment };
    return alignment;
  }
}

export class MailerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailerConfigError';
  }
}

/**
 * `SCRAPER_MAILER=smtp` → a configured `SmtpMailer`.
 *
 * TLS IS NOT OPTIONAL. `requireTLS` on the submission port and implicit TLS on 465; certificate
 * validation is never relaxed, and there is deliberately no environment variable that would relax
 * it. An operator whose smarthost has a bad certificate has a smarthost to fix.
 */
export function createSmtpMailer(env: NodeJS.ProcessEnv): SmtpMailer {
  const host = env.SMTP_HOST;
  const from = env.MAILER_FROM;
  if (!host) throw new MailerConfigError('SCRAPER_MAILER=smtp requires SMTP_HOST');
  if (!from) throw new MailerConfigError('SCRAPER_MAILER=smtp requires MAILER_FROM (the node\'s own sending address)');

  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new MailerConfigError(`SMTP_PORT must be a port number, got "${env.SMTP_PORT}"`);
  }

  const user = env.SMTP_USER;
  const pass = env.SMTP_PASSWORD;
  const dkim = dkimFromEnv(env);
  const transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: true,
    auth: user && pass ? { user, pass } : undefined,
    ...(dkim ? { dkim: { domainName: dkim.domain, keySelector: dkim.selector, privateKey: dkim.privateKey } } : {}),
  });

  return new SmtpMailer({ from, dkim, transport });
}

/**
 * The DKIM key comes from a FILE, never from an environment variable.
 *
 * A PEM in the environment is a private key in every `ps` listing, every crash dump and every
 * container inspect output, and it survives being pasted into a support thread. A path is not.
 */
export function dkimFromEnv(env: NodeJS.ProcessEnv): DkimIdentity | null {
  const domain = env.MAILER_DKIM_DOMAIN;
  const selector = env.MAILER_DKIM_SELECTOR;
  const keyFile = env.MAILER_DKIM_PRIVATE_KEY_FILE;
  if (!domain && !selector && !keyFile) return null;
  if (!domain || !selector || !keyFile) {
    throw new MailerConfigError(
      'DKIM needs all three of MAILER_DKIM_DOMAIN, MAILER_DKIM_SELECTOR and ' +
        'MAILER_DKIM_PRIVATE_KEY_FILE — a partial configuration signs nothing and reports nothing',
    );
  }
  let privateKey: string;
  try {
    privateKey = readFileSync(keyFile, 'utf8');
  } catch (e) {
    throw new MailerConfigError(`MAILER_DKIM_PRIVATE_KEY_FILE (${keyFile}) could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { domain, selector, privateKey };
}
