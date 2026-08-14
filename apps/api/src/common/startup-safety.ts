/**
 * Boot-time posture checks for the API — the sibling of the worker's `assertStartupSafe()`
 * (apps/worker/src/config.ts). The worker refuses to boot with dev seams in production; the API
 * previously had no such gate, which is how a deny-list KEK resolver could quietly seal real
 * secrets under a source-derivable key in any deployment whose NODE_ENV was not the literal
 * "production" (audit H1). Same doctrine as `devFixturesEnabled()`: dev conveniences activate on
 * an ALLOW-list, and everything else is a deployment that must be explicitly configured.
 */

const DEV_ENVS = new Set(['development', 'test']);

export function isDevEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return DEV_ENVS.has(env.NODE_ENV ?? '');
}

export function assertApiStartupSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (isDevEnv(env)) return;

  if (env.SCRAPER_KEK_MODE !== 'env') {
    throw new Error(
      'refusing to boot: SCRAPER_KEK_MODE must be "env" outside development/test. Otherwise the dev ' +
        'KEK resolver is selected, and it derives the same key on every machine from source constants — ' +
        'a database dump would hand over every sealed secret (CLAUDE.md §4). Provision SCRAPER_KEK_USER.',
    );
  }
  if (!env.SCRAPER_CORS_ORIGINS) {
    throw new Error(
      'refusing to boot: SCRAPER_CORS_ORIGINS must name the allowed origins outside development/test. ' +
        'The built-in list is dev-shaped (localhost + the file:// "null" origin) and must never serve a deployment.',
    );
  }
}

/**
 * The CORS origin list for this boot: env-driven in deployments, dev-shaped otherwise. The literal
 * "null" origin (file://) is stripped outside development/test even if configured — an origin that
 * every sandboxed iframe can claim is not an allow-list entry.
 */
export function corsOrigins(env: NodeJS.ProcessEnv = process.env): (string | RegExp)[] {
  if (env.SCRAPER_CORS_ORIGINS) {
    const parsed = env.SCRAPER_CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
    return isDevEnv(env) ? parsed : parsed.filter((o) => o !== 'null');
  }
  return [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, 'null'];
}
