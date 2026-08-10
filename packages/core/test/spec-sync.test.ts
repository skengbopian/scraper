import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STATES, TRANSITIONS } from '../src/index.js';

/**
 * `schema/request-state-machine.md` is NORMATIVE. This test parses it and asserts the code matches.
 *
 * Without this, the spec and the implementation drift the moment someone edits one and not the other
 * — which is the exact failure the whole spec-before-code pass was meant to prevent. A drift here
 * should be resolved by deciding which file is right and changing the other deliberately, never by
 * relaxing this test.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SPEC = fs.readFileSync(path.join(ROOT, 'schema/request-state-machine.md'), 'utf8');

function specBlock(): string {
  const m = SPEC.match(/## Transitions \(allowed\)\s*```([\s\S]*?)```/);
  if (!m) throw new Error('could not find the transitions code block in request-state-machine.md');
  return m[1]!;
}

/** Lines look like:  FROM ──event────▶ TO   (with box-drawing padding and trailing notes). */
function parseSpecTransitions(): { from: string; event: string; to: string }[] {
  const out: { from: string; event: string; to: string }[] = [];
  for (const line of specBlock().split('\n')) {
    const m = line.match(/^([A-Z_]+)\s*──(.+?)─*▶\s*([A-Z_]+)/);
    if (!m) continue;
    const [, from, event, to] = m;
    if (from === '(any' || event!.includes('userWithdraw')) continue;
    out.push({ from: from!, event: event!.trim(), to: to! });
  }
  return out;
}

describe('code ↔ spec sync', () => {
  it('every state in the spec table exists in code, and vice versa', () => {
    // Scope to the "## States" section: the file has a second table (outcomes) with the same row
    // shape, and matching both silently conflates states with outcomes.
    const section = SPEC.slice(SPEC.indexOf('## States'), SPEC.indexOf('## Transitions'));
    const specStates = new Set<string>();
    for (const m of section.matchAll(/^\| `([A-Z_]+)` \|/gm)) specStates.add(m[1]!);
    expect([...specStates].sort()).toEqual([...STATES].sort());
  });

  it('the spec lists the same terminal states the code does', () => {
    const m = SPEC.match(/\*\*Terminal states:\*\* (.+?)\./);
    expect(m, 'the spec must name its terminal states explicitly').not.toBeNull();
    const specTerminal = [...m![1]!.matchAll(/`([A-Z_]+)`/g)].map((x) => x[1]).sort();
    expect(specTerminal).toEqual(['CLOSED_FAILED', 'COMPLIED', 'WITHDRAWN']);
  });

  it('every transition in the spec diagram exists in the code table', () => {
    const spec = parseSpecTransitions();
    expect(spec.length, 'parsed no transitions — the diagram format changed').toBeGreaterThan(25);
    for (const s of spec) {
      const found = TRANSITIONS.find((t) => t.from === s.from && t.event === s.event && t.to === s.to);
      expect(found, `spec has ${s.from} --${s.event}--> ${s.to} but the code does not`).toBeDefined();
    }
  });

  it('every transition in the code exists in the spec diagram (no undocumented edges)', () => {
    const spec = parseSpecTransitions();
    for (const t of TRANSITIONS) {
      const found = spec.find((s) => s.from === t.from && s.event === t.event && s.to === t.to);
      expect(found, `code has ${t.from} --${t.event}--> ${t.to} but the spec does not document it`).toBeDefined();
    }
  });

  it('the spec still says email is not proof of delivery (C1)', () => {
    expect(SPEC).toMatch(/[Ee]mail is not proof of delivery/);
    expect(SPEC).not.toMatch(/DKIM-aligned,?\s*\*?\*?or\*?\*?\s*postal proof/i);
  });

  it('CLAUDE.md and docs/05 agree with it — one rule in three places', () => {
    for (const f of ['CLAUDE.md', 'docs/05-legal-guardrails.md']) {
      const body = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(body, `${f} must state that email is not proof`).toMatch(/[Ee]mail is not proof/);
      expect(body, `${f} must describe the provisional deadline`).toMatch(/provisionalDeadlineAt/);
    }
  });
});
