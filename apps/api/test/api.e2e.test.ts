import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

/**
 * HTTP-level e2e for the alpha API: boots the real Nest app (real modules, in-memory repository,
 * no mocks of our own code) on an ephemeral port and drives it with fetch.
 *
 * Two suites: fixtures ON (the alpha tester journey) and fixtures OFF (the fail-closed production
 * posture). The env var is read at module-creation time, so each suite builds its own app.
 */

async function bootApp(): Promise<{ app: INestApplication; base: string }> {
  const { NestFactory } = await import('@nestjs/core');
  // Boot the COMPILED app (tsc runs in the test script): vitest's esbuild transform does not emit
  // the decorator metadata Nest's constructor injection needs, and dist is the artifact that ships.
  const { AppModule } = await import('../dist/app.module.js');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableCors({ origin: 'null' });
  await app.listen(0);
  const base = await app.getUrl();
  return { app, base: base.replace('[::1]', '127.0.0.1') };
}

const json = (r: Response) => r.json() as Promise<Record<string, unknown>>;

describe('alpha API with dev fixtures ON', () => {
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

  it('health reports fixture mode', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(await json(r)).toEqual({ ok: true, devFixtures: true });
  });

  it('census lists controllers with honest expected outcomes + CC0 provenance', async () => {
    const r = await fetch(`${base}/controllers`);
    const list = (await r.json()) as Record<string, unknown>[];
    expect(list.length).toBeGreaterThanOrEqual(15);
    const bySlug = Object.fromEntries(list.map((c) => [c.slug, c]));
    expect(bySlug.zoominfo.expectedOutcome).toBe('SELF_SERVE');
    expect(bySlug['az-direct'].expectedOutcome).toBe('LEGAL');
    expect(bySlug.crif.expectedOutcome).toBe('NONE');
    // The counsel-gated flagship stays honest: hirevue has no route and no demo pair.
    expect(bySlug.hirevue.expectedOutcome).toBe('NONE');
    // CC0 community enrichment carries quality + sources (import-not-activation).
    const schufa = bySlug.schufa as { community: { quality: string; sources: string[] } };
    expect(schufa.community.quality).toBe('verified');
    expect(schufa.community.sources.length).toBeGreaterThan(0);
  });

  it('routes the three outcomes: SELF_SERVE / LEGAL / NONE', async () => {
    const post = (body: unknown) =>
      fetch(`${base}/requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    const selfServe = await post({ controllerSlug: 'zoominfo', requestType: 'ERASURE_ART17' });
    expect(((await json(selfServe)) as { routed: string }).routed).toBe('SELF_SERVE');

    const none = await post({ controllerSlug: 'crif', requestType: 'ACCESS_ART15' });
    expect(((await json(none)) as { routed: string }).routed).toBe('NONE');

    const legal = await post({ controllerSlug: 'schufa', requestType: 'ACCESS_ART15' });
    const created = (await json(legal)) as { routed: string; state: string; id: string };
    expect(created.routed).toBe('LEGAL');
    expect(created.state).toBe('READY');

    // Idempotency: the duplicate is blocked and names the existing request.
    const dup = await post({ controllerSlug: 'schufa', requestType: 'ACCESS_ART15' });
    expect(dup.status).toBe(400);
    expect(((await json(dup)) as { error: string }).error).toBe('GUARD_IDEMPOTENCY');
  });

  it('rejects garbage requestType with a clear error', async () => {
    const r = await fetch(`${base}/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ controllerSlug: 'schufa', requestType: 'DELETE_EVERYTHING' }),
    });
    expect(r.status).toBe(400);
    expect(((await json(r)) as { error: string }).error).toBe('INVALID_REQUEST_TYPE');
  });

  it('walks the full lifecycle: provisional clock → chase → statutory clock → escalation draft', async () => {
    const post = (path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

    const created = (await json(
      await post('/requests', { controllerSlug: 'infoscore', requestType: 'ACCESS_ART15_SOURCE' }),
    )) as { id: string };
    const id = created.id;

    // Email dispatch: PROVISIONAL clock only — never a statutory deadline (CLAUDE.md §6).
    const dispatched = (await json(await post(`/requests/${id}/simulate`, { action: 'dispatch', channel: 'email' }))) as Record<string, unknown>;
    expect(dispatched.state).toBe('AWAITING_RESPONSE_PROVISIONAL');
    expect(dispatched.statutoryDeadlineAt).toBeNull();
    expect(dispatched.provisionalDeadlineAt).not.toBeNull();
    expect(dispatched.clockIsProvable).toBe(false);

    // Silence on a provisional clock → the chase step, never escalation.
    const expired = (await json(await post(`/requests/${id}/simulate`, { action: 'expire' }))) as Record<string, unknown>;
    expect(expired.state).toBe('AWAITING_REGISTERED_RESEND');

    // The user authorises the registered re-send; guards re-run (invariant 1).
    const resent = (await json(await post(`/requests/${id}/registered-resend`))) as Record<string, unknown>;
    expect(resent.state).toBe('READY');

    // Registered dispatch: NOW the statutory clock starts.
    const registered = (await json(
      await post(`/requests/${id}/simulate`, { action: 'dispatch', channel: 'postal_registered' }),
    )) as Record<string, unknown>;
    expect(registered.state).toBe('AWAITING_RESPONSE');
    expect(registered.statutoryDeadlineAt).not.toBeNull();
    expect(registered.clockIsProvable).toBe(true);

    // An incomplete answer (the BayLDA pattern) → INCOMPLETE → a DRAFTED complaint. No send route exists.
    const responded = (await json(await post(`/requests/${id}/simulate`, { action: 'respond', outcome: 'incomplete' }))) as Record<string, unknown>;
    expect(responded.state).toBe('INCOMPLETE');
    const drafted = (await json(await post(`/requests/${id}/simulate`, { action: 'escalate' }))) as Record<string, unknown>;
    expect(drafted.state).toBe('ESCALATION_DRAFTED');
    expect(drafted.nextAction).toBe('AWAIT_OPS_SEND');

    // The list view carries the Vorgang with both clocks labelled.
    const list = (await (await fetch(`${base}/requests`)).json()) as Record<string, unknown>[];
    expect(list.some((r) => r.id === id && r.state === 'ESCALATION_DRAFTED')).toBe(true);
  });

  it('an unreadable response routes to NEEDS_HUMAN (invariant 5), never to a validated outcome', async () => {
    const post = (path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const { id } = (await json(await post('/requests', { controllerSlug: 'az-direct', requestType: 'OBJECTION_ART21' }))) as { id: string };
    await post(`/requests/${id}/simulate`, { action: 'dispatch', channel: 'postal_registered' });
    const r = (await json(await post(`/requests/${id}/simulate`, { action: 'respond', outcome: 'unreadable' }))) as Record<string, unknown>;
    expect(r.state).toBe('NEEDS_HUMAN');
    expect(r.nextAction).toBe('AWAIT_OPS_REVIEW');
  });

  it('illegal simulate jumps are rejected by the machine, not silently absorbed', async () => {
    const post = (path: string, body?: unknown) =>
      fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const { id } = (await json(await post('/requests', { controllerSlug: 'regis24', requestType: 'ACCESS_ART15_SOURCE' }))) as { id: string };
    expect(id).toBeDefined();
    // READY cannot "respond" — there was never a send.
    const r = await post(`/requests/${id}/simulate`, { action: 'respond', outcome: 'complied' });
    expect(r.status).toBe(409);
  });
});

describe('alpha API with dev fixtures OFF (production posture)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    delete process.env.SCRAPER_DEV_FIXTURES;
    ({ app, base } = await bootApp());
  });
  afterAll(async () => {
    await app.close();
  });

  it('health reports fixtures off', async () => {
    expect(await json(await fetch(`${base}/health`))).toEqual({ ok: true, devFixtures: false });
  });

  it('every request route fail-closes 403 with the next action named', async () => {
    const r = await fetch(`${base}/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ controllerSlug: 'zoominfo', requestType: 'ERASURE_ART17' }),
    });
    expect(r.status).toBe(403);
    expect(((await json(r)) as { nextAction: string }).nextAction).toBe('START_IDENTITY_VERIFICATION');
  });

  it('the simulate surface does not exist (404, not 403)', async () => {
    const r = await fetch(`${base}/requests/req_x/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'dispatch' }),
    });
    expect(r.status).toBe(404);
  });

  it('serves the identity refusal in the caller\'s register (wave 2 i18n)', async () => {
    const ask = (headers: Record<string, string>) =>
      fetch(`${base}/requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ controllerSlug: 'zoominfo', requestType: 'ERASURE_ART17' }),
      });

    const de = (await json(await ask({}))) as { message: string; nextAction: string };
    expect(de.message).toContain('Identität');
    expect(de.nextAction).toBe('START_IDENTITY_VERIFICATION');

    const en = (await json(await ask({ 'accept-language': 'en-GB,en;q=0.9' }))) as { message: string };
    expect(en.message).toBe('Your identity is not confirmed yet. Please complete the identity check first.');

    // Leichte Sprache is a READING LEVEL, not a language tag — it has its own header, and it
    // resolves to German regardless of Accept-Language (there is no en-leicht).
    const leicht = (await json(await ask({ 'accept-language': 'en', 'x-scraper-reading-level': 'leicht' }))) as { message: string };
    expect(leicht.message).toContain('Identität');
  });

  it('the census stays public (product data, not user data)', async () => {
    const r = await fetch(`${base}/controllers`);
    expect(r.status).toBe(200);
    const list = (await r.json()) as { expectedOutcome: string; slug: string }[];
    // Without fixtures there are no demo playbook pairs: nothing may claim LEGAL.
    expect(list.every((c) => c.expectedOutcome !== 'LEGAL')).toBe(true);
  });
});
