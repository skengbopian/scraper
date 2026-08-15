import readline from 'node:readline/promises';
import { PrismaClient } from '@prisma/client';
import { activate, deactivate } from './activate.js';
import { importCorpus } from './import.js';
import { CorpusError, posture, repoRoot } from './repo.js';

/**
 * The corpus CLI. Needs only `DATABASE_URL` — no KEK, no CORS list, no provider seams: it reads the
 * repo and writes two tables, and an operator standing a node up must be able to give it a corpus
 * before the rest of the environment exists.
 *
 * There is deliberately NO HTTP equivalent of any of this, for the same reason `grant-ops` has none:
 * a route that activates a playbook is a route that authorises outbound legal letters, reachable by
 * whoever reaches the web server. This needs the database credential and a terminal.
 */

const USAGE = `usage:
  corpus:import [--dry-run]              import playbooks/*.yaml — always inactive
  corpus:activate <slug> [--allow-draft] show the letter, take responsibility, flip one row
  corpus:deactivate <slug> [--reason …]  the kill switch
  corpus:status                          what this node has, and what is live

  --actor <name>   who is doing this (recorded in the activation ledger).
                   Defaults to $SCRAPER_ACTOR, then $USER.

Requires DATABASE_URL. Run \`corpus:import\` before \`corpus:activate\` — the corpus is files on
disk until a node imports it.`;

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}

/**
 * Ask one question on stdin.
 *
 * The interface is created HERE, at the moment of the question, and not once around the whole
 * command. Created early it starts consuming stdin immediately, and against a pipe
 * (`printf 'slug\n' | corpus:activate …`) it reaches EOF and closes while the preview is still being
 * rendered — so the confirmation rejected with "readline was closed" and no activation was possible
 * from a script. Interactive use never showed it, because a TTY does not end.
 *
 * Piped confirmation has to work: an operator standing a node up from a setup script is confirming
 * just as deliberately as one typing, and a ceremony that only functions in a terminal is a ceremony
 * people work around.
 */
async function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function status(db: PrismaClient): Promise<void> {
  const rows = await db.playbook.findMany({
    orderBy: [{ slug: 'asc' }, { version: 'asc' }],
    select: { slug: true, version: true, active: true, controller: { select: { slug: true } } },
  });
  const log = (s: string) => process.stdout.write(`${s}\n`);
  log('');
  log(`  ${rows.length} playbook row(s) · ${rows.filter((r) => r.active).length} active · posture: ${posture()}`);
  log(`  corpus on disk: ${repoRoot()}/playbooks`);
  log('');
  if (rows.length === 0) {
    log('  This node has NO corpus. Every request will route NO_ROUTE until `corpus:import` runs.');
    log('');
    return;
  }
  for (const r of rows) log(`  ${r.active ? '● ACTIVE ' : '  ·      '} ${r.slug.padEnd(36)} v${r.version}  ${r.controller.slug}`);
  log('');
  const recent = await db.corpusActivation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { action: true, playbookSlug: true, playbookVersion: true, actor: true, createdAt: true },
  });
  if (recent.length > 0) {
    log('  most recent activation-ledger entries:');
    for (const a of recent) {
      log(`    ${a.createdAt.toISOString()}  ${a.action.padEnd(11)} ${a.playbookSlug} v${a.playbookVersion}  by ${a.actor}`);
    }
    log('');
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (!process.env.DATABASE_URL) throw new CorpusError('DATABASE_URL is required');

  const actor = flag(argv, 'actor') ?? process.env.SCRAPER_ACTOR ?? process.env.USER ?? '';
  const db = new PrismaClient();
  try {
    switch (command) {
      case 'import': {
        const r = await importCorpus(db, { dryRun: argv.includes('--dry-run') });
        const log = (s: string) => process.stdout.write(`${s}\n`);
        log('');
        log(`  ${r.written ? 'imported' : 'DRY RUN — nothing written'}`);
        log(`    controllers  ${r.controllersToCreate.length} new, ${r.controllersExisting.length} already present`);
        log(`    playbooks    ${r.playbooksToCreate.length} new, ${r.playbooksUnchanged.length} unchanged`);
        for (const p of r.playbooksToCreate) log(`      + ${p.slug} v${p.version}`);
        if (r.skipped.length > 0) {
          log('');
          log(`    ${r.skipped.length} NOT imported — this node cannot act on these:`);
          for (const s of r.skipped) log(`      · ${s.slug}`.padEnd(46) + `${s.reason}`);
        }
        log('');
        log(`  ${r.activeAfter} playbook(s) active. Import never activates anything — run \`corpus:activate <slug>\`.`);
        log('');
        break;
      }
      case 'activate': {
        const slug = argv[1];
        if (!slug || slug.startsWith('--')) throw new CorpusError(`activate needs a slug\n\n${USAGE}`);
        if (!actor) throw new CorpusError('who is doing this? Pass --actor <name> or set SCRAPER_ACTOR.');
        await activate(db, slug, {
          actor,
          allowDraft: argv.includes('--allow-draft'),
          confirm: ask,
        });
        break;
      }
      case 'deactivate': {
        const slug = argv[1];
        if (!slug || slug.startsWith('--')) throw new CorpusError(`deactivate needs a slug\n\n${USAGE}`);
        if (!actor) throw new CorpusError('who is doing this? Pass --actor <name> or set SCRAPER_ACTOR.');
        await deactivate(db, slug, { actor, reason: flag(argv, 'reason') });
        break;
      }
      case 'status':
        await status(db);
        break;
      default:
        throw new CorpusError(`unknown command "${command}"\n\n${USAGE}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`\ncorpus: ${e instanceof Error ? e.message : String(e)}\n\n`);
  process.exitCode = 1;
});
