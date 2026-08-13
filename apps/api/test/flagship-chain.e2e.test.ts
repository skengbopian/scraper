import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

/**
 * THE FLAGSHIP CHAIN, over HTTP: ask infoscore where the data came from, get an answer naming a
 * broker, and reach a DRAFTED follow-up instead of a dead end (ADR-036, port wave 4).
 *
 * Before this wave the chain stopped at the answer: `proposeFollowUps` produced proposals and the
 * product had no playbook, no template and no route to act on any of them. What this test pins down
 * is not only that it now continues, but the three things that must remain true while it does:
 *
 *  1. nothing is created without a HUMAN confirmation of a specific proposal (CLAUDE.md §2),
 *  2. the confirmation's privilege is DERIVED from the stored answer, not claimed by the caller,
 *  3. a plain user-initiated erasure at the same bureau is still refused (docs/07).
 */

async function bootApp(): Promise<{ app: INestApplication; base: string }> {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../dist/app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  return { app, base: (await app.getUrl()).replace('[::1]', '127.0.0.1') };
}

const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;
const post = (base: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe('the Provenance chain no longer dead-ends', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    process.env.SCRAPER_DEV_FIXTURES = '1';
    ({ app, base } = await bootApp());
  });
  afterAll(async () => {
    await app.close();
    delete process.env.SCRAPER_DEV_FIXTURES;
  });

  it('runs end to end: provenance request → answer naming a broker → confirmed Art. 17(1)(d) follow-up', async () => {
    // 1. The Art. 15(1)(g) request. Only the legal rung can produce a source disclosure, so even
    //    though infoscore is a credit bureau with routes in the directory, this is CREATE_LEGAL.
    const created = await json(await post(base, '/requests', { controllerSlug: 'infoscore', requestType: 'ACCESS_ART15_SOURCE' }));
    expect(created.routed).toBe('LEGAL');
    const id = String(created.id);

    // 2. The send. Email in the alpha, so a PROVISIONAL clock only — the statutory one needs a
    //    carrier receipt anchored at a real QTSP, which no stub can produce (ADR-037). The chain
    //    below does not depend on which clock ran: a reply is ingestable from either waiting state.
    const sent = await json(await post(base, `/requests/${id}/simulate`, { action: 'dispatch', channel: 'email' }));
    expect(sent.clockIsProvable).toBe(false);
    expect(sent.statutoryDeadlineAt).toBeNull();
    expect(sent.provisionalDeadlineAt).toBeTruthy();

    // 3. The answer. Two categories attributed to AZ Direct, one to a contract partner.
    const answered = await json(await post(base, `/requests/${id}/simulate`, { action: 'respond', outcome: 'complied' }));
    expect(answered.state).toBe('COMPLIED');

    // 4. The follow-ups the answer opened. Proposals only — listing creates nothing.
    const before = await json(await fetch(`${base}/requests`));
    const followUps = (await json(await fetch(`${base}/requests/${id}/follow-ups`))).followUps as Record<string, unknown>[];
    expect(followUps.length).toBeGreaterThan(0);
    for (const f of followUps) expect(f.requiresHumanConfirmation).toBe(true);
    expect(((await json(await fetch(`${base}/requests`))) as unknown as unknown[]).length).toBe(
      (before as unknown as unknown[]).length,
    );

    // The bureau-side proposal is the one this wave built the playbook and template for.
    const bureauErasure = followUps.find(
      (f) => f.requestType === 'ERASURE_ART17' && f.targetControllerSlug === 'infoscore',
    );
    expect(bureauErasure, 'the Art. 17(1)(d) partial erasure at the bureau must be proposed').toBeTruthy();
    expect(String(bureauErasure!.rationale)).toContain('az-direct');
    expect(String(bureauErasure!.rationale)).toContain('Art. 17(1)(d)');

    // 5. The human step. THIS is what used to 404 / dead-end.
    const confirmed = await json(await post(base, `/requests/${id}/follow-ups/${String(bureauErasure!.id)}/confirm`));
    expect(confirmed.routed).toBe('LEGAL');
    expect(confirmed.id).toBeTruthy();
    expect(confirmed.state).toBe('READY');
  });

  it('an unanswered request offers no follow-ups, and a made-up one is refused', async () => {
    // One request for both assertions on purpose: a second create for the same
    // (user, controller, requestType) is blocked by the idempotency guard while the first is open,
    // which is the correct behaviour and would make a second fixture request a guard failure.
    const created = await json(await post(base, '/requests', { controllerSlug: 'regis24', requestType: 'ACCESS_ART15_SOURCE' }));
    expect(created.routed).toBe('LEGAL');
    const id = String(created.id);

    expect((await json(await fetch(`${base}/requests/${id}/follow-ups`))).followUps).toEqual([]);

    const r = await post(base, `/requests/${id}/follow-ups/ERASURE_ART17:infoscore:0/confirm`);
    expect(r.status).toBe(400);
    expect((await json(r)).error).toBe('UNKNOWN_FOLLOW_UP');
  });

  it('still refuses a plain user-initiated erasure at the same bureau (docs/07)', async () => {
    // The chain's Art. 17(1)(d) demand is lawful because it is bounded by the bureau's own answer.
    // An unbounded erasure at a credit bureau is a different instrument, and not one we offer.
    const r = await json(await post(base, '/requests', { controllerSlug: 'infoscore', requestType: 'ERASURE_ART17' }));
    expect(r.routed).toBe('NONE');
    expect(String(r.reason)).toMatch(/not the instrument for this controller/);
  });

  it('the request body cannot claim the chain privilege for itself', async () => {
    // Even spelling `cause` in the body changes nothing: the DTO has no such field and the create
    // route hardcodes USER_INITIATED, so this is the refusal above and not a bureau erasure.
    const r = await json(
      await post(base, '/requests', { controllerSlug: 'infoscore', requestType: 'ERASURE_ART17', cause: 'PROVENANCE_CHAIN' }),
    );
    expect(r.routed).toBe('NONE');
  });
});
