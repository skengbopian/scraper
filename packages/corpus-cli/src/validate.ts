import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot, CorpusError } from './repo.js';

/**
 * The playbook validator — `tools/spec-audit`'s, not a second one.
 *
 * This importer writes playbooks into a real node's database. If it validated them with its own
 * rules, a corpus could pass CI and be rejected here, or — far worse — fail CI and be accepted here,
 * which would mean the gate everyone trusts is not the gate that runs. There is one validation
 * entry point in this repository and it is `validatePlaybook`; `tools/spec-audit/validator.mjs`
 * exists so the Ajv setup around it is shared too (`strict: false` and `allErrors: true` are
 * load-bearing, and two callers assembling them differently is two definitions of "valid").
 *
 * It is loaded by PATH rather than as a package because that harness is deliberately not a pnpm
 * workspace member: it must be able to run before `apps/` and `packages/` exist, and keep running if
 * they break (see its README). A dynamic import by file URL is what lets a workspace package reach
 * it without dragging it into the workspace.
 */

export type Severity = 'error' | 'warn';
export interface PlaybookProblem {
  readonly severity: Severity;
  readonly id: string;
  readonly message: string;
}
export type PlaybookValidator = (doc: unknown, opts?: Record<string, unknown>) => readonly PlaybookProblem[];

let cached: PlaybookValidator | null = null;

export async function loadValidator(root: string = repoRoot()): Promise<PlaybookValidator> {
  if (cached) return cached;
  const mod = path.join(root, 'tools', 'spec-audit', 'validator.mjs');
  let makeValidator: () => PlaybookValidator;
  try {
    // `@vite-ignore` because vitest (Vite) statically analyses dynamic imports and tries to resolve
    // this one through its own pipeline, where the file:// URL's percent-encoding — this repo lives
    // under a path with a space in it — fails to resolve. Plain Node ignores the comment. The
    // annotation is what keeps the CLI's tests exercising the SAME loader the CLI uses, rather than
    // a mock of it.
    ({ makeValidator } = (await import(/* @vite-ignore */ pathToFileURL(mod).href)) as {
      makeValidator: () => PlaybookValidator;
    });
  } catch (e) {
    throw new CorpusError(
      `could not load the playbook validator from ${mod}: ${e instanceof Error ? e.message : String(e)}. ` +
        'It ships alongside the corpus — a node that can import playbooks must be able to validate them, ' +
        'and importing them unvalidated is not an acceptable degraded mode.',
    );
  }
  cached = makeValidator();
  return cached;
}
