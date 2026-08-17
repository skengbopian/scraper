import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertStartupSafe, loadWorkerConfig, WorkerConfigError } from '../src/config.js';
import { createProviders, ProviderFactoryError } from '../src/providers/factory.js';
import { SimulatedTimestamper } from '../src/providers/stub-providers.js';

/**
 * THE DELIBERATE BOOT REFUSAL IS GONE, and this is the suite that has to earn its removal.
 *
 * `config.ts` refused every non-development boot outright, because the five `SCRAPER_*` selectors
 * were validated at startup and dereferenced by nothing — `main.ts` hardwired stubs regardless, so a
 * deployment could satisfy every check and still send its letters into a black hole while the state
 * machine recorded them as sent. The throw came out in the same commit as the factory that replaces
 * it, and never before.
 */

const root = mkdtempSync(join(tmpdir(), 'scraper-boot-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A deployment posture that should boot: real store, real mailer, D6's simulated timestamper. */
const DEPLOY: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://scraper:scraper@localhost:5432/scraper',
  MODEL_REGION: 'eu',
  SCRAPER_MAILER: 'stub',
  SCRAPER_POSTAL: 'stub',
  SCRAPER_TIMESTAMPER: 'simulated',
  SCRAPER_DOC_SANDBOX: 'refusing',
  SCRAPER_OBJECT_STORE: 'fs',
  OBJECT_STORE_FS_ROOT: root,
};

/** The same, with the two seams that must genuinely be real in a deployment set to real adapters. */
const REAL: NodeJS.ProcessEnv = { ...DEPLOY, SCRAPER_MAILER: 'smtp', SCRAPER_POSTAL: 'letterxpress' };

describe('assertStartupSafe in deploy posture', () => {
  it('no longer refuses outright — the factory exists', () => {
    expect(() => assertStartupSafe(REAL)).not.toThrow();
  });

  it('boots with SCRAPER_TIMESTAMPER=simulated, which is D6’s shipped default', () => {
    // Refusing this made the degraded-but-honest mode unbootable in deploy posture, and the
    // alternative was worse: an operator with no QTSP account naming the real adapter with no token
    // would get CREDENTIALS_MISSING on every dispatch — no sends at all, one failed letter at a time.
    expect(() => assertStartupSafe({ ...REAL, SCRAPER_TIMESTAMPER: 'simulated' })).not.toThrow();
    // And the reason it is safe is structural, not a promise: a simulated anchor cannot mint the
    // branded evidence id, so no such node can start an Art. 12(3) clock.
    expect(new SimulatedTimestamper()).toBeDefined();
  });

  it('still refuses a stub mailer, a stub postal provider and an unset object store', () => {
    for (const [seam, value] of [
      ['SCRAPER_MAILER', 'stub'],
      ['SCRAPER_POSTAL', 'stub'],
      ['SCRAPER_DOC_SANDBOX', undefined],
      ['SCRAPER_OBJECT_STORE', undefined],
    ] as const) {
      const env = { ...REAL, [seam]: value };
      expect(() => assertStartupSafe(env), seam).toThrow(WorkerConfigError);
      expect(() => assertStartupSafe(env), seam).toThrow(new RegExp(seam));
    }
  });

  it('does NOT demand SCRAPER_IDENTITY, because the worker has no identity consumer', () => {
    // It was in the required list and refused the boot over a variable the worker would then ignore.
    // The gate that matters is the API's IdentityVerifiedGuard, which is untouched by this.
    const { SCRAPER_IDENTITY: _omitted, ...withoutIdentity } = { ...REAL, SCRAPER_IDENTITY: 'stub' };
    expect(() => assertStartupSafe(withoutIdentity)).not.toThrow();
  });

  it('still refuses dev fixtures and a non-EU model region anywhere', () => {
    expect(() => assertStartupSafe({ ...REAL, SCRAPER_DEV_FIXTURES: '1' })).toThrow(/SCRAPER_DEV_FIXTURES/);
    expect(() => assertStartupSafe({ ...REAL, MODEL_REGION: 'us' })).toThrow(/MODEL_REGION/);
    // Residency is checked in EVERY environment, development included — it is a misconfiguration,
    // not a preference.
    expect(() => assertStartupSafe({ NODE_ENV: 'development', MODEL_REGION: 'us' })).toThrow(/MODEL_REGION/);
  });

  it('loadWorkerConfig returns a usable config in deploy posture', () => {
    const config = loadWorkerConfig(REAL);
    expect(config.nodeEnv).toBe('production');
    expect(config.engine).toBe('pgboss');
  });
});

describe('createProviders', () => {
  it('resolves every seam and names what it resolved', () => {
    const providers = createProviders(DEPLOY);
    expect(providers.describe()).toEqual([
      'mailer=stub',
      'postal=stub',
      'timestamper=simulated — NO statutory clock can start on this node (owner decision D6)',
      'doc-sandbox=refusing (refuses every document; the parser is phase 5+)',
      `object-store=fs(${root})`,
    ]);
  });

  it('the doc sandbox refuses every document, at confidence 0 — item 7 stays unwired', async () => {
    // `RefusingDocSandbox` is currently the only thing stopping a shape-mismatched parse reaching the
    // provenance ledger as INCOMPLETE-answer escalation material.
    const { docSandbox } = createProviders(DEPLOY);
    const parsed = await docSandbox.parse(
      { id: 'doc_1', mimeType: 'application/pdf', bytes: new Uint8Array(), receivedAt: new Date() },
      {},
    );
    expect(parsed.confidence).toBe(0);
    expect(parsed.structured).toEqual({});
  });

  it('names the seam and the accepted values when a selector is wrong', () => {
    expect(() => createProviders({ ...DEPLOY, SCRAPER_MAILER: 'sendgrid' })).toThrow(ProviderFactoryError);
    expect(() => createProviders({ ...DEPLOY, SCRAPER_MAILER: 'sendgrid' })).toThrow(/SCRAPER_MAILER="sendgrid" — expected one of stub \| smtp/);
  });

  it('an object store that cannot be built stops the boot rather than the first send', () => {
    expect(() => createProviders({ ...DEPLOY, OBJECT_STORE_FS_ROOT: undefined })).toThrow(/requires OBJECT_STORE_FS_ROOT/);
  });
});
