import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { ObjectStore } from '@scraper/core';
import { FilesystemObjectStore } from './fs.js';
import { S3ObjectStore } from './s3.js';

/**
 * `SCRAPER_OBJECT_STORE` → an adapter. The sixth provider seam.
 *
 * It is a seam and not a derived setting (e.g. "S3 if OBJECT_STORE_ENDPOINT is set, else disk")
 * for the reason `config.ts` states about the other five: an unset selector that falls back to
 * something is how a deployment ends up quietly not doing what its environment says. Both values
 * name a REAL store — a filesystem store is not a stub, it is the honest posture-A answer — so
 * there is no "stub" value here to refuse.
 */

export const OBJECT_STORE_NAMES = ['fs', 's3'] as const;
export type ObjectStoreName = (typeof OBJECT_STORE_NAMES)[number];

export class ObjectStoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectStoreConfigError';
  }
}

function isDevOrTest(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

export function createObjectStore(env: NodeJS.ProcessEnv): ObjectStore {
  const selected = env.SCRAPER_OBJECT_STORE;
  if (!selected) {
    throw new ObjectStoreConfigError(
      `SCRAPER_OBJECT_STORE must be one of ${OBJECT_STORE_NAMES.join(' | ')}. Without a store, every ` +
        'evidence artefact is a hash of a document nobody has — the chain verifies and the letter we ' +
        'would have to produce at a DPA exists nowhere (CLAUDE.md §6).',
    );
  }
  if (!(OBJECT_STORE_NAMES as readonly string[]).includes(selected)) {
    throw new ObjectStoreConfigError(`SCRAPER_OBJECT_STORE must be one of ${OBJECT_STORE_NAMES.join(' | ')}, got "${selected}"`);
  }

  if (selected === 'fs') {
    const configured = env.OBJECT_STORE_FS_ROOT;
    if (!configured) throw new ObjectStoreConfigError('SCRAPER_OBJECT_STORE=fs requires OBJECT_STORE_FS_ROOT');
    // A relative root resolves against whatever directory the process was started in, which for a
    // systemd unit or a container is not the directory the operator was thinking of. Allow it in
    // development so `./.data/objects` works from a checkout; refuse it anywhere else. Allow-list,
    // as everywhere else in this file's neighbourhood.
    if (!isAbsolute(configured) && !isDevOrTest(env)) {
      throw new ObjectStoreConfigError(
        `OBJECT_STORE_FS_ROOT must be an absolute path outside development (got ${JSON.stringify(configured)}) — ` +
          'a relative root resolves against the process working directory, so the evidence would land ' +
          'somewhere nobody chose.',
      );
    }
    return new FilesystemObjectStore(resolvePath(configured));
  }

  return new S3ObjectStore({
    endpoint: env.OBJECT_STORE_ENDPOINT ?? '',
    bucket: env.OBJECT_STORE_BUCKET ?? '',
    region: env.OBJECT_STORE_REGION ?? '',
    accessKeyId: env.OBJECT_STORE_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.OBJECT_STORE_SECRET_ACCESS_KEY ?? '',
  });
}
