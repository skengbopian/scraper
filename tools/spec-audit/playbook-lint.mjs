// Semantic invariants that JSON Schema CANNOT express, enforced alongside the schema.
//
// Why this file exists: "the schema rejects it" is the wrong bar. Three classes of defect are
// structurally beyond JSON Schema — cross-field value comparison (two arrays overlapping), anything
// needing the filesystem (does the template actually bind these subjectFields?), and anything needing
// history (was a shipped version mutated?). Leaving them unchecked because the schema can't reach them
// would mean a playbook that passes validation and still generates a legally wrong letter.
//
// validatePlaybook() below is THE validation entry point. Schema alone is not a green light.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './root.mjs';

/** Deep-walk every string value in a document. */
function* strings(node, trail = '') {
  if (typeof node === 'string') { yield [trail, node]; return; }
  if (Array.isArray(node)) { for (const [i, v] of node.entries()) yield* strings(v, `${trail}[${i}]`); return; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) yield* strings(v, trail ? `${trail}.${k}` : k);
  }
}

/** Flatten a condition into the list of literal needles it matches on. */
function needlesOf(cond) {
  if (!cond || typeof cond !== 'object') return [];
  const out = [];
  const eat = (m) => { if (m && Array.isArray(m.responseContains)) out.push(...m.responseContains); };
  eat(cond);
  for (const m of cond.anyOf || []) eat(m);
  for (const m of cond.allOf || []) eat(m);
  return out;
}

/** Flatten a condition into the structured.<key>=<value> pairs it matches on. */
function structuredOf(cond) {
  if (!cond || typeof cond !== 'object') return [];
  const out = [];
  const eat = (m) => {
    if (!m || typeof m !== 'object') return;
    for (const [k, v] of Object.entries(m)) if (k.startsWith('structured.')) out.push(`${k}=${JSON.stringify(v)}`);
  };
  eat(cond);
  for (const m of cond.anyOf || []) eat(m);
  for (const m of cond.allOf || []) eat(m);
  return out;
}

const SUBJECT_TO_TPLVAR = {
  legalName: ['legalName'],
  dateOfBirth: ['dateOfBirth'],
  addresses: ['primaryAddress', 'additionalAddresses'],
};
const IDENTITY_VARS = new Set(['legalName', 'dateOfBirth', 'primaryAddress', 'additionalAddresses']);

/** Flags the ENGINE derives at render time — never declarable in a playbook (audit C6). */
export const ENGINE_DERIVED_FLAGS = {
  identityProofEnclosed:
    'set true only when an IdentityPacket was actually attached to this dispatch (docs/03 §IdentityPacket, docs/04 step 3)',
};

function readTemplate(name) {
  const p = path.join(ROOT, 'templates', `${name}.md`);
  if (!fs.existsSync(p)) return null;
  const stripped = fs.readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const vars = new Set(), blocks = new Set();
  for (const m of stripped.matchAll(/\{\{\s*([#/]?)([^}\s]+)[^}]*\}\}/g)) {
    (m[1] === '#' || m[1] === '/' ? blocks : vars).add(m[2]);
  }
  const ifFlags = [...stripped.matchAll(/\{\{#if\s+([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
  return { vars: [...vars], blocks: [...blocks], ifFlags };
}

/**
 * Semantic lints. Returns [{id, severity, message}]. severity: 'error' blocks a send.
 * `opts.templates` — set false when no filesystem templates are expected (synthetic fixtures).
 */
export function lintPlaybook(pb, opts = {}) {
  const problems = [];
  const E = (id, message) => problems.push({ id, severity: 'error', message });
  const W = (id, message) => problems.push({ id, severity: 'warn', message });
  if (!pb || typeof pb !== 'object') return [{ id: 'SHAPE', severity: 'error', message: 'not an object' }];

  // --- 1. Contradictory outcomes. Two conditions matching the same literal make the outcome
  //        order-dependent: the same controller letter is COMPLIED or REFUSED depending on which rule
  //        the engine happens to evaluate first. JSON Schema cannot compare two sibling arrays.
  const outcomes = { compliedIf: 'COMPLIED', refusedIf: 'REFUSED', incompleteIf: 'INCOMPLETE' };
  const keys = Object.keys(outcomes);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const [a, b] = [keys[i], keys[j]];
      const ca = pb.validation?.[a], cb = pb.validation?.[b];
      if (!ca || !cb) continue;
      const overlapN = needlesOf(ca).filter((n) => needlesOf(cb).includes(n));
      const overlapS = structuredOf(ca).filter((n) => structuredOf(cb).includes(n));
      for (const o of [...overlapN, ...overlapS]) {
        E('OUTCOME-CONTRADICTION',
          `validation.${a} and validation.${b} both match ${JSON.stringify(o)} — the same reply would resolve to ${outcomes[a]} or ${outcomes[b]} depending on evaluation order`);
      }
    }
  }

  // --- 2. Unresolved placeholders anywhere in the document (the schema only guards named fields).
  if (pb.parameterised !== true) {
    for (const [trail, val] of strings(pb)) {
      if (val.includes('__PARAM__')) {
        E('PARAM', `${trail} contains an unresolved __PARAM__ placeholder and the playbook is not marked parameterised:true — it is not sendable`);
      }
    }
  } else if (pb.active === true) {
    E('PARAM', 'parameterised:true with active:true — a stencil must never be sendable');
  }

  // --- 3. Template binding: does the bound template render a variable subjectFields does not supply?
  //        Needs the filesystem, so it can never be a schema constraint.
  if (opts.templates !== false && pb.template) {
    const t = readTemplate(pb.template);
    if (!t) {
      E('TPL-MISSING', `references template "${pb.template}" but templates/${pb.template}.md does not exist`);
    } else {
      const provided = new Set((pb.subjectFields || []).flatMap((s) => SUBJECT_TO_TPLVAR[s] || []));
      for (const v of new Set([...t.vars, ...t.blocks].filter((v) => IDENTITY_VARS.has(v)))) {
        if (!provided.has(v)) {
          E('SUBJECT-FIELD',
            `template "${pb.template}" renders {{${v}}} but subjectFields ${JSON.stringify(pb.subjectFields)} does not supply it — the letter would go out with an empty field`);
        }
      }
      const declared = Object.keys(pb.templateFlags || {});
      for (const flag of t.ifFlags) {
        if (ENGINE_DERIVED_FLAGS[flag]) continue;
        if (!declared.includes(flag)) {
          W('TPL-FLAG', `template "${pb.template}" branches on {{#if ${flag}}} but templateFlags does not declare it — the branch is silently omitted`);
        }
      }
      for (const flag of declared) {
        if (ENGINE_DERIVED_FLAGS[flag]) {
          E('TPL-FLAG-DERIVED',
            `declares templateFlags.${flag}, but that flag is engine-derived — ${ENGINE_DERIVED_FLAGS[flag]}. A static declaration reintroduces audit C6 (a letter claiming an enclosure it does not carry)`);
        }
      }
      if (t.ifFlags.includes('identityProofEnclosed') && pb.identityProof?.required !== true) {
        W('TPL-ENCLOSURE', `template "${pb.template}" can render an ID-enclosure sentence but identityProof.required is not true — the branch will always be omitted`);
      }
    }
  }

  // --- 4. Channel sanity the schema states positively but cannot compare.
  if (pb.channel?.fallback && pb.channel.primary === pb.channel.fallback) {
    W('CHANNEL', `channel.fallback equals channel.primary ("${pb.channel.primary}") — there is no fallback`);
  }
  if (typeof pb.channel?.registered === 'boolean') {
    E('CHANNEL-REGISTERED', 'channel.registered is a bare boolean — it must be per-channel ({primary, fallback}), since Einwurf-Einschreiben is postal-only (audit H2)');
  }

  // --- 5. identityProof minimisation (the "required:false + a real document" direction; the schema
  //        already rejects the required:true + [none] contradiction).
  if (pb.identityProof?.required === false && (pb.identityProof.accepts || []).some((a) => a !== 'none')) {
    W('IDENTITY-PROOF',
      `identityProof.required=false but accepts=${JSON.stringify(pb.identityProof.accepts)} — accepts is the ceiling of what we hand over; pairing "not required" with a real document invites over-collection (docs/07)`);
  }

  // --- 6. Process gate: nothing ships active without counsel sign-off recorded against its version.
  if (pb.active === true) {
    E('ACTIVE', 'active=true — no playbook may be enabled in the repo before counsel sign-off is recorded against this version (ARCHITECTURE-DECISIONS.md §4)');
  }

  return problems;
}

/** Schema + lints. This is the whole gate; do not call the schema on its own. */
export function validatePlaybook(pb, ajvValidate, opts = {}) {
  const errors = [];
  if (!ajvValidate(pb)) {
    for (const e of ajvValidate.errors) {
      errors.push({ id: 'SCHEMA', severity: 'error', message: `${e.instancePath || '/'} ${e.message}` });
    }
  }
  errors.push(...lintPlaybook(pb, opts));
  return errors;
}
