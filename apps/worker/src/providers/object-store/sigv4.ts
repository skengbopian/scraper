import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4, the subset an S3-compatible object store needs.
 *
 * Hand-rolled rather than pulled from a vendor SDK, for the same reason the other real adapters are
 * (`apps/worker/src/providers/real-providers.ts`): the whole dependency would exist to sign four
 * request shapes, and every S3-compatible EU provider this product targets — Scaleway, Hetzner, OVH,
 * self-hosted MinIO — speaks the same signing protocol as AWS. `fetch` and `node:crypto` are enough.
 *
 * STATUS: NOT LIVE-VERIFIED. No object-store account exists yet. The unit suite pins the properties
 * that a bug would break silently (the payload and the path are bound into the signature, the header
 * set is the one that was signed, the result is deterministic); whether a live endpoint ACCEPTS the
 * signature is an onboarding step, and a rejected signature fails loudly with HTTP 403 before any
 * letter reaches a controller — the gateway captures evidence before it touches the wire, so a
 * broken signer stops sends rather than losing them.
 * TODO(credentials): re-verify against the chosen provider's live endpoint at onboarding.
 */

export const EMPTY_PAYLOAD_SHA256 = createHash('sha256').update('').digest('hex');

export interface SignedRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface SigV4Input {
  readonly method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  /** Origin only, no trailing slash: `https://s3.fr-par.scw.cloud`. */
  readonly origin: string;
  /** Raw, UNENCODED path segments. Encoding is part of the canonical request and happens here. */
  readonly pathSegments: readonly string[];
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** The bytes that will be sent. Empty for GET/HEAD/DELETE. */
  readonly payload: Uint8Array;
  /** Extra headers to sign, lowercase names (`content-type`, `x-amz-meta-…`). */
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly now: Date;
}

const SERVICE = 's3';

/**
 * RFC 3986 encoding of one path segment.
 *
 * `encodeURIComponent` leaves `!*'()` unencoded; RFC 3986's unreserved set does not include them,
 * and S3 canonicalisation follows RFC 3986. Getting this wrong produces a signature mismatch only
 * for keys containing those characters — which is exactly the class of key a carrier tracking
 * reference might produce, so it would surface as an intermittent failure on the postal path.
 */
export function encodeRfc3986(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** `20260815T143000Z` and `20260815`. */
function stamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

export function signS3Request(input: SigV4Input): SignedRequest {
  const { amzDate, dateStamp } = stamps(input.now);
  const canonicalUri = `/${input.pathSegments.map(encodeRfc3986).join('/')}`;
  const payloadHash = input.payload.length === 0 ? EMPTY_PAYLOAD_SHA256 : sha256(input.payload);
  const host = new URL(input.origin).host;

  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(input.extraHeaders ?? {}),
  };

  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = names.join(';');

  // Query string is empty for every operation this adapter performs. When one arrives (listing,
  // multipart) it must be canonicalised too — sorted, RFC 3986 encoded — or the signature breaks.
  const canonicalRequest = [input.method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${input.region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), SERVICE), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');

  return {
    url: `${input.origin}${canonicalUri}`,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
