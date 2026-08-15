import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { assertSafeObjectKey, parseObjectRef, sha256Hex, type ObjectStore } from '@scraper/core';

/**
 * The filesystem object store — posture A's honest default (docs/14 §1).
 *
 * A self-hosting individual has no S3 account and should not need one. Their disk is EU-resident by
 * construction, it is theirs, and it is the one storage medium whose residency the operator can
 * actually attest to. Nothing about the evidence chain requires a vendor: it requires that the bytes
 * we hashed are still retrievable and still destroyable.
 *
 * REFERENCE FORMAT: `fs://<key>` — the key, not the absolute path. An absolute path in the database
 * would break the moment the operator moved the data directory or ran the node in a container, and
 * would leak the host layout into evidence rows that may be exported to counsel.
 *
 * The root itself is deliberately not part of the reference. There is exactly one filesystem store
 * per node, so "which root" is answered by configuration, not by the row.
 */
export class FilesystemObjectStore implements ObjectStore {
  readonly name: string;

  constructor(private readonly root: string) {
    if (!isAbsolute(root)) {
      throw new Error(`OBJECT_STORE_FS_ROOT must be an absolute path, got ${JSON.stringify(root)} — a relative root resolves against whatever directory the process happened to start in`);
    }
    this.name = `fs(${root})`;
  }

  owns(ref: string): boolean {
    return parseObjectRef(ref)?.scheme === 'fs';
  }

  async put(key: string, bytes: Uint8Array | string): Promise<string> {
    assertSafeObjectKey(key);
    const target = this.pathFor(key);
    const content = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;

    const existing = await this.readIfPresent(target);
    if (existing !== null) {
      // Idempotent re-put after a crash between the write and the evidence row: fine. A DIFFERENT
      // body under an anchored key is not — the chain would still verify while the artefact it
      // describes had been replaced. See the ObjectStore contract in @scraper/core.
      if (sha256Hex(existing) === sha256Hex(content)) return `fs://${key}`;
      throw new Error(
        `refusing to overwrite ${key}: an object already exists there with different bytes ` +
          `(stored ${sha256Hex(existing).slice(0, 12)}…, offered ${sha256Hex(content).slice(0, 12)}…). ` +
          'Evidence artefacts are write-once — the chain hashes what was sent.',
      );
    }

    await mkdir(dirname(target), { recursive: true });
    // Write-then-rename. A crash mid-write must not leave a truncated file where an evidence
    // artefact is supposed to be: a half-written letter would hash to something the chain does not
    // claim, and the failure would look like tampering rather than like a power cut.
    const tmp = `${target}.${process.pid}.${sha256Hex(content).slice(0, 8)}.part`;
    await writeFile(tmp, content, { mode: 0o600 });
    await rename(tmp, target);
    return `fs://${key}`;
  }

  async get(ref: string): Promise<Uint8Array | null> {
    return this.readIfPresent(this.pathForRef(ref));
  }

  async delete(ref: string): Promise<void> {
    // `force` makes an absent file a success, which is what the purge sweep needs: it may re-run
    // after a crash between the delete and the tombstone.
    await rm(this.pathForRef(ref), { force: true });
  }

  private pathForRef(ref: string): string {
    const parsed = parseObjectRef(ref);
    if (parsed?.scheme !== 'fs') {
      throw new Error(`${this.name} does not own the reference ${ref} — it is not an fs:// reference`);
    }
    return this.pathFor(parsed.rest);
  }

  /**
   * Key → absolute path, with the containment check repeated after resolution.
   *
   * `assertSafeObjectKey` already makes traversal unrepresentable, so this second check is
   * redundant — and it stays, because it is the one that holds if the key validator is ever
   * loosened. Two independent checks on the path that writes attacker-influenced filenames is the
   * right number.
   */
  private pathFor(key: string): string {
    assertSafeObjectKey(key);
    const target = resolve(join(this.root, key));
    const rootPrefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    if (!target.startsWith(rootPrefix)) {
      throw new Error(`refusing ${key}: it resolves to ${target}, outside the object store root ${this.root}`);
    }
    return target;
  }

  private async readIfPresent(target: string): Promise<Uint8Array | null> {
    try {
      await access(target, constants.F_OK);
    } catch {
      return null;
    }
    return new Uint8Array(await readFile(target));
  }
}
