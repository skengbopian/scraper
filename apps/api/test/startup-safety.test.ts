import { describe, expect, it } from 'vitest';

/**
 * The API's boot gate — the sibling of the worker's `assertStartupSafe()`.
 *
 * Doctrine, restated because every case below depends on it: dev conveniences activate on an
 * ALLOW-list. The check is `NODE_ENV is development or test`, never `NODE_ENV !== 'production'`,
 * because an unset, "staging", "prod" or misspelled NODE_ENV is a deployment — and it is precisely
 * the deployments that got their environment wrong which most need the refusal (audit H1).
 *
 * Each refusal here answers "what does a deployment silently do if this is not checked?", and none
 * of the four answers is "crash loudly", which is why the boot has to.
 */
const DEPLOY = {
  SCRAPER_KEK_MODE: 'env',
  SCRAPER_CORS_ORIGINS: 'https://app.example',
  SCRAPER_REPOSITORY: 'prisma',
  SCRAPER_SCHEDULER: 'pgboss',
} as const;

const load = async () => import('../dist/common/startup-safety.js');

describe('assertApiStartupSafe', () => {
  it('accepts a fully configured deployment', async () => {
    const { assertApiStartupSafe } = await load();
    expect(() => assertApiStartupSafe({ NODE_ENV: 'production', ...DEPLOY } as NodeJS.ProcessEnv)).not.toThrow();
  });

  for (const nodeEnv of ['development', 'test']) {
    it(`lets a bare ${nodeEnv} environment through — dev is the allow-listed case`, async () => {
      const { assertApiStartupSafe } = await load();
      expect(() => assertApiStartupSafe({ NODE_ENV: nodeEnv } as NodeJS.ProcessEnv)).not.toThrow();
    });
  }

  for (const nodeEnv of [undefined, '', 'staging', 'prod', 'Production']) {
    it(`treats NODE_ENV=${nodeEnv === undefined ? 'unset' : `"${nodeEnv}"`} as a deployment`, async () => {
      const { assertApiStartupSafe } = await load();
      const env = (nodeEnv === undefined ? {} : { NODE_ENV: nodeEnv }) as NodeJS.ProcessEnv;
      expect(() => assertApiStartupSafe(env)).toThrow(/refusing to boot/);
    });
  }

  it('refuses the in-memory repository — a deployment would lose every request on restart', async () => {
    const { assertApiStartupSafe } = await load();
    const env = { NODE_ENV: 'production', ...DEPLOY, SCRAPER_REPOSITORY: 'memory' } as NodeJS.ProcessEnv;
    expect(() => assertApiStartupSafe(env)).toThrow(/SCRAPER_REPOSITORY must be "prisma"/);
  });

  it('refuses an UNSET repository the same way — `.env.example` is not a deployment posture', async () => {
    const { assertApiStartupSafe } = await load();
    const { SCRAPER_REPOSITORY: _drop, ...rest } = DEPLOY;
    expect(() => assertApiStartupSafe({ NODE_ENV: 'production', ...rest } as NodeJS.ProcessEnv)).toThrow(
      /SCRAPER_REPOSITORY must be "prisma"/,
    );
  });

  it('refuses a missing scheduler — sends would go out and no deadline timer would ever be armed', async () => {
    const { assertApiStartupSafe } = await load();
    const { SCRAPER_SCHEDULER: _drop, ...rest } = DEPLOY;
    expect(() => assertApiStartupSafe({ NODE_ENV: 'production', ...rest } as NodeJS.ProcessEnv)).toThrow(
      /SCRAPER_SCHEDULER must be "pgboss"/,
    );
  });

  it('still refuses the dev KEK resolver and a missing CORS list', async () => {
    const { assertApiStartupSafe } = await load();
    const { SCRAPER_KEK_MODE: _k, ...noKek } = DEPLOY;
    const { SCRAPER_CORS_ORIGINS: _c, ...noCors } = DEPLOY;
    expect(() => assertApiStartupSafe({ NODE_ENV: 'production', ...noKek } as NodeJS.ProcessEnv)).toThrow(
      /SCRAPER_KEK_MODE/,
    );
    expect(() => assertApiStartupSafe({ NODE_ENV: 'production', ...noCors } as NodeJS.ProcessEnv)).toThrow(
      /SCRAPER_CORS_ORIGINS/,
    );
  });

  it('names what is wrong and what to set — a boot refusal an operator cannot act on is an outage', async () => {
    const { assertApiStartupSafe } = await load();
    const env = { NODE_ENV: 'production', ...DEPLOY, SCRAPER_REPOSITORY: 'memory' } as NodeJS.ProcessEnv;
    expect(() => assertApiStartupSafe(env)).toThrow(/"memory"/);
  });
});

describe('corsOrigins', () => {
  it('strips the file:// "null" origin in a deployment even when configured', async () => {
    const { corsOrigins } = await load();
    const env = { NODE_ENV: 'production', SCRAPER_CORS_ORIGINS: 'https://app.example, null' } as NodeJS.ProcessEnv;
    expect(corsOrigins(env)).toEqual(['https://app.example']);
  });

  it('keeps it in development, where the alpha page runs from file://', async () => {
    const { corsOrigins } = await load();
    const env = { NODE_ENV: 'development', SCRAPER_CORS_ORIGINS: 'null' } as NodeJS.ProcessEnv;
    expect(corsOrigins(env)).toEqual(['null']);
  });
});
