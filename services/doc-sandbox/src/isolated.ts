import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DocSandbox, SandboxParseResult } from '@scraper/core';
import { withSafetyEnvelope } from './index.js';

/**
 * The PROCESS-isolated Datenkopie sandbox (audit H3).
 *
 * The contract (CLAUDE.md §2, docs/06 C4) says hostile documents are parsed "in an isolated
 * service" — but the API imported the parser as a library and ran pdf.js INSIDE the NestJS process
 * that holds the PrismaClient and every user's data. The in-process hardening (no eval, page cap,
 * time budget) reduces the attack surface; it is not the backstop the contract promised. A pdf.js
 * memory-corruption bug would have executed with database credentials in reach.
 *
 * This wrapper runs each parse in a fresh child process with a SCRUBBED environment: the child can
 * crash, hang, or be exploited and still reaches nothing — no DATABASE_URL, no provider keys, no
 * shared memory. One document per process is also the strongest possible form of "one document per
 * context". The parent re-applies the safety envelope across the JSON boundary, so a compromised
 * child cannot forge a frozen result shape or an out-of-range confidence.
 */

/** Everything the child may see. An allow-list, deliberately tiny. */
export const ISOLATED_CHILD_ENV_KEYS = ['NODE_ENV', 'PATH'] as const;

export function isolatedChildEnv(parent: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const key of ISOLATED_CHILD_ENV_KEYS) {
    if (parent[key] !== undefined) child[key] = parent[key];
  }
  return child;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BYTES = 16 * 1024 * 1024;

function runnerPath(): string {
  // Compiled: dist/isolated.js sits beside dist/parse-runner.js. Under vitest the module runs from
  // src/, where only the .ts exists — fall back to the built runner (pnpm -r build produces it).
  for (const candidate of [new URL('./parse-runner.js', import.meta.url), new URL('../dist/parse-runner.js', import.meta.url)]) {
    const p = fileURLToPath(candidate);
    if (existsSync(p)) return p;
  }
  throw new Error('doc-sandbox: parse-runner.js not found — build @scraper/doc-sandbox before parsing');
}

export function createIsolatedDatenkopieSandbox(opts: { timeoutMs?: number } = {}): DocSandbox {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return withSafetyEnvelope(async (doc) => {
    const runner = runnerPath();
    const child = spawn(process.execPath, [runner, doc.id, doc.mimeType], {
      env: isolatedChildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    const stderr: Buffer[] = [];

    const outcome = await new Promise<{ code: number | null; timedOut: boolean }>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve({ code: null, timedOut: true });
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          clearTimeout(timer);
          child.kill('SIGKILL');
          reject(new Error('doc-sandbox: runner output exceeded the size budget'));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 32) stderr.push(chunk);
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, timedOut: false });
      });
      child.stdin.on('error', () => undefined); // a crashed child EPIPEs the write; close decides
      child.stdin.end(Buffer.from(doc.bytes));
    });

    if (outcome.timedOut) {
      throw new Error(`doc-sandbox: runner exceeded ${timeoutMs}ms and was killed — document refused`);
    }
    if (outcome.code !== 0) {
      throw new Error(
        `doc-sandbox: runner crashed (exit ${outcome.code ?? 'signal'}): ${Buffer.concat(stderr).toString('utf8').slice(0, 500)}`,
      );
    }

    let parsed: { ok: boolean; result?: SandboxParseResult; error?: string };
    try {
      parsed = JSON.parse(Buffer.concat(stdout).toString('utf8')) as typeof parsed;
    } catch {
      throw new Error('doc-sandbox: runner produced non-JSON output — document refused');
    }
    if (!parsed.ok || !parsed.result) {
      throw new Error(`doc-sandbox: ${parsed.error ?? 'parse refused with no reason'}`);
    }
    return {
      text: String(parsed.result.text ?? ''),
      structured: (parsed.result.structured ?? {}) as Readonly<Record<string, unknown>>,
      confidence: Number(parsed.result.confidence),
    };
  });
}
