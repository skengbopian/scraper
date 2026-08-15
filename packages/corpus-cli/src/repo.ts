import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import type { SignoffManifest } from '@scraper/core';

/**
 * Where the corpus lives on disk, and how to read it.
 *
 * This CLI is repo-rooted by design, not by accident. The corpus IS `playbooks/*.yaml`,
 * `templates/*.md` and `templates/.signoff.json` — files a node's operator can read, diff and check
 * against the published repository before deciding to trust them. Packaging it as opaque compiled
 * data would remove exactly the property that makes a self-hosted node auditable by the person
 * running it (docs/14 §5.2). A container image therefore ships those directories, plus
 * `tools/spec-audit`, whose validator this uses.
 */

export class CorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CorpusError';
  }
}

/**
 * The repository root, found by walking up for `pnpm-workspace.yaml` rather than counting `../`
 * from `dist/`. Counting breaks the moment a file moves one directory deeper, and it breaks
 * silently — into "0 playbooks found", which reads like an empty corpus rather than a wrong path.
 */
export function findRepoRoot(from: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) {
      throw new CorpusError(
        `could not locate the repository root above ${from} (no pnpm-workspace.yaml found). This CLI ` +
          'reads the corpus from playbooks/ and templates/ — run it from a checkout, or set SCRAPER_ROOT.',
      );
    }
    dir = up;
  }
}

export function repoRoot(): string {
  return process.env.SCRAPER_ROOT ? path.resolve(process.env.SCRAPER_ROOT) : findRepoRoot();
}

export interface PlaybookFile {
  readonly file: string;
  readonly slug: string;
  readonly document: Record<string, unknown>;
}

/** Every `playbooks/*.yaml`, parsed. A file that does not parse is fatal, never skipped. */
export function loadPlaybooks(root: string = repoRoot()): readonly PlaybookFile[] {
  const dir = path.join(root, 'playbooks');
  if (!fs.existsSync(dir)) throw new CorpusError(`no playbooks/ directory under ${root}`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
  return files.map((file) => {
    let document: Record<string, unknown>;
    try {
      document = YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Record<string, unknown>;
    } catch (e) {
      throw new CorpusError(`playbooks/${file} is not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
    }
    const slug = typeof document?.slug === 'string' ? document.slug : '';
    if (!slug) throw new CorpusError(`playbooks/${file} declares no slug`);
    return { file, slug, document };
  });
}

export function loadTemplate(root: string, templateName: string): string {
  const p = path.join(root, 'templates', `${templateName}.md`);
  if (!fs.existsSync(p)) throw new CorpusError(`templates/${templateName}.md does not exist`);
  return fs.readFileSync(p, 'utf8');
}

export function loadSignoffManifest(root: string = repoRoot()): SignoffManifest {
  const p = path.join(root, 'templates', '.signoff.json');
  if (!fs.existsSync(p)) {
    throw new CorpusError(
      'templates/.signoff.json is missing. It records which letters counsel has signed and the hash ' +
        'of the prose they signed; without it nothing can tell an approved letter from a draft.',
    );
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as SignoffManifest;
}

/**
 * Is this node in a development posture?
 *
 * The same ALLOW-list every other gate in this repo uses, and for the same reason: an unset,
 * "staging" or misspelled NODE_ENV is a deployment, and a deployment is where a DRAFT letter must
 * not be activatable (audit H1's lesson, applied here).
 */
export function isDevPosture(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
}

export function posture(env: NodeJS.ProcessEnv = process.env): string {
  return isDevPosture(env) ? `dev (NODE_ENV=${env.NODE_ENV})` : `DEPLOY (NODE_ENV=${env.NODE_ENV ?? 'unset'})`;
}
