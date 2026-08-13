import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  chooseRung,
  CONTROLLER_TYPES,
  LADDER_ORDER,
  LEVERAGE_TIERS,
  LadderIntegrityError,
  MECHANISM_TIER,
  OUTCOME_ACHIEVABLE_BY,
  planRequestCreation,
  protectionOutcomeFor,
  requiresStatutoryInstrument,
  summariseDecision,
  tierCanAchieve,
  type RungCandidate,
  type SelfServeRoute,
} from '../src/index.js';

/**
 * The leverage ladder (ADR-036). These tests exist because the previous router expressed "cheapest"
 * as a scalar and "achieves" not at all, so the two claims that actually keep artillery reserved were
 * unrepresented — and therefore untestable.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const route = (over: Partial<SelfServeRoute> & Pick<SelfServeRoute, 'companySlug' | 'routeType' | 'url'>): SelfServeRoute => ({
  steps: [], requiresLogin: false, ...over,
});

const selfServe = (over: Partial<Extract<RungCandidate, { kind: 'SELF_SERVE' }>> = {}): RungCandidate => ({
  kind: 'SELF_SERVE',
  tier: '1',
  mechanism: 'SELF_SERVE_ROUTED',
  ref: 'acme:DSR_ERASURE',
  achieves: 'ERASURE',
  route: route({ companySlug: 'acme', routeType: 'DSR_ERASURE', url: 'https://acme.example/remove' }),
  ...over,
} as RungCandidate);

const legal = (over: Partial<Extract<RungCandidate, { kind: 'LEGAL' }>> = {}): RungCandidate => ({
  kind: 'LEGAL', tier: 'LEGAL', mechanism: 'REQUEST_CREATED', ref: 'acme:ERASURE_ART17', achieves: 'ERASURE', ...over,
} as RungCandidate);

describe('the ladder is a data structure, and it agrees with its own normative doc', () => {
  it("LADDER_ORDER follows docs/08's table, with Legal last", () => {
    const rows = [...read('docs/08-leverage-ladder.md').matchAll(/^\|\s*(\d · [^|]+?|Legal)\s*\|/gm)].map((m) => m[1]!.trim());
    // The doc's table order, mapped onto the tier keys this line uses in the ledger.
    const fromDoc = rows.map((r) => (r === 'Legal' ? 'LEGAL' : r[0]!));
    expect(fromDoc).toEqual(['0', '1', '2', '3', '4', '5', 'LEGAL']);
    const fromCode = [...LEVERAGE_TIERS].sort((a, b) => LADDER_ORDER[a] - LADDER_ORDER[b]);
    expect(fromCode).toEqual(fromDoc);
  });

  it('NONE is not a rung — it cannot be ranked', () => {
    expect(Object.keys(LADDER_ORDER)).not.toContain('NONE');
  });

  it('CONTROLLER_TYPES mirrors the Prisma enum exactly (core holds no generated-client import)', () => {
    const block = read('packages/db/prisma/schema.prisma').match(/enum ControllerType \{([\s\S]*?)\}/);
    const fromSchema = [...(block?.[1] ?? '').matchAll(/^\s*([A-Z_]+)\s*$/gm)].map((m) => m[1]!);
    expect([...CONTROLLER_TYPES].sort()).toEqual(fromSchema.sort());
  });

  it('every mechanism belongs to exactly one rung', () => {
    for (const [mechanism, tier] of Object.entries(MECHANISM_TIER)) {
      expect(typeof tier).toBe('string');
      expect(mechanism.length).toBeGreaterThan(0);
    }
  });
});

describe('outcome equivalence — the axis that forbids substituting an export for Art. 15', () => {
  it.each([
    ['ART15_INFORMATION_OBTAINED'],
    ['DATA_SOURCE_DISCLOSED'],
    ['BROKER_SOURCED_LAYER_ERASED'],
    ['OBJECTION_LODGED'],
  ] as const)('%s is achievable by the LEGAL rung and nothing else', (outcome) => {
    expect(OUTCOME_ACHIEVABLE_BY[outcome]).toEqual(['LEGAL']);
    expect(tierCanAchieve('1', outcome)).toBe(false);
    expect(tierCanAchieve('LEGAL', outcome)).toBe(true);
  });

  it('rejects a Tier-1 route that claims to discharge Art. 15, even when it is the only candidate', () => {
    const d = chooseRung({
      outcome: 'ART15_INFORMATION_OBTAINED',
      candidates: [selfServe({ achieves: 'ART15_INFORMATION_OBTAINED' })],
    });
    expect(d.kind).toBe('NONE');
    expect(d.rejected[0]?.reason).toBe('TIER_CANNOT_ACHIEVE_OUTCOME');
  });

  it('rejects a route that serves a different outcome, with a distinguishable reason', () => {
    const d = chooseRung({ outcome: 'ERASURE', candidates: [selfServe({ achieves: 'MARKETING_STOP' })] });
    expect(d.rejected[0]?.reason).toBe('WRONG_OUTCOME');
  });

  it('refuses to book a mechanism against a tier that is not its own', () => {
    expect(() => chooseRung({ outcome: 'ERASURE', candidates: [selfServe({ tier: '2' })] })).toThrow(LadderIntegrityError);
  });
});

describe('ladder order, not a cost scalar', () => {
  it('a Tier-1 rung outranks the legal rung for the same outcome', () => {
    const d = chooseRung({ outcome: 'ERASURE', candidates: [legal(), selfServe()] });
    expect(d.kind).toBe('TAKE');
    if (d.kind === 'TAKE') expect(d.chosen.tier).toBe('1');
  });

  it('is stable regardless of candidate order', () => {
    const a = chooseRung({ outcome: 'ERASURE', candidates: [selfServe(), legal()] });
    const b = chooseRung({ outcome: 'ERASURE', candidates: [legal(), selfServe()] });
    expect(a.kind === 'TAKE' && b.kind === 'TAKE' && a.chosen.ref).toBe(b.kind === 'TAKE' ? b.chosen.ref : null);
  });

  it('prefers a no-login route over a login-gated one within the same rung', () => {
    const gated = selfServe({
      ref: 'acme:ACCOUNT_DELETION',
      route: route({ companySlug: 'acme', routeType: 'ACCOUNT_DELETION', url: 'https://acme.example/close', requiresLogin: true }),
    });
    const d = chooseRung({ outcome: 'ERASURE', candidates: [gated, selfServe()] });
    expect(d.kind === 'TAKE' && d.chosen.ref).toBe('acme:DSR_ERASURE');
  });
});

describe('the high-harm bypass — a toggle is not a substitute for the statutory instrument', () => {
  it.each(['CREDIT_BUREAU', 'AI_SCREENER', 'SCREENING'] as const)('%s requires the statutory instrument', (t) => {
    expect(requiresStatutoryInstrument(t)).toBe(true);
  });

  it('an unclassified controller is NOT assumed high-harm — guessing would escalate everything', () => {
    expect(requiresStatutoryInstrument(undefined)).toBe(false);
    expect(requiresStatutoryInstrument('ECOMMERCE')).toBe(false);
  });

  it("a bureau's own self-serve route is rejected with the specific reason, not 'nothing matched'", () => {
    const d = chooseRung({ outcome: 'ERASURE', controllerType: 'CREDIT_BUREAU', candidates: [selfServe()] });
    expect(d.kind).toBe('NONE');
    expect(d.rejected[0]?.reason).toBe('HIGH_HARM_CONTROLLER_TYPE');
  });
});

describe('planRequestCreation — the seam, with the ladder underneath', () => {
  const bureauRoute = [route({ companySlug: 'schufa', routeType: 'DSR_ERASURE', url: 'https://schufa.example/loeschen' })];

  it('a user-initiated erasure at a credit bureau is NOT routed to a legal request (docs/07)', () => {
    const plan = planRequestCreation({
      requestType: 'ERASURE_ART17',
      controllerSlug: 'schufa',
      selfServeRoutes: bureauRoute,
      legalPlaybookAvailable: true, // even so: erasure is not the instrument here
      cause: 'USER_INITIATED',
      controllerType: 'CREDIT_BUREAU',
    });
    expect(plan.kind).toBe('NO_ROUTE');
    expect(plan.reason).toMatch(/not the instrument for this controller/);
    const audit = plan.leverageAction.routingDecision as { rejected: { reason: string }[] };
    expect(audit.rejected.map((r) => r.reason)).toContain('INSTRUMENT_NOT_AVAILABLE_FOR_CONTROLLER');
    expect(audit.rejected.map((r) => r.reason)).toContain('HIGH_HARM_CONTROLLER_TYPE');
  });

  it('but the PROVENANCE_CHAIN erasure at the same bureau IS the legal path — the flagship is not swallowed', () => {
    const plan = planRequestCreation({
      requestType: 'ERASURE_ART17',
      controllerSlug: 'schufa',
      selfServeRoutes: bureauRoute,
      legalPlaybookAvailable: true,
      cause: 'PROVENANCE_CHAIN',
      controllerType: 'CREDIT_BUREAU',
    });
    expect(plan.kind).toBe('CREATE_LEGAL');
    expect(plan.reason).toMatch(/Art. 17\(1\)\(d\)/);
    expect((plan.leverageAction.routingDecision as { outcome: string }).outcome).toBe('BROKER_SOURCED_LAYER_ERASED');
  });

  it('the two causes are genuinely different outcomes, not a relabelling', () => {
    expect(protectionOutcomeFor({ requestType: 'ERASURE_ART17', cause: 'USER_INITIATED' })).toBe('ERASURE');
    expect(protectionOutcomeFor({ requestType: 'ERASURE_ART17', cause: 'PROVENANCE_CHAIN' })).toBe('BROKER_SOURCED_LAYER_ERASED');
  });

  it('an exhausted self-serve rung opens the legal one without a support ticket', () => {
    const base = {
      requestType: 'ERASURE_ART17' as const,
      controllerSlug: 'acme',
      selfServeRoutes: [route({ companySlug: 'acme', routeType: 'DSR_ERASURE', url: 'https://acme.example/remove' })],
      legalPlaybookAvailable: true,
    };
    expect(planRequestCreation(base).kind).toBe('PREFER_SELF_SERVE');
    const after = planRequestCreation({ ...base, exhaustedMechanisms: ['SELF_SERVE_ROUTED'] });
    expect(after.kind).toBe('CREATE_LEGAL');
    const audit = after.leverageAction.routingDecision as { rejected: { reason: string }[] };
    expect(audit.rejected.map((r) => r.reason)).toContain('ALREADY_TRIED_BY_USER');
  });

  it('every plan carries a routing decision, and it is free of personal data', () => {
    const plans = [
      planRequestCreation({ requestType: 'ERASURE_ART17', controllerSlug: 'acme', selfServeRoutes: [route({ companySlug: 'acme', routeType: 'DSR_ERASURE', url: 'https://x/r' })], legalPlaybookAvailable: true }),
      planRequestCreation({ requestType: 'ACCESS_ART15', controllerSlug: 'acme', selfServeRoutes: [], legalPlaybookAvailable: true }),
      planRequestCreation({ requestType: 'ACCESS_ART15', controllerSlug: 'acme', selfServeRoutes: [], legalPlaybookAvailable: false }),
    ];
    for (const p of plans) {
      const audit = p.leverageAction.routingDecision;
      expect(audit).toBeDefined();
      const json = JSON.stringify(audit);
      // Tiers, mechanisms, refs and reasons only — nothing that could identify the subject.
      expect(json).not.toMatch(/legalName|dateOfBirth|userId|identityId|subject/i);
      expect(Object.keys(audit!)).toEqual(expect.arrayContaining(['outcome', 'rejected']));
    }
  });

  it('summariseDecision is JSON-safe for the audit column', () => {
    const d = chooseRung({ outcome: 'ERASURE', candidates: [selfServe()] });
    const summary = summariseDecision('ERASURE', d, 'ECOMMERCE');
    expect(() => JSON.parse(JSON.stringify(summary))).not.toThrow();
  });
});

describe('the refuse list, executable (docs/port-plan-from-A.md)', () => {
  const leverageSrc = fs
    .readdirSync(path.join(ROOT, 'packages/core/src/leverage'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({ f, body: read(`packages/core/src/leverage/${f}`) }));

  it('no cost model came across — not the numbers, and not the vocabulary that carries them', () => {
    // The pre-audit line priced a legal request partly on "it permanently consumes the ONE
    // (user, controller, requestType) idempotency slot" — the pre-ADR-013 model baked into a constant.
    for (const { f, body } of leverageSrc) {
      for (const banned of ['costModelRef', 'userMinuteValueCents', 'LEGAL_LIFECYCLE_EXPECTED', 'successProbability', 'NOT_WORTH_TRYING_FIRST']) {
        expect(body, `${f} must not carry ${banned}`).not.toContain(banned);
      }
    }
  });

  it('and the exclusion is WRITTEN DOWN, so the next reader does not re-derive the price', () => {
    // The inverse of a ban: the one place the retired model may be named is the note explaining why it
    // was left behind. Without that note a future contributor reads "the router has no cost model",
    // assumes it is an omission, and reintroduces the constant that carries the pre-ADR-013 semantics.
    const ladder = read('packages/core/src/leverage/ladder.ts');
    expect(ladder).toMatch(/cost model/i);
    expect(ladder).toMatch(/idempotency/i);
    expect(ladder).toMatch(/ADR-036/);
    // And the retired reasoning appears ONLY there — never in the selection code that acts on it.
    expect(read('packages/core/src/leverage/rungs.ts')).not.toMatch(/idempotency slot/i);
    expect(read('packages/core/src/leverage/routing.ts')).not.toMatch(/idempotency slot/i);
  });

  it('the leverage layer holds no clock vocabulary — that is what dragged the 13-state model in', () => {
    for (const { f, body } of leverageSrc) {
      expect(body, `${f}`).not.toMatch(/from '\.\.\/state-machine\//);
      expect(body, `${f}`).not.toContain('provableSendConfirmed');
    }
  });
});
