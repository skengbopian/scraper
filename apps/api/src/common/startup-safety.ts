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
  // The same allow-list doctrine applied to persistence and to time. Both of these default to the
  // dev-shaped value when unset, and both fail in a way that looks like the product working.
  if (env.SCRAPER_REPOSITORY !== 'prisma') {
    throw new Error(
      'refusing to boot: SCRAPER_REPOSITORY must be "prisma" outside development/test (got ' +
        `${env.SCRAPER_REPOSITORY ? `"${env.SCRAPER_REPOSITORY}"` : 'unset'}). The in-memory adapter is a ` +
        'process-lifetime Map: every request, evidence record and provenance entry is lost on restart, ' +
        'and an evidence chain that does not survive a deploy cannot support anything asserted to a ' +
        'controller or a DPA. AuthModule and OpsModule also mount only in prisma mode, so a deployment ' +
        'in memory mode has no sign-in, no ops queue and no delivery-proof route — the operator would ' +
        'discover this from an empty screen rather than from a boot failure. `.env.example` shipped ' +
        '`SCRAPER_REPOSITORY=memory`, so this is the posture an operator following the documented setup ' +
        'would have deployed.',
    );
  }
  if (env.SCRAPER_SCHEDULER !== 'pgboss') {
    throw new Error(
      'refusing to boot: SCRAPER_SCHEDULER must be "pgboss" outside development/test (got ' +
        `${env.SCRAPER_SCHEDULER ? `"${env.SCRAPER_SCHEDULER}"` : 'unset'}). Without it the scheduler ` +
        'provider resolves to null and `scheduleDeadline()` returns silently: requests still send, and ' +
        'NO durable timer is ever armed. Nothing then expires a provisional deadline into the ' +
        'registered-re-send chase, and nothing stops waiting for an Auslieferungsbeleg that never ' +
        "arrives — the receipt that must reach a human (CLAUDE.md §6) reaches nobody, and the user's " +
        'request waits forever on a controller that has already ignored it. A deadline product whose ' +
        'deadlines do not fire fails silently and in the direction that costs the user the right.',
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
