import { createHash } from 'node:crypto';
import { stripDocComment } from './render.js';

/**
 * The template seal — binding a counsel signature to PROSE rather than to a filename.
 *
 * `docs/04` says legal wording lives only in `templates/` and is counsel-reviewed, and
 * `ARCHITECTURE-DECISIONS.md` §4 makes template sign-off a precondition for activating any playbook.
 * Neither was enforceable: no template body was hashed anywhere, the worker resolves the letter by
 * FILENAME at dispatch, and the doc-comment header carrying the word DRAFT is stripped before
 * rendering. So editing a signed template changed what a sealed playbook sends, with every existing
 * seal — the playbook version lock included — still green. `playbooks/.shipped.json` protects the
 * playbook document; nothing protected the letter it names.
 *
 * `templates/.signoff.json` closes that: one entry per template, carrying the hash of the exact bytes
 * the worker renders, plus who signed it and when.
 *
 * WHAT IS HASHED, and why it is not the whole file. `sealHash` hashes the body AFTER
 * `stripDocComment` — the same transform `render()` applies first, so the seal covers precisely the
 * letter and nothing else. The header is documentation for engineers: correcting a typo in it must
 * not invalidate counsel's signature on prose that did not change, or the seal becomes something
 * people route around. The DRAFT marker lives in that header and is therefore OUTSIDE the hash,
 * which is why `verifySignoff` cross-checks the marker against `status` separately — otherwise
 * deleting the word DRAFT would be an unsealed edit to the one line that announces the letter is not
 * approved.
 *
 * This module is pure and does no I/O: `tools/spec-audit/signoff-check.mjs` reads the files and gates
 * CI, `corpus:activate` refuses to activate a playbook whose bound template is not SIGNED, and
 * dispatch refuses to render one. All three ask the same questions of the same shape.
 */

export type SignoffStatus = 'DRAFT' | 'SIGNED';

export interface SignoffEntry {
  readonly status: SignoffStatus;
  /** Hex SHA-256 of the body after `stripDocComment` — the exact bytes the worker renders. */
  readonly sha256_stripped: string;
  /** Who signed. Non-null iff SIGNED — a signature with no signatory is not one. */
  readonly counsel: string | null;
  /** ISO-8601 date of signature. Non-null iff SIGNED. */
  readonly signedAt: string | null;
}

/** `templates/.signoff.json`: filename (e.g. `art21-werbewiderspruch.de.md`) → entry. */
export type SignoffManifest = Readonly<Record<string, SignoffEntry>>;

/** A template as it exists on disk, for verification. */
export interface TemplateFile {
  /** Basename with extension, matching the manifest key. */
  readonly name: string;
  readonly body: string;
}

export function sealHash(body: string): string {
  return createHash('sha256').update(stripDocComment(body), 'utf8').digest('hex');
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;
/** The header marker every unapproved template carries. Matched on a word boundary, as readiness does. */
const DRAFT_MARKER = /\bDRAFT\b/;

export interface SignoffProblem {
  readonly template: string;
  readonly message: string;
}

/**
 * Verify a manifest against the templates on disk. Returns every problem found — callers decide
 * whether that is a failed build, a refused activation, or a refused dispatch.
 *
 * Six ways this can be wrong, and each is a different way for a signature to stop meaning anything:
 *
 *   missing entry   — a template nothing has ever signed off, silently renderable.
 *   orphan entry    — a signature for a file that no longer exists; the next file to take that name
 *                     inherits it.
 *   hash drift      — the prose changed after signature. THE defect this file exists for.
 *   bad status      — anything but DRAFT or SIGNED; an unknown status is not a permission.
 *   unsigned SIGNED — status SIGNED with no counsel or no date. A signature nobody put their name to.
 *   marker conflict — SIGNED while the header still says DRAFT, or DRAFT with the marker deleted.
 *                     The header is outside the hash, so this is the only thing checking it.
 */
export function verifySignoff(manifest: SignoffManifest, templates: readonly TemplateFile[]): readonly SignoffProblem[] {
  const problems: SignoffProblem[] = [];
  const byName = new Map(templates.map((t) => [t.name, t]));

  for (const t of templates) {
    if (!(t.name in manifest)) {
      problems.push({
        template: t.name,
        message: 'no entry in templates/.signoff.json — a template nobody has signed off, and nothing would say so',
      });
    }
  }

  for (const [name, entry] of Object.entries(manifest)) {
    const file = byName.get(name);
    if (!file) {
      problems.push({
        template: name,
        message: 'entry names a template that does not exist — a signature waiting for the next file to take that name',
      });
      continue;
    }
    if (entry.status !== 'DRAFT' && entry.status !== 'SIGNED') {
      problems.push({ template: name, message: `status "${String(entry.status)}" is neither DRAFT nor SIGNED` });
      continue;
    }
    const actual = sealHash(file.body);
    if (actual !== entry.sha256_stripped) {
      problems.push({
        template: name,
        message:
          `the letter changed after it was sealed — recorded ${entry.sha256_stripped.slice(0, 12)}…, ` +
          `on disk ${actual.slice(0, 12)}…. ` +
          (entry.status === 'SIGNED'
            ? 'This is a SIGNED template: the signature no longer describes what is sent. Counsel must re-sign.'
            : 'Re-seal it (npm run seal:templates) once the wording is where you want it.'),
      });
    }
    if (entry.status === 'SIGNED') {
      if (!entry.counsel) problems.push({ template: name, message: 'SIGNED with no `counsel` — a signature nobody put their name to' });
      if (!entry.signedAt) problems.push({ template: name, message: 'SIGNED with no `signedAt` date' });
      else if (!ISO_DATE.test(entry.signedAt)) {
        problems.push({ template: name, message: `signedAt "${entry.signedAt}" is not an ISO-8601 date` });
      }
      if (DRAFT_MARKER.test(file.body)) {
        problems.push({
          template: name,
          message:
            'SIGNED, but the header still carries the DRAFT marker. The header is outside the hash, so the two ' +
            'can disagree — and a letter that tells its reader it is unapproved must not be the one going out.',
        });
      }
    } else if (!DRAFT_MARKER.test(file.body)) {
      problems.push({
        template: name,
        message:
          'DRAFT in the manifest, but the DRAFT marker has been removed from the header. The marker is the ' +
          'only thing an operator reading the file sees; deleting it is invisible to the hash.',
      });
    }
  }

  return problems;
}

/** Is this template cleared to be rendered outside dev posture? */
export function isSigned(manifest: SignoffManifest, templateName: string): boolean {
  const entry = manifest[templateName];
  return entry?.status === 'SIGNED' && !!entry.counsel && !!entry.signedAt;
}
