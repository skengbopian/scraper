import { createPublicKey } from 'node:crypto';

/**
 * Is our DKIM signature actually going to align — and is its public half actually published?
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS A CHECK AND NOT A CONFIG FLAG
 * ---------------------------------------------------------------------------------------------
 * `MailerResult.dkimAligned` decides whether `sendLegalRequestEmail()` sends or FAILs to ops, and
 * the reason it exists is deliverability: an unaligned legal request is far likelier to be filed as
 * spam, which burns a provisional month and books a non-compliance statistic against a controller
 * for something that was our fault.
 *
 * The pre-audit line answered this question with `provable: true`, hardcoded, under a TODO. A
 * config boolean here would be the same mistake wearing a different name: an operator sets
 * `MAILER_DKIM_ALIGNED=true` and the process believes them. So the signal is derived from two facts
 * the adapter can actually establish:
 *
 *   1. WE sign the message, with a key we hold, for a `d=` domain that matches the From header.
 *      Alignment is then true by construction rather than by assertion.
 *   2. The public half of that key is genuinely published at `<selector>._domainkey.<domain>`. A
 *      signature whose key is not in DNS does not merely fail to help — it FAILS verification, which
 *      is worse for deliverability than not signing at all.
 *
 * What is still outside our reach: SPF, the DMARC policy record, IP reputation, and whether the
 * receiving MX likes us. Those are operator configuration and are documented in the README, not
 * asserted here.
 *
 * ALIGNMENT IS CHECKED STRICTLY (`d=` equals the From domain exactly). DMARC also accepts relaxed
 * alignment — a shared organisational domain — but deciding that needs the Public Suffix List, and
 * strict alignment implies relaxed. Being conservative costs an operator one DNS record.
 */

export interface DkimIdentity {
  readonly domain: string;
  readonly selector: string;
  /** PEM. Read from a file, never from the environment — see the README. */
  readonly privateKey: string;
}

export type DkimAlignment =
  | { readonly aligned: true; readonly detail: string }
  | { readonly aligned: false; readonly reason: string };

/** `Scraper <widerspruch@example.de>` → `example.de`. */
export function fromDomainOf(fromHeader: string): string | null {
  const address = /<([^>]+)>/.exec(fromHeader)?.[1] ?? fromHeader;
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) return null;
  return address.slice(at + 1).trim().toLowerCase();
}

/** The SPKI DER of the public half of `privateKeyPem`, base64 — the exact form a DKIM `p=` carries. */
export function publicKeyBase64(privateKeyPem: string): string {
  const der = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
  return Buffer.from(der).toString('base64');
}

/** `resolveTxt` from `node:dns/promises`: a record arrives as chunks that must be concatenated. */
export type ResolveTxt = (hostname: string) => Promise<string[][]>;

function parseDkimRecord(record: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const part of record.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    tags.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
  }
  return tags;
}

export async function verifyDkimPublication(
  identity: DkimIdentity,
  fromHeader: string,
  resolveTxt: ResolveTxt,
): Promise<DkimAlignment> {
  const fromDomain = fromDomainOf(fromHeader);
  if (fromDomain === null) return { aligned: false, reason: `MAILER_FROM (${fromHeader}) has no parseable address` };
  if (fromDomain !== identity.domain.toLowerCase()) {
    return {
      aligned: false,
      reason:
        `the DKIM d= domain (${identity.domain}) is not the From domain (${fromDomain}), so the ` +
        'signature would be valid and still unaligned — DMARC judges alignment, not validity',
    };
  }

  let expected: string;
  try {
    expected = publicKeyBase64(identity.privateKey);
  } catch (e) {
    return { aligned: false, reason: `the DKIM private key could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }

  const name = `${identity.selector}._domainkey.${identity.domain}`;
  let records: string[][];
  try {
    records = await resolveTxt(name);
  } catch (e) {
    const code = (e as { code?: string }).code;
    return { aligned: false, reason: `no DKIM record at ${name} (${code ?? (e instanceof Error ? e.message : String(e))})` };
  }

  const published: string[] = [];
  for (const chunks of records) {
    // A TXT record longer than 255 bytes arrives split; a DKIM RSA key always is. Joining WITHOUT a
    // separator is the specified behaviour, and getting it wrong makes a correct record look wrong.
    const tags = parseDkimRecord(chunks.join(''));
    const p = tags.get('p');
    if (p === undefined) continue;
    if (p === '') return { aligned: false, reason: `the DKIM key at ${name} is published as revoked (p= is empty)` };
    published.push(p.replace(/\s+/g, ''));
  }
  if (published.length === 0) return { aligned: false, reason: `${name} exists but publishes no DKIM p= tag` };

  const match = published.some((p) => {
    if (p === expected) return true;
    // Same key, differently encoded (line wrapping, a re-export). Compare the parsed keys rather
    // than the strings, so a cosmetic difference is not reported as a misconfiguration.
    try {
      return Buffer.from(
        createPublicKey({ key: Buffer.from(p, 'base64'), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'der' }),
      ).toString('base64') === expected;
    } catch {
      return false;
    }
  });

  return match
    ? { aligned: true, detail: `d=${identity.domain} s=${identity.selector}, public key published and matching` }
    : {
        aligned: false,
        reason:
          `the key published at ${name} is not the public half of the configured private key — ` +
          'signing with it would produce a signature that FAILS verification, which is worse for ' +
          'deliverability than not signing at all',
      };
}
