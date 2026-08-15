import { assertSafeObjectKey, parseObjectRef, sha256Hex, type ObjectStore } from '@scraper/core';
import { signS3Request } from './sigv4.js';

/**
 * S3-compatible object store, EU region only — postures B and C (docs/14 §1).
 *
 * Path-style addressing (`<endpoint>/<bucket>/<key>`) because that is what every S3-compatible EU
 * provider and self-hosted MinIO speaks. Virtual-host addressing is not implemented; an operator who
 * needs it has a provider that requires it, and that is a config seam to add deliberately rather
 * than a guess to make now.
 *
 * STATUS: CREDENTIAL-GATED, NOT LIVE-VERIFIED — the same status as the other real adapters. See
 * `sigv4.ts` for why an unaccepted signature is a safe failure.
 */

/**
 * EU residency (CLAUDE.md §3) as far as a region STRING can carry it.
 *
 * This is an allow-list of region identifiers, not a claim about geography, and the difference
 * matters in both directions:
 *
 *   - It fails CLOSED on an unknown region. A new EU region has to be added here by a human who can
 *     say why it is EU. That is a one-line change and the conservative default CLAUDE.md asks for.
 *   - It cannot catch the opposite error. A MinIO instance in Virginia will happily answer to
 *     `eu-central-1`, because for a self-hosted endpoint the region string is only an input to the
 *     signature. Nothing in code can tell where a host is. That residual check is a human one, and
 *     it is a ☐ row in `scripts/readiness.mjs`, not a green tick here.
 */
const NON_AWS_EU_REGIONS: readonly string[] = [
  'fr-par', 'nl-ams', 'pl-waw', // Scaleway
  'fsn1', 'nbg1', 'hel1', // Hetzner (Falkenstein, Nürnberg, Helsinki)
  'gra', 'sbg', 'rbx', 'de', 'waw', // OVHcloud EU regions — deliberately NOT bhs (Beauharnois, Canada)
];

export function isEuObjectStoreRegion(region: string): boolean {
  return /^eu-[a-z]+-\d+$/.test(region) || NON_AWS_EU_REGIONS.includes(region);
}

export interface S3ObjectStoreOptions {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Injected so the adapter is testable without a network and without a vendor account. */
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

/** The header the store carries the content hash in, so a re-put can be told from an overwrite. */
const SHA256_META_HEADER = 'x-amz-meta-sha256';

export class S3ObjectStore implements ObjectStore {
  readonly name: string;
  private readonly origin: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly now: () => Date;

  constructor(private readonly opts: S3ObjectStoreOptions) {
    if (!opts.endpoint) throw new Error('the S3 object store requires OBJECT_STORE_ENDPOINT');
    if (!opts.bucket) throw new Error('the S3 object store requires OBJECT_STORE_BUCKET');
    if (!opts.accessKeyId || !opts.secretAccessKey) {
      throw new Error('the S3 object store requires OBJECT_STORE_ACCESS_KEY_ID and OBJECT_STORE_SECRET_ACCESS_KEY');
    }
    if (!isEuObjectStoreRegion(opts.region)) {
      throw new Error(
        `refusing to use object-store region ${JSON.stringify(opts.region)}: personal data and evidence ` +
          'artefacts must be stored in an EU region (CLAUDE.md §3). If this region IS in the EU, add it to ' +
          'NON_AWS_EU_REGIONS in apps/worker/src/providers/object-store/s3.ts with the reason.',
      );
    }
    this.origin = opts.endpoint.replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.now = opts.now ?? (() => new Date());
    this.name = `s3(${this.origin}/${opts.bucket}, ${opts.region})`;
  }

  owns(ref: string): boolean {
    const parsed = parseObjectRef(ref);
    // Bucket-specific on purpose: a reference to another bucket is NOT ours to delete, and calling
    // it ours would tombstone a row whose raw document is still sitting somewhere else.
    return parsed?.scheme === 's3' && parsed.rest.startsWith(`${this.opts.bucket}/`);
  }

  async put(key: string, bytes: Uint8Array | string): Promise<string> {
    assertSafeObjectKey(key);
    const content = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    const digest = sha256Hex(content);

    // HEAD first, so an idempotent retry is free and an overwrite is refused. One extra round trip
    // per evidence artefact is nothing at this product's volume (one letter per send).
    const head = await this.send('HEAD', key, new Uint8Array());
    if (head.status === 200) {
      const stored = head.headers.get(SHA256_META_HEADER);
      if (stored === digest) return this.refFor(key);
      throw new Error(
        `refusing to overwrite ${key}: an object already exists there with ` +
          `${stored ? `a different hash (${stored.slice(0, 12)}…)` : 'no recorded hash'}, offered ` +
          `${digest.slice(0, 12)}…. Evidence artefacts are write-once — the chain hashes what was sent.`,
      );
    }
    if (head.status !== 404) {
      throw new Error(`object store HEAD ${key}: HTTP ${head.status} — ${await head.text()}`);
    }

    const put = await this.send('PUT', key, content, {
      'content-type': 'application/octet-stream',
      [SHA256_META_HEADER]: digest,
    });
    if (!put.ok) throw new Error(`object store PUT ${key}: HTTP ${put.status} — ${await put.text()}`);
    return this.refFor(key);
  }

  async get(ref: string): Promise<Uint8Array | null> {
    const res = await this.send('GET', this.keyFor(ref), new Uint8Array());
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`object store GET ${ref}: HTTP ${res.status} — ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async delete(ref: string): Promise<void> {
    const res = await this.send('DELETE', this.keyFor(ref), new Uint8Array());
    // S3 answers 204 for a delete and also for a key that was never there — idempotent by protocol,
    // which is what the purge sweep needs after a crash between the delete and the tombstone.
    if (res.ok || res.status === 404) return;
    throw new Error(`object store DELETE ${ref}: HTTP ${res.status} — ${await res.text()}`);
  }

  private refFor(key: string): string {
    return `s3://${this.opts.bucket}/${key}`;
  }

  private keyFor(ref: string): string {
    if (!this.owns(ref)) {
      throw new Error(`${this.name} does not own the reference ${ref} — it names a different store or bucket`);
    }
    const key = parseObjectRef(ref)!.rest.slice(this.opts.bucket.length + 1);
    assertSafeObjectKey(key);
    return key;
  }

  private async send(
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    key: string,
    payload: Uint8Array,
    extraHeaders?: Record<string, string>,
  ): Promise<Response> {
    const signed = signS3Request({
      method,
      origin: this.origin,
      // Path-style: the bucket is the first path segment. Each segment is encoded by the signer, so
      // the key is split here rather than passed as one pre-joined string.
      pathSegments: [this.opts.bucket, ...key.split('/')],
      region: this.opts.region,
      accessKeyId: this.opts.accessKeyId,
      secretAccessKey: this.opts.secretAccessKey,
      payload,
      extraHeaders,
      now: this.now(),
    });
    return this.fetchImpl(signed.url, {
      method,
      headers: signed.headers,
      body: method === 'PUT' ? payload : undefined,
    });
  }
}
