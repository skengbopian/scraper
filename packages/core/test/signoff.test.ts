import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isSigned, sealHash, verifySignoff, type SignoffManifest, type TemplateFile } from '../src/template/signoff.js';
import { render } from '../src/template/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TEMPLATE_DIR = path.join(ROOT, 'templates');

const templates: TemplateFile[] = fs
  .readdirSync(TEMPLATE_DIR)
  .filter((f) => f.endsWith('.md'))
  .sort()
  .map((name) => ({ name, body: fs.readFileSync(path.join(TEMPLATE_DIR, name), 'utf8') }));

const manifest = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, '.signoff.json'), 'utf8')) as SignoffManifest;

/**
 * The seal, checked from the other side.
 *
 * `tools/spec-audit/signoff-check.mjs` writes `templates/.signoff.json` using its OWN copy of
 * `stripDocComment`, because that harness is deliberately not a workspace member and has to run
 * before the monorepo toolchain exists. A mirrored regex is a second implementation of the rule that
 * decides which bytes a counsel signature covers, and two implementations of one rule is how the OQ
 * numbers ended up meaning two things.
 *
 * So this recomputes every hash through the REAL `stripDocComment` — the one the worker calls at
 * dispatch — and asserts the recorded value matches. If the mirror ever drifts, the file the seal is
 * enforced from stops describing the bytes that actually get sent, and this fails.
 */
describe('the shipped templates match their seal', () => {
  it('every template has an entry and every entry a template', () => {
    expect(Object.keys(manifest).sort()).toEqual(templates.map((t) => t.name));
  });

  it.each(templates)('$name hashes to its recorded seal, computed through the real stripDocComment', ({ name, body }) => {
    expect(sealHash(body)).toBe(manifest[name]?.sha256_stripped);
  });

  it('reports no problems against the tree as it stands', () => {
    expect(verifySignoff(manifest, templates)).toEqual([]);
  });

  it('all eight are DRAFT — nothing is counsel-signed yet, and no gate may pretend otherwise', () => {
    for (const t of templates) expect(isSigned(manifest, t.name), t.name).toBe(false);
  });
});

/**
 * The seal is only worth anything if it fails. Each case is a distinct way a signature stops
 * describing what gets sent.
 */
describe('verifySignoff refuses', () => {
  const body = '<!--\nTemplate: test. DRAFT — counsel must approve.\n-->\n\nSehr geehrte Damen und Herren,\n';
  const file: TemplateFile = { name: 'x.md', body };
  const sealed = sealHash(body);
  const entry = (over: Partial<SignoffManifest['x.md']> = {}) =>
    ({ 'x.md': { status: 'DRAFT', sha256_stripped: sealed, counsel: null, signedAt: null, ...over } }) as SignoffManifest;

  const messages = (m: SignoffManifest, f: readonly TemplateFile[] = [file]) => verifySignoff(m, f).map((p) => p.message);

  it('a clean DRAFT', () => expect(messages(entry())).toEqual([]));

  it('prose edited after sealing', () => {
    const edited: TemplateFile = { name: 'x.md', body: `${body}Mit freundlichen Grüßen\n` };
    expect(messages(entry(), [edited])[0]).toMatch(/changed after it was sealed/);
  });

  it('a template with no entry at all', () => {
    expect(messages({}, [file])[0]).toMatch(/no entry/);
  });

  it('an entry whose template is gone — the next file to take that name would inherit the signature', () => {
    expect(messages(entry(), [])[0]).toMatch(/does not exist/);
  });

  it('SIGNED with nobody named', () => {
    const m = messages(entry({ status: 'SIGNED', signedAt: '2026-09-01' }), [{ name: 'x.md', body: body.replace('DRAFT — ', '') }]);
    expect(m).toContain('SIGNED with no `counsel` — a signature nobody put their name to');
  });

  it('SIGNED with no date, and with a date that is not one', () => {
    const signedBody = body.replace('DRAFT — ', '');
    expect(messages(entry({ status: 'SIGNED', counsel: 'Dr. Muster' }), [{ name: 'x.md', body: signedBody }])).toContain(
      'SIGNED with no `signedAt` date',
    );
    const bad = messages(entry({ status: 'SIGNED', counsel: 'Dr. Muster', signedAt: 'last Tuesday' }), [
      { name: 'x.md', body: signedBody },
    ]);
    expect(bad.join(' ')).toMatch(/not an ISO-8601 date/);
  });

  it('an unknown status — an unknown status is not a permission', () => {
    expect(messages(entry({ status: 'APPROVED' as never }))[0]).toMatch(/neither DRAFT nor SIGNED/);
  });

  /**
   * The header is stripped before rendering and is therefore outside the hash. These two cases are
   * the only thing keeping it honest — without them the word DRAFT could be deleted from a letter
   * with every seal still green, or a signed letter could go out still announcing it is unapproved.
   */
  it('SIGNED while the letter still announces itself as DRAFT', () => {
    const m = messages(entry({ status: 'SIGNED', counsel: 'Dr. Muster', signedAt: '2026-09-01' }));
    expect(m.join(' ')).toMatch(/still carries the DRAFT marker/);
  });

  it('DRAFT with the marker quietly deleted from the header', () => {
    const stripped: TemplateFile = { name: 'x.md', body: body.replace('DRAFT — ', '') };
    expect(messages({ 'x.md': { status: 'DRAFT', sha256_stripped: sealHash(stripped.body), counsel: null, signedAt: null } }, [
      stripped,
    ])[0]).toMatch(/marker has been removed/);
  });
});

describe('the seal covers the bytes that are actually rendered', () => {
  it('the doc-comment header is outside the hash — an engineer may fix a typo in it', () => {
    const a = '<!--\nTemplate: test. DRAFT.\n-->\n\nSehr geehrte Damen und Herren,\n';
    const b = '<!--\nTemplate: test (corrected). DRAFT.\n-->\n\nSehr geehrte Damen und Herren,\n';
    expect(sealHash(a)).toBe(sealHash(b));
  });

  it('one character of the letter is not', () => {
    const a = '<!-- DRAFT -->\n\nIch widerspreche.\n';
    const b = '<!-- DRAFT -->\n\nIch widerspreche nicht.\n';
    expect(sealHash(a)).not.toBe(sealHash(b));
  });

  it('a rendered letter is a prefix-trimmed instance of exactly the sealed body', () => {
    const body = '<!-- doc DRAFT -->\n\nName: {{legalName}}\n';
    const out = render({ templateName: 'x', body, values: { legalName: 'Erika Musterfrau' }, flags: {} });
    // The seal covers the template; substitution happens after. What matters is that nothing OUTSIDE
    // the sealed region can reach the letter — the header is gone before a single value is filled.
    expect(out).toBe('Name: Erika Musterfrau\n');
    expect(out).not.toContain('doc');
  });
});
