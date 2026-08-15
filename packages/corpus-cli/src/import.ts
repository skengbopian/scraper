import type { PrismaClient } from '@prisma/client';
import { CENSUS, controllerTypeOf } from '@scraper/api/dist/census/census.js';
import { CorpusError, loadPlaybooks, repoRoot, type PlaybookFile } from './repo.js';
import { loadValidator } from './validate.js';

/**
 * `corpus:import` — give a node its playbooks.
 *
 * Nothing in this product parsed `playbooks/*.yaml` at runtime. The API says so in its own comment
 * (`apps/api/src/common/dev-fixtures.ts`: "The API does not parse playbooks/ at runtime"), which was
 * a reasonable decision for an app that should not carry a YAML dependency for a dev fixture — but it
 * left no other route in. So on any node not running dev fixtures the `Playbook` table is EMPTY,
 * every request routes `NO_ROUTE`, and `docs/14`'s claim that activation is "a deliberate act against
 * the node's own database row" describes a psql UPDATE against a row that does not exist.
 *
 * Three rules this file exists to keep, in order of how much damage breaking them does:
 *
 * 1. **`active: false`, always, whatever the YAML says.** Import is not activation. If a playbook
 *    could arrive live, publishing a corpus would be publishing the authority to send letters, and
 *    the counsel gate would become a property of a file in someone else's repository.
 * 2. **An existing `(slug, version)` row is never mutated.** `docs/04`'s authoring rule and migration
 *    0005's `playbook_freeze` both say so: a request already sent under version N cites a document
 *    that must still mean what it meant. A changed document is a new version.
 * 3. **Re-import never touches `active`.** Rule 1 governs rows this creates. An operator who
 *    deliberately activated a playbook must not have it switched off by a routine `corpus:import` —
 *    and rule 2 gets there by not writing to existing rows at all.
 *
 * ATOMIC, in two passes. Everything is decided read-only first and nothing is written unless the whole
 * corpus is importable. A partially-imported corpus is a node that routes some requests and answers
 * `NO_ROUTE` for the rest, with no way for the operator to see which — it looks like "that controller
 * isn't supported" rather than like a failed import.
 */

export interface ImportOptions {
  readonly root?: string;
  /** Compute and report the plan; write nothing. */
  readonly dryRun?: boolean;
}

export interface SkippedPlaybook {
  readonly slug: string;
  readonly reason: string;
}

export interface ImportPlan {
  readonly controllersToCreate: readonly string[];
  readonly controllersExisting: readonly string[];
  readonly playbooksToCreate: readonly { readonly slug: string; readonly version: number }[];
  readonly playbooksUnchanged: readonly { readonly slug: string; readonly version: number }[];
  /** Not importable, and reported rather than silently absent. See `partition()`. */
  readonly skipped: readonly SkippedPlaybook[];
}

export interface ImportResult extends ImportPlan {
  readonly written: boolean;
  readonly activeAfter: number;
}

/** Stable stringify, so "did this document change?" is not answered by key order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

async function validateAll(files: readonly PlaybookFile[], root: string): Promise<void> {
  const validate = await loadValidator(root);
  const problems: string[] = [];
  for (const pb of files) {
    for (const p of validate(pb.document)) {
      if (p.severity === 'error') problems.push(`playbooks/${pb.file}: [${p.id}] ${p.message}`);
    }
  }
  if (problems.length > 0) {
    throw new CorpusError(
      `refusing to import: ${problems.length} validation error(s). Nothing was written.\n\n  ${problems.join('\n  ')}`,
    );
  }
}

/**
 * Which playbooks this node can actually hold, and why the others cannot be.
 *
 * Two kinds are skipped, and both are REPORTED on every run rather than quietly absent — the
 * difference between "16 imported, 3 skipped, here is why" and a node that mysteriously answers
 * NO_ROUTE for a controller its operator can see in the repo.
 *
 * **Stencils** (`parameterised: true`, `controller: "__PARAM__"`) are authoring artefacts, not
 * instruments. ADR-018 forbids ever activating one; a row for it would carry a foreign key to a
 * controller that does not exist and could never route. They are cloned per controller, and the clone
 * is what a node imports.
 *
 * **Playbooks whose controller the census cannot resolve.** A `Controller` row invented here would be
 * a legal addressee nobody verified (docs/07), so the importer will not create one — and a playbook
 * without a controller cannot be imported at all. Today this is `loeschung.hireright` and
 * `explanation.retorio`: both are listed in `docs/07-controllers-seed.md`, and neither is in the code
 * census (`apps/api/src/census/census.ts`), so on any real node those two are unroutable.
 * `tools/spec-audit` cannot see it — its controller-slug check reads the DOC census, not the running
 * one. This is a corpus gap for the owner, not something an importer may paper over by inventing an
 * addressee.
 *
 * A validation error or a frozen-version violation still aborts everything: those are defects in the
 * corpus itself, where importing "most of it" would be importing something known to be wrong.
 */
function partition(files: readonly PlaybookFile[]): {
  importable: readonly PlaybookFile[];
  skipped: readonly SkippedPlaybook[];
} {
  const importable: PlaybookFile[] = [];
  const skipped: SkippedPlaybook[] = [];
  for (const pb of files) {
    const controller = String(pb.document.controller ?? '');
    if (pb.document.parameterised === true || controller === '__PARAM__') {
      skipped.push({ slug: pb.slug, reason: 'parameterised stencil — clone it per controller (ADR-018); it can never be activated' });
      continue;
    }
    if (!CENSUS.some((c) => c.slug === controller)) {
      skipped.push({
        slug: pb.slug,
        reason: `controller "${controller}" is not in the census, so no verified Controller row exists to bind it to`,
      });
      continue;
    }
    importable.push(pb);
  }
  return { importable, skipped };
}

/** Read-only. Decides everything; refuses before a single row is touched. */
export async function planImport(db: PrismaClient, opts: ImportOptions = {}): Promise<ImportPlan> {
  const root = opts.root ?? repoRoot();
  const all = loadPlaybooks(root);
  if (all.length === 0) throw new CorpusError('playbooks/ contains no YAML files');
  // Validation covers the WHOLE corpus, including what will be skipped: a malformed stencil is still
  // a defect, and it is the thing clones are made from.
  await validateAll(all, root);

  const { importable: files, skipped } = partition(all);
  if (files.length === 0) {
    throw new CorpusError(
      `no importable playbooks: all ${all.length} were skipped.\n  ` +
        skipped.map((s) => `${s.slug} — ${s.reason}`).join('\n  '),
    );
  }

  // Only the controllers the corpus actually references. Importing the whole census would put rows in
  // the database for controllers no playbook can act on, which reads as capability the node does not
  // have. The census is the shared address book (docs/14 §6); this is the subset with a letter.
  const needed = [...new Set(files.map((f) => String(f.document.controller ?? '')))].sort();

  const existingControllers = new Set(
    (await db.controller.findMany({ where: { slug: { in: needed } }, select: { slug: true } })).map((c) => c.slug),
  );

  const playbooksToCreate: { slug: string; version: number }[] = [];
  const playbooksUnchanged: { slug: string; version: number }[] = [];
  const frozen: { slug: string; version: number }[] = [];

  for (const pb of files) {
    const version = Number(pb.document.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new CorpusError(
        `playbooks/${pb.file}: version must be a positive integer, got ${String(pb.document.version)}`,
      );
    }
    const existing = await db.playbook.findUnique({
      where: { slug_version: { slug: pb.slug, version } },
      select: { document: true },
    });
    if (!existing) playbooksToCreate.push({ slug: pb.slug, version });
    // Compared rather than overwritten. Prisma would happily UPDATE and `playbook_freeze` would
    // reject it at the database — but a refusal naming the slug beats an exception about a trigger,
    // and the equal case has to be a silent no-op or `corpus:import` stops being re-runnable.
    else if (canonical(existing.document) === canonical(pb.document)) playbooksUnchanged.push({ slug: pb.slug, version });
    else frozen.push({ slug: pb.slug, version });
  }

  if (frozen.length > 0) {
    throw new CorpusError(
      `refusing to import: ${frozen.length} playbook(s) already exist at the same version with a DIFFERENT ` +
        'document, and NOTHING was written:\n  ' +
        frozen.map((p) => `${p.slug} v${p.version}`).join('\n  ') +
        '\n\nA shipped version is immutable (docs/04; migration 0005 `playbook_freeze`): a request already ' +
        'sent under that version cites a document that must still mean what it meant. Bump the version ' +
        'instead — `npm run seal` in tools/spec-audit records the new one.',
    );
  }

  return {
    controllersToCreate: needed.filter((s) => !existingControllers.has(s)),
    controllersExisting: needed.filter((s) => existingControllers.has(s)),
    playbooksToCreate,
    playbooksUnchanged,
    skipped,
  };
}

export async function importCorpus(db: PrismaClient, opts: ImportOptions = {}): Promise<ImportResult> {
  const root = opts.root ?? repoRoot();
  const plan = await planImport(db, opts);
  if (opts.dryRun) {
    return { ...plan, written: false, activeAfter: await db.playbook.count({ where: { active: true } }) };
  }

  const files = loadPlaybooks(root);
  const byKey = new Map(files.map((f) => [`${f.slug}|${Number(f.document.version)}`, f]));

  await db.$transaction(async (tx) => {
    for (const slug of [...plan.controllersToCreate, ...plan.controllersExisting]) {
      const entry = CENSUS.find((c) => c.slug === slug)!;
      await tx.controller.upsert({
        where: { slug },
        create: { id: entry.id, slug: entry.slug, legalName: entry.name, type: controllerTypeOf(entry) ?? 'OTHER' },
        update: { legalName: entry.name, type: controllerTypeOf(entry) ?? 'OTHER' },
      });
    }
    for (const { slug, version } of plan.playbooksToCreate) {
      const pb = byKey.get(`${slug}|${version}`)!;
      const controller = await tx.controller.findUniqueOrThrow({
        where: { slug: String(pb.document.controller) },
        select: { id: true },
      });
      await tx.playbook.create({
        data: {
          controllerId: controller.id,
          slug,
          requestType: String(pb.document.requestType) as never,
          version,
          // NOT `pb.document.active`. Import is not activation — rule 1 in this file's header.
          active: false,
          document: pb.document as never,
        },
      });
    }
  });

  return { ...plan, written: true, activeAfter: await db.playbook.count({ where: { active: true } }) };
}
