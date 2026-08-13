import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * GUARDRAIL — "a request whose subject is not the verified identity must be unrepresentable."
 *
 * The type system enforces this inside the domain (see subject.test.ts). But an HTTP API is a hole
 * in the type system: a DTO field is just a string arriving from the network. So this test reads the
 * actual source of the request-creation surface and asserts that no field describing a PERSON exists
 * anywhere in it.
 *
 * If someone adds `subjectName` to the DTO — the single change that would turn this product into a
 * people-finder — this fails. That is the whole point.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Field names that would let a caller say WHOSE data to request rather than WHOSE BEHALF we act on. */
const FORBIDDEN_FIELD_PATTERNS: readonly RegExp[] = [
  /\bsubject(Name|LegalName|FirstName|LastName|Person)\b/i,
  /\breadonly\s+(name|firstName|lastName|fullName|legalName)\s*[?!]?\s*:/i,
  /\breadonly\s+(dateOfBirth|dob|birthDate)\s*[?!]?\s*:/i,
  /\breadonly\s+(address|street|postalCode|residence)\s*[?!]?\s*:/i,
  /\btargetPerson\b/i,
  /\bsearchFor\b/i,
];

const SURFACE_FILES = [
  'apps/api/src/requests/create-request.dto.ts',
  'apps/api/src/requests/requests.controller.ts',
];

describe('GUARDRAIL — the API surface cannot express a subject', () => {
  for (const rel of SURFACE_FILES) {
    it(`${rel} declares no person-describing field`, () => {
      const p = path.join(ROOT, rel);
      expect(fs.existsSync(p), `${rel} is missing — did the API surface move? Update this test deliberately.`).toBe(true);
      const src = fs.readFileSync(p, 'utf8');
      // Strip comments: the files *discuss* these field names in prose explaining why they are absent.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const re of FORBIDDEN_FIELD_PATTERNS) {
        expect(code, `${rel} appears to accept a person-describing field matching ${re}`).not.toMatch(re);
      }
    });
  }

  it('the create DTO exposes only controllerSlug and requestType', () => {
    const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/requests/create-request.dto.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const fields = [...code.matchAll(/readonly\s+([A-Za-z0-9_]+)\s*[?!]?\s*:/g)].map((m) => m[1]);
    expect(fields.sort()).toEqual(['controllerSlug', 'requestType']);
  });

  it('the caller cannot name its own `cause` — that is a privilege, not a description (ADR-036)', () => {
    // PROVENANCE_CHAIN skips the Art. 12(5) re-exercise cooling AND is what makes an Art. 17(1)(d)
    // erasure lawful at a credit bureau. A body field would let a client assert both with no evidence
    // that a provenance answer exists, so the create route hardcodes USER_INITIATED and the chained
    // follow-up route derives the cause from the stored provenance entries.
    const dto = fs.readFileSync(path.join(ROOT, 'apps/api/src/requests/create-request.dto.ts'), 'utf8');
    const dtoCode = dto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(dtoCode).not.toMatch(/cause/);

    const ctrl = fs.readFileSync(path.join(ROOT, 'apps/api/src/requests/requests.controller.ts'), 'utf8');
    const ctrlCode = ctrl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(ctrlCode).not.toMatch(/dto\.cause/);
    expect(ctrlCode).toMatch(/cause:\s*'USER_INITIATED'/);

    const svc = fs.readFileSync(path.join(ROOT, 'apps/api/src/requests/requests.service.ts'), 'utf8');
    // The one place PROVENANCE_CHAIN is set is the confirmation path, and it re-derives the proposal
    // list from stored evidence before doing so.
    const provenanceCauses = [...svc.matchAll(/cause:\s*'PROVENANCE_CHAIN'/g)];
    expect(provenanceCauses).toHaveLength(1);
    expect(svc).toMatch(/deriveFollowUps/);
  });

  it('the controller exposes no route that sends an Art. 77 complaint', () => {
    const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/requests/requests.controller.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/humanSend/);
    expect(code).not.toMatch(/@Post\([^)]*escalat/i);
    expect(code).not.toMatch(/\bsendComplaint\b/i);
  });

  it('the service delegates creation to the core orchestration and does not reimplement insert', () => {
    const src = fs.readFileSync(path.join(ROOT, 'apps/api/src/requests/requests.service.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'create() must delegate to the core createRequest orchestration').toMatch(/createRequest\s*\(/);
    // The insert path lives in the (behaviourally-tested) core function; the service must not re-add it.
    expect(code, 'requests.service.ts must not call .insert directly — that bypasses the tested orchestration').not.toMatch(/\.insert\s*\(/);
  });

  it('the core create orchestration checks cheapest-rung-first before any insert (docs/08 guardrail 5)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'packages/core/src/request/create-request.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const planAt = code.indexOf('planRequestCreation');
    const insertAt = code.indexOf('port.insert');
    expect(planAt, 'planRequestCreation not found in the orchestration').toBeGreaterThanOrEqual(0);
    expect(insertAt, 'port.insert must come after the cheapest-rung plan').toBeGreaterThan(planAt);
    // The behavioural guarantee (insert never called on the self-serve arm) is in create-request.test.ts.
  });

  it('the doc-sandbox has no database dependency — the isolation boundary is structural', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'services/doc-sandbox/package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const forbidden of ['@scraper/db', '@prisma/client', 'prisma', 'pg']) {
      expect(deps, `doc-sandbox must not depend on ${forbidden} (docs/06 C4: no write access to request state)`)
        .not.toHaveProperty(forbidden);
    }
  });
});
