import { randomBytes } from 'node:crypto';
import { sha256Hex, verifyStoredObject } from '@scraper/core';
import { createObjectStore } from './resolve.js';

/**
 * `pnpm --filter @scraper/worker probe:store` — a real round trip against the configured store.
 *
 * PRE-SEND-CHECKLIST §5.2 recorded the old readiness row as a known-unverified gate: it tested that
 * `OBJECT_STORE_ENDPOINT` was a non-empty string, so setting the variable to any value turned a
 * launch gate green while changing nothing. `scripts/readiness.mjs` now performs this round trip
 * itself for the filesystem store, because that needs no network and no account. For an S3 store it
 * cannot — a probe means a signed request to a vendor with credentials a build machine does not
 * have — so readiness points the operator here instead of guessing.
 *
 * Writes, reads back, verifies the SHA-256, deletes, and confirms the object is gone. All four
 * matter: a store that cannot DELETE is a store on which CLAUDE.md §4 retention silently fails.
 */

const PROBE_KEY_PREFIX = 'readiness-probe';

export async function probeObjectStore(env: NodeJS.ProcessEnv, log: (m: string) => void): Promise<boolean> {
  let store;
  try {
    store = createObjectStore(env);
  } catch (e) {
    log(`FAIL — ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
  log(`store: ${store.name}`);

  // Random, so a probe never collides with a concurrent one and never depends on a previous run
  // having cleaned up after itself.
  const key = `${PROBE_KEY_PREFIX}/${randomBytes(8).toString('hex')}.txt`;
  const body = `scraper object-store probe ${new Date().toISOString()}\n`;
  const expected = sha256Hex(body);

  try {
    const ref = await store.put(key, body);
    log(`put   ${ref}`);

    const verdict = await verifyStoredObject(store, ref, expected);
    if (!verdict.matches) {
      log(`FAIL — read-back did not match: ${verdict.reason}`);
      return false;
    }
    log(`get   sha256 ${expected.slice(0, 16)}… matches`);

    await store.delete(ref);
    if ((await store.get(ref)) !== null) {
      log(`FAIL — the object is still readable after delete; CLAUDE.md §4 retention cannot be honoured on this store`);
      return false;
    }
    log('del   gone');
    return true;
  } catch (e) {
    log(`FAIL — ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

const isMain = process.argv[1]?.endsWith('probe.js') || process.argv[1]?.endsWith('probe.ts');
if (isMain) {
  const ok = await probeObjectStore(process.env, (m) => console.log(`[object-store] ${m}`));
  process.exitCode = ok ? 0 : 1;
}
