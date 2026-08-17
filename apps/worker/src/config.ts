import { ENGINE_NAMES, type EngineName } from './engine/factory.js';

/**
 * Worker configuration and the fail-fast startup guards.
 *
 * The guards are re-derived from the pre-audit line's `assertStartupSafe`, whose central insight is
 * worth keeping verbatim: a production process wired to stub providers would "send" legal requests
 * into a black hole while the state machine recorded them as sent. Checking for the literal string
 * "stub" is not enough, because an UNSET selector also falls back to a stub — so production requires
 * every seam to be explicitly configured, a positive check rather than a deny-list.
 *
 * The list has since lost one entry and gained one, and both changes are documented where they are
 * made: `SCRAPER_IDENTITY` left because the worker has no identity consumer, and
 * `SCRAPER_OBJECT_STORE` arrived because an evidence reference to nothing is not evidence.
 * `SCRAPER_TIMESTAMPER=simulated` is now permitted, because a simulated anchor cannot start a clock
 * by construction and refusing it made the shipped default unbootable.
 */
export class WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerConfigError';
  }
}

export interface WorkerConfig {
  readonly nodeEnv: string;
  readonly databaseUrl: string;
  readonly engine: EngineName;
  readonly redisUrl: string;
  readonly rawResponseRetentionDays: number;
  readonly templatesDir: string;
  readonly modelRegion: string;
  /** Sends per controller per hour. A per-controller flood is an anomaly signal, not throughput. */
  readonly maxSendsPerControllerPerHour: number;
}

/** docs/03 retention: raw response documents purge after the normalisation window. */
const DEFAULT_RAW_RESPONSE_RETENTION_DAYS = 30;
const DEFAULT_MAX_SENDS_PER_CONTROLLER_PER_HOUR = 10;

function positiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new WorkerConfigError(`${key} must be a positive integer, got "${raw}"`);
  return value;
}

/**
 * Seams that must be explicitly configured before the worker may run in production.
 *
 * `SCRAPER_IDENTITY` IS NOT HERE, and its absence is the honest answer to a question this list had
 * been getting wrong since wave 5: the worker has no identity consumer. Nothing in `apps/worker`
 * constructs an `IdentityProvider` or could use one — verification happens in the API, before a
 * request may be created at all (`IdentityVerifiedGuard`), and the subject reaching dispatch is
 * already derived from a verified record. Demanding it here made the worker refuse to boot over a
 * variable it would then ignore, which teaches an operator that these checks are ceremony. The seam
 * belongs to the API and moves there with the production identity route (PLAN phase 3, owner
 * decision D1). Its absence from this list is not a relaxation: the gate that matters is in the API
 * and is untouched.
 */
const REQUIRED_REAL_PROVIDERS = [
  'SCRAPER_MAILER',
  'SCRAPER_POSTAL',
  'SCRAPER_TIMESTAMPER',
  'SCRAPER_DOC_SANDBOX',
  // Neither of its values (`fs`, `s3`) is a stub — a filesystem store is the honest posture-A
  // answer — so this entry is here for the UNSET case: without a store the worker writes an evidence
  // reference to nothing, and PLAN §2 puts "object store actually holding the rendered copy the
  // evidence chain hashes" inside the first-real-send gate.
  'SCRAPER_OBJECT_STORE',
] as const;

/**
 * Seams where `simulated` is a real, shipped posture rather than a stub.
 *
 * Only the timestamper, and only because of what a simulated anchor CANNOT do. Owner decision D6
 * makes the degraded no-QTSP mode the shipped default: a node with no qualified account sends,
 * evidences and chases — it simply cannot start an Art. 12(3) clock, because
 * `provableSendEvidenceIdOf()` refuses a `SIMULATED` anchor structurally, in the type system, with
 * no runtime flag to get wrong.
 *
 * Refusing it here made D6's default unbootable in deploy posture, and the alternative was worse
 * than the disease: an operator with no QTSP account would have had to name the real adapter with no
 * token, turning "no statutory clock" into `CREDENTIALS_MISSING` on every dispatch — no sends at
 * all, discovered one failed letter at a time. The boot log says which posture resolved.
 */
const SIMULATED_IS_A_POSTURE: readonly string[] = ['SCRAPER_TIMESTAMPER'];

export function assertStartupSafe(env: NodeJS.ProcessEnv): void {
  // CLAUDE.md §3 / ADR-006: all inference on personal data runs in an EU region. This is a
  // misconfiguration, not a preference, so it is checked in every environment.
  const region = env.MODEL_REGION ?? 'eu';
  if (region !== 'eu') {
    throw new WorkerConfigError(
      `refusing to start: MODEL_REGION must be "eu" — no non-EU inference on personal data ` +
        `(CLAUDE.md §3, ADR-006). Got "${region}".`,
    );
  }

  // ALLOW-list, not `!== 'production'`: an unset, "staging" or misspelled NODE_ENV is a deployment,
  // and a deployment with stub providers is the black hole this guard exists to prevent (the same
  // deny-list trap as audit H1's KEK resolver).
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return;

  const unsafe = REQUIRED_REAL_PROVIDERS.filter(
    (key) => !env[key] || env[key] === 'stub' || (env[key] === 'simulated' && !SIMULATED_IS_A_POSTURE.includes(key)),
  );
  if (unsafe.length > 0) {
    throw new WorkerConfigError(
      `refusing to start: stub or unset providers in production (${unsafe.join(', ')}). ` +
        'A stub provider reports a send that never happened, and the state machine would record it ' +
        "as sent — silently destroying the user's statutory clock. Every seam must be explicitly " +
        'configured to a real adapter (ADR-005).',
    );
  }
  if (env.SCRAPER_DEV_FIXTURES === '1') {
    throw new WorkerConfigError('refusing to start: SCRAPER_DEV_FIXTURES=1 in production');
  }
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  assertStartupSafe(env);

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new WorkerConfigError('the worker requires DATABASE_URL');

  const engine = (env.SCRAPER_WORKFLOW_ENGINE ?? 'pgboss') as EngineName;
  if (!ENGINE_NAMES.includes(engine)) {
    throw new WorkerConfigError(`SCRAPER_WORKFLOW_ENGINE must be one of ${ENGINE_NAMES.join(' | ')}, got "${engine}"`);
  }

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    databaseUrl,
    engine,
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    rawResponseRetentionDays: positiveInt(env, 'RAW_RESPONSE_RETENTION_DAYS', DEFAULT_RAW_RESPONSE_RETENTION_DAYS),
    // Counsel-owned prose lives in the repo's templates/ dir (CLAUDE.md).
    templatesDir: env.TEMPLATES_DIR ?? new URL('../../../templates/', import.meta.url).pathname,
    modelRegion: env.MODEL_REGION ?? 'eu',
    maxSendsPerControllerPerHour: positiveInt(
      env,
      'GATEWAY_MAX_SENDS_PER_CONTROLLER_PER_HOUR',
      DEFAULT_MAX_SENDS_PER_CONTROLLER_PER_HOUR,
    ),
  };
}
