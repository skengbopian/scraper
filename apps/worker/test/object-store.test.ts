import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex, verifyStoredObject } from '@scraper/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FilesystemObjectStore } from '../src/providers/object-store/fs.js';
import { createObjectStore, ObjectStoreConfigError } from '../src/providers/object-store/resolve.js';
import { isEuObjectStoreRegion, S3ObjectStore } from '../src/providers/object-store/s3.js';
import { encodeRfc3986, signS3Request } from '../src/providers/object-store/sigv4.js';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'scraper-objstore-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const utf8 = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('FilesystemObjectStore — posture A', () => {
  it('round-trips: the bytes the chain hashed are the bytes on disk', async () => {
    const store = new FilesystemObjectStore(root);
    const body = 'Widerspruch nach Art. 21 Abs. 2 DSGVO\n';
    const ref = await store.put('evidence/req_1/outbound-copy-1.md', body);

    expect(ref).toBe('fs://evidence/req_1/outbound-copy-1.md');
    // The reference is the KEY, never the absolute path: an absolute path in the database breaks
    // when the data directory moves and leaks the host layout into rows counsel may see.
    expect(ref).not.toContain(root);
    expect(utf8((await store.get(ref))!)).toBe(body);
    expect(await verifyStoredObject(store, ref, sha256Hex(body))).toMatchObject({ present: true, matches: true });
    expect(await readFile(join(root, 'evidence/req_1/outbound-copy-1.md'), 'utf8')).toBe(body);
  });

  it('delete is idempotent, and a deleted object reads back as absent', async () => {
    const store = new FilesystemObjectStore(root);
    const ref = await store.put('evidence/req_del/outbound-copy-1.md', 'x');
    await store.delete(ref);
    expect(await store.get(ref)).toBeNull();
    // The purge sweep can crash between the delete and the tombstone and re-run.
    await expect(store.delete(ref)).resolves.toBeUndefined();
  });

  it('re-putting identical bytes succeeds — a retry after a crash is not an overwrite', async () => {
    const store = new FilesystemObjectStore(root);
    const ref1 = await store.put('evidence/req_2/outbound-copy-1.md', 'same');
    const ref2 = await store.put('evidence/req_2/outbound-copy-1.md', 'same');
    expect(ref2).toBe(ref1);
  });

  it('REFUSES to overwrite an anchored artefact with different bytes', async () => {
    const store = new FilesystemObjectStore(root);
    await store.put('evidence/req_3/outbound-copy-1.md', 'the letter counsel signed');
    await expect(store.put('evidence/req_3/outbound-copy-1.md', 'something else')).rejects.toThrow(
      /refusing to overwrite/,
    );
    // And the original is untouched: the chain still describes what is there.
    expect(utf8((await store.get('fs://evidence/req_3/outbound-copy-1.md'))!)).toBe('the letter counsel signed');
  });

  it('leaves no partial file behind — the write is a rename, not an append', async () => {
    const store = new FilesystemObjectStore(root);
    await store.put('evidence/req_4/outbound-copy-1.md', 'body');
    const entries = await readdir(join(root, 'evidence/req_4'));
    expect(entries).toEqual(['outbound-copy-1.md']);
    expect(entries.some((e) => e.endsWith('.part'))).toBe(false);
  });

  it('a hostile carrier tracking reference cannot write outside the root', async () => {
    const store = new FilesystemObjectStore(root);
    // The exact key shape ControllerGateway builds for a POSTAL_PROOF.
    await expect(store.put('evidence/req_5/postal-proof-../../../../pwned.txt', 'x')).rejects.toThrow(
      /unsafe object key/,
    );
    await expect(store.put('../../pwned.txt', 'x')).rejects.toThrow(/unsafe object key/);
  });

  it('refuses a reference belonging to another store rather than resolving it', async () => {
    const store = new FilesystemObjectStore(root);
    await expect(store.get('s3://bucket/evidence/req_1/x.md')).rejects.toThrow(/does not own the reference/);
    await expect(store.delete('unconfigured://evidence/req_1/x.md')).rejects.toThrow(/does not own the reference/);
  });

  it('refuses a relative root — a root that moves with the working directory is not a store', () => {
    expect(() => new FilesystemObjectStore('./objects')).toThrow(/absolute path/);
  });
});

describe('createObjectStore — the sixth seam', () => {
  it('refuses an unset selector rather than falling back to something', () => {
    expect(() => createObjectStore({ NODE_ENV: 'development' })).toThrow(ObjectStoreConfigError);
    expect(() => createObjectStore({ NODE_ENV: 'development' })).toThrow(/must be one of fs \| s3/);
  });

  it('refuses an unknown selector', () => {
    expect(() => createObjectStore({ SCRAPER_OBJECT_STORE: 'gcs' })).toThrow(/got "gcs"/);
  });

  it('fs requires a root, and requires it absolute outside development', () => {
    expect(() => createObjectStore({ SCRAPER_OBJECT_STORE: 'fs' })).toThrow(/requires OBJECT_STORE_FS_ROOT/);
    expect(() =>
      createObjectStore({ SCRAPER_OBJECT_STORE: 'fs', OBJECT_STORE_FS_ROOT: './objects', NODE_ENV: 'production' }),
    ).toThrow(/absolute path outside development/);
    // Allowed in development so `./.data/objects` works from a checkout.
    expect(
      createObjectStore({ SCRAPER_OBJECT_STORE: 'fs', OBJECT_STORE_FS_ROOT: './objects', NODE_ENV: 'development' }).name,
    ).toMatch(/^fs\(\//);
  });

  it('s3 names its missing credentials rather than failing at the first request', () => {
    expect(() =>
      createObjectStore({ SCRAPER_OBJECT_STORE: 's3', OBJECT_STORE_ENDPOINT: 'https://s3.fr-par.scw.cloud' }),
    ).toThrow(/requires OBJECT_STORE_BUCKET/);
  });
});

describe('EU residency is a refusal, not a warning (CLAUDE.md §3)', () => {
  it('allows AWS eu-* and the named non-AWS EU regions', () => {
    for (const r of ['eu-central-1', 'eu-west-3', 'eu-north-1', 'fr-par', 'nl-ams', 'fsn1', 'hel1', 'gra']) {
      expect(isEuObjectStoreRegion(r), r).toBe(true);
    }
  });

  it('fails closed on anything else, including OVH’s Canadian region', () => {
    for (const r of ['us-east-1', 'ap-south-1', 'bhs', 'sa-east-1', '', 'europe']) {
      expect(isEuObjectStoreRegion(r), r).toBe(false);
    }
  });

  it('constructing an S3 store outside the EU throws', () => {
    expect(
      () =>
        new S3ObjectStore({
          endpoint: 'https://s3.us-east-1.amazonaws.com',
          bucket: 'scraper-evidence',
          region: 'us-east-1',
          accessKeyId: 'AKIA',
          secretAccessKey: 'secret',
        }),
    ).toThrow(/must be stored in an EU region/);
  });
});

/** A fetch double that records what was asked of it and answers from a scripted queue. */
function fakeFetch(script: readonly { status: number; body?: Uint8Array; headers?: Record<string, string> }[]) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: Uint8Array | undefined }[] = [];
  let i = 0;
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const step = script[i++] ?? { status: 500 };
    calls.push({
      method: String(init?.method),
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as Uint8Array | undefined,
    });
    return new Response(step.body ? (step.body as unknown as BodyInit) : null, {
      status: step.status,
      headers: step.headers,
    });
  }) as unknown as typeof globalThis.fetch;
  return { impl, calls };
}

function s3(fetchImpl: typeof globalThis.fetch): S3ObjectStore {
  return new S3ObjectStore({
    endpoint: 'https://s3.fr-par.scw.cloud/',
    bucket: 'scraper-evidence',
    region: 'fr-par',
    accessKeyId: 'SCWABCDEFGHIJKLMNOPQ',
    secretAccessKey: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    fetchImpl,
    now: () => new Date('2026-08-15T14:30:00.000Z'),
  });
}

describe('S3ObjectStore — request construction (credential-gated, not live-verified)', () => {
  it('HEADs before it PUTs, path-style, with the content hash as metadata', async () => {
    const { impl, calls } = fakeFetch([{ status: 404 }, { status: 200 }]);
    const ref = await s3(impl).put('evidence/req_1/outbound-copy-1.md', 'body');

    expect(ref).toBe('s3://scraper-evidence/evidence/req_1/outbound-copy-1.md');
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'PUT']);
    expect(calls[0]!.url).toBe('https://s3.fr-par.scw.cloud/scraper-evidence/evidence/req_1/outbound-copy-1.md');
    expect(calls[1]!.headers['x-amz-meta-sha256']).toBe(sha256Hex('body'));
    expect(calls[1]!.headers['x-amz-content-sha256']).toBe(sha256Hex('body'));
    expect(calls[1]!.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=SCWABCDEFGHIJKLMNOPQ\/20260815\/fr-par\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/,
    );
  });

  it('an identical object already present is a no-op, a different one is refused', async () => {
    const present = { status: 200, headers: { 'x-amz-meta-sha256': sha256Hex('body') } };
    const same = fakeFetch([present]);
    expect(await s3(same.impl).put('evidence/req_1/x.md', 'body')).toBe('s3://scraper-evidence/evidence/req_1/x.md');
    expect(same.calls.map((c) => c.method)).toEqual(['HEAD']);

    const different = fakeFetch([{ status: 200, headers: { 'x-amz-meta-sha256': sha256Hex('other') } }]);
    await expect(s3(different.impl).put('evidence/req_1/x.md', 'body')).rejects.toThrow(/refusing to overwrite/);
    expect(different.calls.map((c) => c.method)).toEqual(['HEAD']);
  });

  it('a missing object reads as null; a delete of a missing object succeeds', async () => {
    const miss = fakeFetch([{ status: 404 }]);
    expect(await s3(miss.impl).get('s3://scraper-evidence/evidence/req_1/x.md')).toBeNull();

    const gone = fakeFetch([{ status: 404 }]);
    await expect(s3(gone.impl).delete('s3://scraper-evidence/evidence/req_1/x.md')).resolves.toBeUndefined();
  });

  it('a server error is raised, never swallowed into "absent"', async () => {
    const broken = fakeFetch([{ status: 500 }]);
    await expect(s3(broken.impl).get('s3://scraper-evidence/evidence/req_1/x.md')).rejects.toThrow(/HTTP 500/);
  });

  it('owns() is bucket-specific — another bucket is not ours to delete', async () => {
    const store = s3(fakeFetch([]).impl);
    expect(store.owns('s3://scraper-evidence/evidence/req_1/x.md')).toBe(true);
    expect(store.owns('s3://someone-elses-bucket/evidence/req_1/x.md')).toBe(false);
    expect(store.owns('fs://evidence/req_1/x.md')).toBe(false);
    await expect(store.get('s3://someone-elses-bucket/evidence/req_1/x.md')).rejects.toThrow(/does not own/);
  });
});

describe('SigV4', () => {
  const base = {
    method: 'PUT' as const,
    origin: 'https://s3.fr-par.scw.cloud',
    pathSegments: ['scraper-evidence', 'evidence', 'req_1', 'x.md'],
    region: 'fr-par',
    accessKeyId: 'AKID',
    secretAccessKey: 'SECRET',
    payload: new TextEncoder().encode('body'),
    now: new Date('2026-08-15T14:30:00.000Z'),
  };

  it('encodes a segment per RFC 3986, not per encodeURIComponent', () => {
    // The five characters encodeURIComponent leaves alone and RFC 3986 does not — and they are
    // exactly the ones a carrier tracking reference might contain.
    expect(encodeRfc3986("a!b'c(d)e*f")).toBe('a%21b%27c%28d%29e%2Af');
    expect(encodeRfc3986('RR 1234 DE')).toBe('RR%201234%20DE');
    expect(encodeRfc3986('a-b_c.d~e')).toBe('a-b_c.d~e');
  });

  it('is deterministic for the same request at the same instant', () => {
    expect(signS3Request(base).headers.authorization).toBe(signS3Request(base).headers.authorization);
  });

  it('binds the payload — one changed byte is a different signature', () => {
    const other = { ...base, payload: new TextEncoder().encode('bodz') };
    expect(signS3Request(other).headers.authorization).not.toBe(signS3Request(base).headers.authorization);
    expect(signS3Request(other).headers['x-amz-content-sha256']).toBe(sha256Hex('bodz'));
  });

  it('binds the path, the method and the instant', () => {
    const sig = (i: Parameters<typeof signS3Request>[0]): string => signS3Request(i).headers.authorization!;
    expect(sig({ ...base, pathSegments: [...base.pathSegments.slice(0, 3), 'y.md'] })).not.toBe(sig(base));
    expect(sig({ ...base, method: 'DELETE' })).not.toBe(sig(base));
    expect(sig({ ...base, now: new Date('2026-08-15T14:30:01.000Z') })).not.toBe(sig(base));
  });

  it('signs exactly the headers it declares, sorted', () => {
    const signed = signS3Request({ ...base, extraHeaders: { 'content-type': 'application/octet-stream' } });
    const declared = /SignedHeaders=([^,]+)/.exec(signed.headers.authorization!)![1];
    expect(declared).toBe('content-type;host;x-amz-content-sha256;x-amz-date');
    for (const name of declared!.split(';')) expect(Object.keys(signed.headers)).toContain(name);
  });

  it('stamps x-amz-date in the basic ISO 8601 form the scope is derived from', () => {
    const signed = signS3Request(base);
    expect(signed.headers['x-amz-date']).toBe('20260815T143000Z');
    expect(signed.headers.authorization).toContain('/20260815/fr-par/s3/aws4_request');
  });
});
