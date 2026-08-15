import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  deriveSubject,
  isSigned,
  renderRequest,
  type Playbook,
  type SignoffManifest,
  type VerifiedIdentity,
} from '@scraper/core';
import { attestationText } from './attestation.js';
import { CorpusError, isDevPosture, loadSignoffManifest, loadTemplate, posture, repoRoot } from './repo.js';

/**
 * `corpus:activate` / `corpus:deactivate` — the deliberate human act, with a record of it.
 *
 * `docs/14` §5.2: activation is "a deliberate act against the node's own DATABASE row, never the
 * YAML; on posture A the human taking responsibility is the user". Two things follow, and neither was
 * true before this file:
 *
 * **The operator has to be shown what they are authorising.** Not a slug, not a summary — the actual
 * rendered letter, the company it goes to, the venue a complaint would be filed at, and whether a
 * lawyer has approved the wording. "Deliberate" cannot mean anything else. So the preview renders the
 * real letter through the real engine before the confirmation is asked for.
 *
 * **The act has to leave a trace.** `Playbook.active` is a boolean: it records the RESULT of a
 * decision and nothing about the decision. `CorpusActivation` (migration 0019) records who, when,
 * shown which letter, with the bound template sealed or not — the answer to a controller or an
 * authority asking why a letter went out in someone's name.
 */

const DUMMY_ID = 'PREVIEW — not a real person';

/**
 * The subject the preview renders against.
 *
 * Constructed through `deriveSubject()` like every other subject in this product, never assembled by
 * hand: `RequestSubject` is unconstructible outside that function by design (ADR-009/019), and a CLI
 * that reached around it would be the first place in the codebase where a request subject came from
 * somewhere other than a verified identity record. The values are visibly fake so a preview can never
 * be mistaken for a letter about a real person.
 */
function previewSubject(now: Date) {
  const identity: VerifiedIdentity = {
    id: DUMMY_ID,
    userId: DUMMY_ID,
    status: 'VERIFIED',
    method: 'EID',
    providerRef: null,
    verifiedAt: now,
    legalName: 'VORSCHAU Erika Musterfrau',
    dateOfBirth: new Date('1970-01-01T00:00:00Z'),
    addresses: [
      { street: 'VORSCHAU Musterstraße 1', postalCode: '00000', city: 'Musterstadt', country: 'DE', current: true, verifiedAt: now },
    ],
  };
  return deriveSubject(identity);
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export interface PlaybookRow {
  readonly id: string;
  readonly slug: string;
  readonly version: number;
  readonly active: boolean;
  /**
   * From the COLUMN, never from `document.requestType`.
   *
   * The two agree for anything the importer wrote — it sets the column from the document — but the
   * kill switch has to work on a row whose document is unusable, and reading the type out of a
   * malformed document made `corpus:deactivate` fail on the ledger insert with "Invalid value for
   * argument requestType". A command that stops something must not depend on that thing being
   * well-formed.
   */
  readonly requestType: string;
  readonly document: Playbook;
  readonly controllerSlug: string;
  readonly controllerName: string;
}

async function loadRow(db: PrismaClient, slug: string): Promise<PlaybookRow> {
  const rows = await db.playbook.findMany({
    where: { slug },
    orderBy: { version: 'desc' },
    select: {
      id: true, slug: true, version: true, active: true, document: true, requestType: true,
      controller: { select: { slug: true, legalName: true } },
    },
  });
  if (rows.length === 0) {
    throw new CorpusError(
      `no playbook "${slug}" in this node's database. Run \`corpus:import\` first — the corpus in ` +
        'playbooks/ is files on disk until a node imports it.',
    );
  }
  const row = rows[0]!;
  return {
    id: row.id,
    slug: row.slug,
    version: row.version,
    active: row.active,
    requestType: String(row.requestType),
    document: row.document as unknown as Playbook,
    controllerSlug: row.controller.slug,
    controllerName: row.controller.legalName,
  };
}

export interface Preview {
  readonly row: PlaybookRow;
  readonly letter: string;
  readonly letterSha256: string;
  readonly templateName: string;
  readonly templateStatus: string;
  readonly templateSha256: string;
  readonly templateSigned: boolean;
  readonly venue: string;
  readonly escalatesOn: string;
  readonly attestation: string;
}

function venueOf(pb: Playbook): string {
  const doc = pb as unknown as Record<string, unknown>;
  if (typeof doc.seatDpa === 'string') return `seatDpa: ${doc.seatDpa}`;
  if (doc.venue === 'USER_RESIDENCE') return "venue: USER_RESIDENCE — the user's own Land-DPA";
  if (typeof doc.venue === 'string') return `venue: ${doc.venue}`;
  return 'none declared';
}

function escalatesOn(pb: Playbook): string {
  const e = (pb as unknown as { escalation?: Record<string, string> }).escalation ?? {};
  const on = Object.entries(e)
    .filter(([, v]) => v && v !== 'NONE')
    .map(([k]) => k.replace(/^on/, '').replace(/([A-Z])/g, (m) => ` ${m.toLowerCase()}`).trim());
  return on.length ? on.join(', ') : 'nothing — this playbook cannot reach an Art. 77 draft';
}

/**
 * Render everything the operator must see. Read-only, and safe to run on anything.
 *
 * The playbook is previewed with `active: true` in a LOCAL COPY, because `renderRequest()` refuses an
 * inactive playbook — correctly, since that refusal is the counsel gate at dispatch. The alternative
 * would be activate-then-look, which is exactly backwards: the whole purpose of this command is to
 * see the letter BEFORE authorising it. The copy exists for the length of this function, is never
 * written, and cannot reach a channel — nothing here can send.
 */
export function preview(row: PlaybookRow, manifest: SignoffManifest, root: string, now: Date): Preview {
  const templateName = String((row.document as unknown as { template?: string }).template ?? '');
  if (!templateName) throw new CorpusError(`${row.slug} v${row.version} binds no template`);
  const file = `${templateName}.md`;
  const entry = manifest[file];
  if (!entry) {
    throw new CorpusError(
      `templates/${file} has no entry in templates/.signoff.json, so nothing records whether its ` +
        'wording was approved or what was approved. Re-seal the templates before activating anything.',
    );
  }

  const templateBody = loadTemplate(root, templateName);
  const rendered = renderRequest({
    playbook: { ...row.document, active: true } as Playbook,
    templateBody,
    subject: previewSubject(now),
    attachedIdentityPacketId: null,
    now,
  });

  const templateSigned = isSigned(manifest, file);
  return {
    row,
    letter: rendered.text,
    letterSha256: sha256(rendered.text),
    templateName: file,
    templateStatus: entry.status,
    templateSha256: entry.sha256_stripped,
    templateSigned,
    venue: venueOf(row.document),
    escalatesOn: escalatesOn(row.document),
    attestation: attestationText({
      playbookSlug: row.slug,
      controllerName: row.controllerName,
      requestType: row.requestType,
      templateName: file,
      templateSigned,
    }),
  };
}

export interface ActivateOptions {
  readonly root?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Who is doing this. Recorded verbatim. */
  readonly actor: string;
  /** Dev posture only: proceed although the bound template is not counsel-signed. */
  readonly allowDraft?: boolean;
  /** Asks the human to retype the slug. Returns exactly what they typed. */
  readonly confirm: (prompt: string) => Promise<string>;
  /** Where the preview and the attestation are shown. */
  readonly write?: (line: string) => void;
  readonly now?: Date;
}

export interface ActivationOutcome {
  readonly slug: string;
  readonly version: number;
  readonly action: 'ACTIVATED' | 'DEACTIVATED';
  readonly activationId: string;
}

function line(w: (s: string) => void, s = ''): void {
  w(s);
}

export async function activate(db: PrismaClient, slug: string, opts: ActivateOptions): Promise<ActivationOutcome> {
  const root = opts.root ?? repoRoot();
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const w = opts.write ?? ((s: string) => process.stdout.write(`${s}\n`));

  const row = await loadRow(db, slug);
  if (row.active) throw new CorpusError(`${row.slug} v${row.version} is already active on this node. Nothing to do.`);

  // A stencil is a template for cloning, not an instrument. `renderRequest` refuses one too; catching
  // it here means the operator gets the reason rather than an exception from three layers down.
  if ((row.document as unknown as { parameterised?: boolean }).parameterised === true) {
    throw new CorpusError(
      `${row.slug} is a parameterised stencil (ADR-018) and may never be activated. Clone it for a ` +
        'specific controller, fill in the placeholders, and activate the clone.',
    );
  }

  // `playbook_one_active` (0005) permits one active row per (controller, requestType). Swapping one
  // live playbook for another is a SUBSTITUTION, and it is two deliberate acts with two ledger
  // entries — not a silent stand-down buried inside "activate".
  const incumbent = await db.playbook.findFirst({
    where: { active: true, requestType: row.requestType as never, controller: { slug: row.controllerSlug } },
    select: { slug: true, version: true },
  });
  if (incumbent) {
    throw new CorpusError(
      `${incumbent.slug} v${incumbent.version} is already active for ${row.controllerSlug} / ` +
        `${row.requestType}. Deactivate it first ` +
        '(`corpus:deactivate`) — replacing one live letter with another is two decisions, and the ledger ' +
        'should show both.',
    );
  }

  const manifest = loadSignoffManifest(root);
  const p = preview(row, manifest, root, now);
  const dev = isDevPosture(env);

  if (!p.templateSigned) {
    if (!dev) {
      throw new CorpusError(
        `refusing to activate ${row.slug}: its letter (templates/${p.templateName}) is ${p.templateStatus}, ` +
          'not SIGNED. Outside development this is the counsel gate — a real letter to a real company ' +
          'in a real person\'s name goes out only over wording a lawyer has approved. ' +
          '`--allow-draft` exists for development and is refused here.',
      );
    }
    if (!opts.allowDraft) {
      throw new CorpusError(
        `${row.slug}'s letter (templates/${p.templateName}) is ${p.templateStatus}, not SIGNED. This is a ` +
          'dev posture, so activation is possible — pass `--allow-draft` to say so explicitly.',
      );
    }
  }

  line(w);
  line(w, `  ACTIVATE  ${row.slug}  v${row.version}`);
  line(w, `  ${'─'.repeat(76)}`);
  line(w, `  Controller      ${row.controllerName}  (${row.controllerSlug})`);
  line(w, `  Request type    ${row.requestType}`);
  line(w, `  Template        templates/${p.templateName}`);
  line(w, `  Seal            ${p.templateStatus}  ${p.templateSha256.slice(0, 16)}…`);
  line(w, `  Art. 77 venue   ${p.venue}`);
  line(w, `  Escalates on    ${p.escalatesOn}`);
  line(w, `  Node posture    ${posture(env)}`);
  line(w);
  line(w, `  THE LETTER THIS SENDS (rendered against a dummy subject):`);
  line(w, `  ${'─'.repeat(76)}`);
  for (const l of p.letter.split('\n')) line(w, `  │ ${l}`);
  line(w, `  ${'─'.repeat(76)}`);
  line(w);
  if (!p.templateSigned) {
    line(w, `  ⚠  This letter is a DRAFT. No lawyer has approved this wording.`);
    line(w);
  }
  for (const l of p.attestation.split('\n')) line(w, `  ${l}`);
  line(w);

  const typed = (await opts.confirm(`  Retype the slug to confirm (${row.slug}), or anything else to abort: `)).trim();
  if (typed !== row.slug) {
    throw new CorpusError(`aborted — you typed "${typed}", not "${row.slug}". Nothing was changed.`);
  }

  const activation = await db.$transaction(async (tx) => {
    const rec = await tx.corpusActivation.create({
      data: {
        playbookSlug: row.slug,
        playbookVersion: row.version,
        action: 'ACTIVATED',
        controllerSlug: row.controllerSlug,
        requestType: row.requestType as never,
        templateName: p.templateName,
        templateStatus: p.templateStatus,
        templateSha256: p.templateSha256,
        letterSha256: p.letterSha256,
        actor: opts.actor,
        attestation: p.attestation,
        attestationSha256: sha256(p.attestation),
        posture: posture(env),
      },
      select: { id: true },
    });
    // The ledger row is written FIRST and in the same transaction. If the flip fails, both roll back;
    // what must never happen is a live playbook with no record of who made it live.
    await tx.playbook.update({ where: { id: row.id }, data: { active: true } });
    return rec;
  });

  line(w, `  ✓ ${row.slug} v${row.version} is ACTIVE on this node.`);
  line(w, `    Recorded as activation ${activation.id} by ${opts.actor}.`);
  line(w);
  return { slug: row.slug, version: row.version, action: 'ACTIVATED', activationId: activation.id };
}

export interface DeactivateOptions {
  readonly root?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly actor: string;
  readonly reason?: string;
  readonly write?: (line: string) => void;
  readonly now?: Date;
}

/**
 * The kill switch.
 *
 * Deliberately asymmetric with `activate`: no preview, no retyped slug, no seal check, and it must
 * work when everything else is broken. Turning a playbook OFF has to succeed in exactly the
 * circumstances where turning it on would rightly fail — a missing template, a broken seal, a
 * document that no longer renders. A confirmation prompt on a kill switch is an obstacle between a
 * person and stopping something they have decided must stop.
 *
 * It still writes a ledger row, because "when did this stop being live" is as much a question as when
 * it started. The letter hash is best-effort: if the preview cannot render, the row records null
 * rather than the command failing.
 */
export async function deactivate(db: PrismaClient, slug: string, opts: DeactivateOptions): Promise<ActivationOutcome> {
  const root = opts.root ?? repoRoot();
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const w = opts.write ?? ((s: string) => process.stdout.write(`${s}\n`));

  const row = await loadRow(db, slug);
  if (!row.active) throw new CorpusError(`${row.slug} v${row.version} is not active on this node. Nothing to do.`);

  // Best effort, and failure is not fatal — see this function's header.
  let letterSha256: string | null = null;
  let templateName = String((row.document as unknown as { template?: string }).template ?? 'unknown');
  let templateStatus = 'unknown';
  let templateSha256 = '';
  try {
    const manifest = loadSignoffManifest(root);
    const p = preview(row, manifest, root, now);
    letterSha256 = p.letterSha256;
    templateName = p.templateName;
    templateStatus = p.templateStatus;
    templateSha256 = p.templateSha256;
  } catch {
    letterSha256 = null;
  }

  const attestation = [
    `Ich schalte dieses Schreiben auf meinem Knoten wieder ab.`,
    ``,
    `- Freischaltung beendet: ${row.slug} (v${row.version})`,
    `- Ab sofort wird dieser Brief nicht mehr verschickt.`,
    ...(opts.reason ? [`- Grund: ${opts.reason}`] : []),
  ].join('\n');

  const activation = await db.$transaction(async (tx) => {
    const rec = await tx.corpusActivation.create({
      data: {
        playbookSlug: row.slug,
        playbookVersion: row.version,
        action: 'DEACTIVATED',
        controllerSlug: row.controllerSlug,
        requestType: row.requestType as never,
        templateName,
        templateStatus,
        templateSha256,
        letterSha256,
        actor: opts.actor,
        attestation,
        attestationSha256: sha256(attestation),
        posture: posture(env),
      },
      select: { id: true },
    });
    await tx.playbook.update({ where: { id: row.id }, data: { active: false } });
    return rec;
  });

  line(w, `  ✓ ${row.slug} v${row.version} is no longer active. Recorded as ${activation.id} by ${opts.actor}.`);
  return { slug: row.slug, version: row.version, action: 'DEACTIVATED', activationId: activation.id };
}
