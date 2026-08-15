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
 * One guard is new here and belongs to this wave. `SCRAPER_TIMESTAMPER` must be a real QTSP in
 * production, because a simulated anchor is the thing that would otherwise turn a stubbed hybrid-mail
 * receipt into an Art. 12(3) deadline. `provableSendEvidenceIdOf()` already refuses it at runtime —
 * this makes the misconfiguration impossible to boot with, rather than merely harmless.
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

/** Seams that must name a real adapter before the worker may run in production. */
const REQUIRED_REAL_PROVIDERS = [
  'SCRAPER_MAILER',
  'SCRAPER_POSTAL',
  'SCRAPER_TIMESTAMPER',
  'SCRAPER_IDENTITY',
  'SCRAPER_DOC_SANDBOX',
  // The sixth seam. Neither of its values (`fs`, `s3`) is a stub — a filesystem store is the honest
  // posture-A answer — so this entry is here for the UNSET case: without a store the worker writes
  // an evidence reference to nothing, and PLAN §2 puts "object store actually holding the rendered
  // copy the evidence chain hashes" inside the first-real-send gate.
  'SCRAPER_OBJECT_STORE',
] as const;

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

  const unsafe = REQUIRED_REAL_PROVIDERS.filter((key) => !env[key] || env[key] === 'stub' || env[key] === 'simulated');
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

  // AUDIT M2: the five selectors above are validated, but until a provider factory dereferences
  // them, `main.ts` HARDWIRES stub providers regardless — so passing the check by setting the env
  // vars would still start a worker whose sends go nowhere while claiming real ones were selected.
  // Refuse outright until the wiring exists; delete this throw when the factory lands.
  throw new WorkerConfigError(
    'refusing to start: real provider adapters exist (providers/real-providers.ts) but are not yet ' +
      'wired into dispatch — this build hardwires stubs (main.ts). A deployment would accept ' +
      `${REQUIRED_REAL_PROVIDERS.join(', ')} while ignoring them.`,
  );
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
