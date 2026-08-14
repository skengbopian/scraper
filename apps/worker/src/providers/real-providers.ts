import type { IdentityProvider, PostalProvider, PostalSendResult, QualifiedTimestamp, Timestamper, VerifiedIdentity } from '@scraper/core';

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
 * returns a `proof`, and only the QTSP anchor makes a timestamp qualified.
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

/** eIDAS qualified timestamps via Openapi/InfoCert (docs/10 §4; ~€0.10/stamp, RFC 3161 under REST). */
export class OpenapiTimestamper implements Timestamper {
  private readonly base = env('QTSP_BASE') ?? 'https://test.timestamp.openapi.com';

  async anchor(sha256Hex: string): Promise<QualifiedTimestamp> {
    const token = env('QTSP_TOKEN');
    if (!token) throw new CredentialsMissingError('Openapi/InfoCert QTSP', ['QTSP_TOKEN']);
    const res = await fetch(`${this.base}/timestamp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ hash: sha256Hex, hash_algorithm: 'SHA-256' }),
    });
    if (!res.ok) throw new Error(`QTSP: HTTP ${res.status} — ${await res.text()}`);
    const body = (await res.json()) as { id?: string; timestamp?: string };
    // `kind: 'QUALIFIED'` is the claim that this anchor can establish legal time, and it is the
    // second of the two facts that authorise a statutory deadline (ADR-037). It is true only against
    // the PRODUCTION endpoint: `QTSP_BASE` defaults to the test service above, whose tokens are not
    // qualified. TODO(credentials): assert the production base at onboarding rather than trusting env.
    return {
      kind: 'QUALIFIED' as const,
      tsaRef: String(body.id ?? ''),
      signedAt: body.timestamp ? new Date(body.timestamp) : new Date(),
      algorithm: 'SHA-256',
    };
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
