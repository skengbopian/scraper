import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * `scripts/readiness.mjs` states the same three requirements as `assertApiStartupSafe` — repository,
 * scheduler, DATABASE_URL — and states them in a second language, in a script that is deliberately
 * dependency-free so it can run before the toolchain exists. Two copies of a rule are two copies of
 * a rule.
 *
 * So this drives the actual script over the actual environments and asserts the two agree: whenever
 * readiness marks one of those rows ✗ in DEPLOY posture, the boot gate refuses, and whenever it
 * marks them ✓, the boot gate accepts. A readiness report that is greener than the boot is the
 * dangerous direction — an operator ticks the pre-send checklist and then cannot start the process,
 * or worse, believes a warning-free report means the node is sound.
 */
describe('readiness.mjs agrees with the boot gate', () => {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const DEPLOY_ENV = {
    NODE_ENV: 'production',
    SCRAPER_KEK_MODE: 'env',
    SCRAPER_CORS_ORIGINS: 'https://app.example',
    SCRAPER_REPOSITORY: 'prisma',
    SCRAPER_SCHEDULER: 'pgboss',
    DATABASE_URL: 'postgresql://scraper:scraper@localhost:5432/scraper3',
  };

  /** The three shared rows, as readiness prints them. */
  const ROWS = [
    { label: 'DATABASE_URL set', drop: 'DATABASE_URL' },
    { label: 'SCRAPER_REPOSITORY=prisma', drop: 'SCRAPER_REPOSITORY' },
    { label: 'SCRAPER_SCHEDULER=pgboss', drop: 'SCRAPER_SCHEDULER' },
  ] as const;

  function readiness(env: Record<string, string>): string {
    try {
      return execFileSync(process.execPath, ['scripts/readiness.mjs'], {
        cwd: ROOT,
        encoding: 'utf8',
        // A clean environment, not the runner's: an ambient DATABASE_URL on the developer's machine
        // would make this test pass for the wrong reason.
        env: { PATH: process.env.PATH ?? '', ...env },
      });
    } catch (e) {
      // Exit 1 is expected whenever a row FAILs — the report is on stdout either way.
      return String((e as { stdout?: string }).stdout ?? '');
    }
  }

  const rowStatus = (report: string, label: string): '✓' | '✗' | '•' | undefined =>
    report.split('\n').find((l) => l.includes(label))?.trim().charAt(0) as never;

  it('reports all three green on an environment the boot gate accepts', async () => {
    const { assertApiStartupSafe } = await load();
    expect(() => assertApiStartupSafe(DEPLOY_ENV as NodeJS.ProcessEnv)).not.toThrow();
    const report = readiness(DEPLOY_ENV);
    for (const { label } of ROWS) expect(rowStatus(report, label), `${label} in a good deployment`).toBe('✓');
  });

  for (const { label, drop } of ROWS) {
    it(`marks "${label}" ✗ exactly where the boot gate refuses`, async () => {
      const { assertApiStartupSafe } = await load();
      const env = { ...DEPLOY_ENV } as Record<string, string>;
      delete env[drop];
      const report = readiness(env);
      expect(rowStatus(report, label)).toBe('✗');
      // DATABASE_URL is the one the API does not itself refuse — DbModule throws when the client is
      // constructed, not at boot — so the two are only required to agree on the two selectors.
      if (drop !== 'DATABASE_URL') {
        expect(() => assertApiStartupSafe(env as NodeJS.ProcessEnv)).toThrow(new RegExp(drop));
      }
    });
  }

  it('demotes them to warnings in --ci posture, where no deployment values exist', () => {
    const report = (() => {
      try {
        return execFileSync(process.execPath, ['scripts/readiness.mjs', '--ci'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '' },
        });
      } catch (e) {
        return String((e as { stdout?: string }).stdout ?? '');
      }
    })();
    for (const { label } of ROWS) expect(rowStatus(report, label), `${label} in CI`).toBe('•');
    // …and the repo-answerable rows still gate, which is the whole point of running it in CI.
    expect(report).toContain('no mechanical failures');
    expect(report).toContain('spec-audit green');
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
