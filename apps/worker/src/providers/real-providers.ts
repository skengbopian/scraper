import type { IdentityProvider, PostalProvider, PostalSendResult, TimestampAnchor, Timestamper, VerifiedIdentity } from '@scraper/core';

/**
 * Real provider adapters (docs/10 §4 picks): LetterXpress (postal, Einwurf-Einschreiben `r1`),
 * InfoCert-via-Openapi (eIDAS qualified timestamps), POSTIDENT SCR (identity). Typed against the
 * vendors' public API shapes; each throws CREDENTIALS_MISSING without its env keys.
 *
 * STATUS: CREDENTIAL-GATED, NOT LIVE-VERIFIED. No vendor account exists yet (ARCHITECTURE-DECISIONS
 * §4 checklist: contracts are human actions), so these adapters have not run against the real
 * endpoints — they are the wiring that makes signing a contract a config change instead of a
 * build. Request/response mappings must be re-verified against the live sandbox on onboarding.
 * Nothing wires them into dispatch until then: the alpha's only "send" remains the simulate surface.
 *
 * The honest split per CLAUDE.md §6 stays visible in the types: only a registered postal send
 * returns a `proof`, and only a QUALIFIED anchor from an endpoint on `QUALIFIED_QTSP_HOSTS` makes a
 * timestamp legal time. Both of those are refusals a vendor's own response cannot talk us out of.
 */
class CredentialsMissingError extends Error {
  constructor(vendor: string, vars: string[]) {
    super(`${vendor}: missing credentials (${vars.join(', ')}) — provider is contract-gated (ADR §4 checklist)`);
    this.name = 'CredentialsMissingError';
  }
}

function env(name: string): string | undefined {
  return process.env[name] || undefined;
}

/** LetterXpress LXP API v3 (docs/10 §4: sandbox available; `r1` = Einwurf-Einschreiben). */
export class LetterXpressPostalProvider implements PostalProvider {
  private readonly base = env('LETTERXPRESS_BASE') ?? 'https://sandbox.letterxpress.de/v3';

  async send(letter: { text: string; recipient: string }, opts: { registered: boolean }): Promise<PostalSendResult> {
    const user = env('LETTERXPRESS_USER');
    const key = env('LETTERXPRESS_APIKEY');
    if (!user || !key) throw new CredentialsMissingError('LetterXpress', ['LETTERXPRESS_USER', 'LETTERXPRESS_APIKEY']);
    const res = await fetch(`${this.base}/printjobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        auth: { username: user, apikey: key, mode: env('LETTERXPRESS_MODE') ?? 'sandbox' },
        letter: {
          base64_file: Buffer.from(letter.text, 'utf8').toString('base64'),
          address: letter.recipient,
          dispatch: opts.registered ? { shipping: 'r1' } : { shipping: 'standard' },
          specification: { color: '1', mode: 'simplex', ship: 'national' },
        },
      }),
    });
    if (!res.ok) throw new Error(`LetterXpress: HTTP ${res.status} — ${await res.text()}`);
    const body = (await res.json()) as { data?: { id?: number; tracking?: string } };
    // Einlieferung ≠ Zustellung (BAG 2 AZR 68/24: even the Einlieferungsbeleg proves nothing about
    // Zugang). A lodgement response can NEVER honestly claim a carrier-issued delivery receipt, so
    // this adapter never mints one: `proof: null` degrades the send to the provisional clock. The
    // statutory clock waits for the Auslieferungsbeleg retrieval job (docs/10 §2.4(1), OQ-11),
    // which will construct the DeliveryProof from the FETCHED receipt with the real deliveredAt —
    // re-querying by the print-job id in `providerId`. The previous version stamped
    // `origin: 'CARRIER'` + `deliveredAt: now()` onto the lodgement, which satisfied every check in
    // provableSendEvidenceIdOf() and was one env change away from starting Art. 12(3) clocks on
    // invented delivery times (audit F3b). TODO(safety): keep `proof: null` until OQ-11 closes.
    return {
      providerId: String(body.data?.id ?? ''),
      proof: null,
    };
  }
}

export const DEFAULT_QTSP_BASE = 'https://test.timestamp.openapi.com';

/**
 * Endpoints whose tokens are QUALIFIED eIDAS timestamps.
 *
 * ADDING A HOST HERE IS A LEGAL ASSERTION, not a configuration change: it says the operator of that
 * endpoint is on an EU member state's Trusted List as a qualified trust service provider for
 * timestamps, and that the account issuing our tokens is a qualified one. That is a counsel-checkable
 * fact about a company, which is why it lives in reviewed code and not in an environment variable an
 * operator can set to anything.
 *
 * TODO(credentials): `timestamp.openapi.com` is the production sibling of the test host by naming
 * convention and has not been confirmed against a live account — confirm at onboarding. The failure
 * direction of a wrong entry here is safe: an endpoint that does not exist returns an HTTP error and
 * yields no anchor at all. The dangerous direction would be a TEST host on this list, and the whole
 * point of the list is that adding one requires someone to type it.
 */
export const QUALIFIED_QTSP_HOSTS: readonly string[] = ['timestamp.openapi.com'];

/** Does `base` name an endpoint whose tokens establish legal time? Unparseable or unknown → no. */
export function isQualifiedQtspBase(base: string): boolean {
  try {
    return QUALIFIED_QTSP_HOSTS.includes(new URL(base).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export interface OpenapiTimestamperOptions {
  readonly base?: string;
  readonly token?: string;
  /** Injected so the adapter is testable without a network and without a vendor account. */
  readonly fetchImpl?: typeof globalThis.fetch;
}

/**
 * eIDAS timestamps via Openapi/InfoCert (docs/10 §4; ~€0.10/stamp, RFC 3161 under REST).
 *
 * ---------------------------------------------------------------------------------------------
 * THE DEFECT THIS CLASS USED TO CARRY
 * ---------------------------------------------------------------------------------------------
 * It returned `kind: 'QUALIFIED'` unconditionally, and its own comment admitted the claim was true
 * "only against the PRODUCTION endpoint" — while `QTSP_BASE` defaulted to the TEST service. The two
 * facts that authorise an Art. 12(3) deadline are a carrier-issued receipt and a qualified anchor
 * (`provableSendEvidenceIdOf`), and they are deliberately sourced from two different vendors so that
 * no single misconfigured seam can produce both. This adapter dissolved that: a sandbox token plus a
 * real carrier receipt minted a real statutory deadline against a real controller — a deadline we
 * could never evidence at a DPA, on a letter whose anchor came from a test service.
 *
 * It is the same shape as the stub-postal hazard `stub-providers.ts` documents, except the stub was
 * honest about being a stub and this was not. The fix is the one the type system was already built
 * for: return the UNION, and let the host decide which arm.
 *
 * The degraded no-QTSP mode stays the shipped default (owner decision D6, docs/15): a node with no
 * qualified account still sends, still evidences, still chases — it just cannot start a statutory
 * clock, and says so in the anchor's own `reason`. That is reachable deliberately, via
 * `SCRAPER_TIMESTAMPER=simulated`, and never by omission.
 */
export class OpenapiTimestamper implements Timestamper {
  private readonly base: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: OpenapiTimestamperOptions = {}) {
    this.base = opts.base ?? env('QTSP_BASE') ?? DEFAULT_QTSP_BASE;
    this.token = opts.token ?? env('QTSP_TOKEN');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  async anchor(sha256Hex: string): Promise<TimestampAnchor> {
    if (!this.token) throw new CredentialsMissingError('Openapi/InfoCert QTSP', ['QTSP_TOKEN']);

    // The endpoint is called either way. A sandbox anchor is still worth having — it evidences
    // integrity and it exercises the whole path on a dry run — it just may not claim to be time.
    const res = await this.fetchImpl(`${this.base}/timestamp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ hash: sha256Hex, hash_algorithm: 'SHA-256' }),
    });
    if (!res.ok) throw new Error(`QTSP: HTTP ${res.status} — ${await res.text()}`);
    const body = (await res.json()) as { id?: string; timestamp?: string };
    const common = {
      tsaRef: String(body.id ?? ''),
      signedAt: body.timestamp ? new Date(body.timestamp) : new Date(),
      algorithm: 'SHA-256',
    };

    if (!isQualifiedQtspBase(this.base)) {
      let host: string;
      try {
        host = new URL(this.base).hostname;
      } catch {
        host = this.base;
      }
      return {
        kind: 'SIMULATED',
        ...common,
        // Surfaced verbatim by UnprovableSendError when the machine refuses the send, so it names
        // the host and the fix rather than saying "not qualified".
        reason:
          `QTSP_BASE names ${host}, which is not one of the endpoints whose tokens are qualified ` +
          `eIDAS timestamps (QUALIFIED_QTSP_HOSTS in apps/worker/src/providers/real-providers.ts` +
          `${this.base === DEFAULT_QTSP_BASE ? '; QTSP_BASE is unset, so this is the TEST service' : ''}) — ` +
          'this establishes integrity, not legal time',
      };
    }

    return { kind: 'QUALIFIED', ...common };
  }
}

/** POSTIDENT SCR (docs/10 §4: multi-channel incl. the post-office branch — the docs/09-gate channel). */
export class PostidentIdentityProvider implements IdentityProvider {
  private readonly base = env('POSTIDENT_BASE') ?? 'https://postident-itu.deutschepost.de/api/scr/v2';

  private headers(): Record<string, string> {
    const clientId = env('POSTIDENT_CLIENT_ID');
    const password = env('POSTIDENT_PASSWORD');
    if (!clientId || !password) throw new CredentialsMissingError('POSTIDENT', ['POSTIDENT_CLIENT_ID', 'POSTIDENT_PASSWORD']);
    return {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${clientId}:${password}`).toString('base64')}`,
    };
  }

  async startVerification(userId: string): Promise<{ providerRef: string; redirectUrl: string }> {
    const res = await fetch(`${this.base}/signingcases`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ customIdentId: userId, processData: { targetCountry: 'DE', preferredLanguage: 'de' } }),
    });
    if (!res.ok) throw new Error(`POSTIDENT: HTTP ${res.status} — ${await res.text()}`);
    const body = (await res.json()) as { caseId?: string; webIdentUrl?: string };
    return { providerRef: String(body.caseId ?? ''), redirectUrl: String(body.webIdentUrl ?? '') };
  }

  async getStatus(providerRef: string): Promise<VerifiedIdentity | null> {
    const res = await fetch(`${this.base}/signingcases/${encodeURIComponent(providerRef)}`, { headers: this.headers() });
    if (!res.ok) return null;
    // Mapping the SCR result document to VerifiedIdentity is part of live-sandbox onboarding
    // (TODO(credentials)): the verified name/DOB/address come from the ident result, never from
    // user input — that property is the whole point of the provider.
    return null;
  }

  async signMandate(): Promise<{ qesSignatureRef: string }> {
    throw new Error('POSTIDENT QES mandate signing: contract-gated (OQ-10 owns the packet/redaction profile)');
  }
}
