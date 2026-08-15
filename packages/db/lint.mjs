// `pnpm -r lint` for a package that contains no TypeScript.
//
// This package is a Prisma schema and a migration chain — no `src/`, and never had one. Its lint
// script was nonetheless `tsc -p tsconfig.json --noEmit`, which failed with TS18003 ("no inputs were
// found") on every run. `pnpm -r lint` therefore exited non-zero for everyone, always, which is why
// no workflow ran it: a task that is red by construction cannot gate anything, and the cost is not
// the missing check but every real lint failure in the other seven packages that nobody would ever
// have seen.
//
// What a schema package can usefully lint is the schema. `prisma validate` parses it and checks
// relations, attributes and referential actions — the things a hand-edited schema gets wrong, and
// the things whose breakage shows up as a confusing generate failure three commands later.
//
// It needs DATABASE_URL only to RESOLVE `env("DATABASE_URL")` in the datasource block; it never
// connects. So an unset variable gets a syntactically valid placeholder here rather than making the
// lint depend on having a database — a lint that requires infrastructure is the previous failure
// wearing a different hat.
//
// `prisma format --check` is deliberately NOT run. It currently fails, and satisfying it means
// reformatting a schema whose comments are load-bearing documentation. That is a real change with a
// real diff to review, not housekeeping to smuggle into a lint script.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
env.DATABASE_URL ||= 'postgresql://lint:lint@localhost:5432/lint';

// The workspace-local binary, not `npx`: npx under `pnpm -r` emits an npmrc warning on every run,
// and in CI it is one more thing that can decide to resolve something from the network.
const prisma = path.join(here, 'node_modules', '.bin', 'prisma');

try {
  execFileSync(prisma, ['validate'], { cwd: here, env, stdio: 'inherit' });
} catch {
  process.exitCode = 1;
}
