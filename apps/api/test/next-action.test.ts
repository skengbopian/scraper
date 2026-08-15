import { describe, expect, it } from 'vitest';
import { STATES } from '@scraper/core';

/**
 * The nextAction map versus the state machine — the anti-drift test.
 *
 * `nextActionFor` used to carry its own inline map covering 16 of the 17 `STATES`, so any request
 * parked in AWAITING_DELIVERY_PROOF made `GET /requests` and `GET /requests/:id` throw a 500. That
 * is the state a registered lodgement lands in, i.e. the only path to a statutory Art. 12(3) clock
 * (CLAUDE.md §6) — the request most worth showing a user was the one the list could not render.
 *
 * `satisfies Record<RequestState, string>` in next-action.ts already makes a missing state a build
 * error. This test is the belt to that suspenders, and it earns its keep by checking the property
 * against the SHIPPED `STATES` array rather than against the type: `RequestState` is erased at
 * runtime, and a stale build of @scraper/core would satisfy the compiler while shipping a map that
 * does not cover the states the running machine can actually reach.
 *
 * Both directions are checked. A missing entry is the 500 that motivated this file; an extra entry
 * is a state that was renamed or removed while its next action was left behind — dead vocabulary
 * the UI could never receive, and a sign the two files have parted company.
 */
describe('nextAction map covers the state machine exactly', () => {
  it('every state in STATES has a next action', async () => {
    const { NEXT_ACTION_BY_STATE } = await import('../dist/requests/next-action.js');
    const missing = STATES.filter((s) => !(s in NEXT_ACTION_BY_STATE));
    expect(missing, `states with no next action: ${missing.join(', ')}`).toEqual([]);
  });

  it('the map names no state the machine does not have', async () => {
    const { NEXT_ACTION_BY_STATE } = await import('../dist/requests/next-action.js');
    const extra = Object.keys(NEXT_ACTION_BY_STATE).filter((k) => !(STATES as readonly string[]).includes(k));
    expect(extra, `next actions for unknown states: ${extra.join(', ')}`).toEqual([]);
  });

  it('resolves every state without throwing, and never to an empty string', async () => {
    const { nextActionFor } = await import('../dist/requests/next-action.js');
    for (const state of STATES) {
      const action = nextActionFor(state);
      expect(typeof action, `${state} resolved to ${String(action)}`).toBe('string');
      expect(action.length, `${state} resolved to an empty next action`).toBeGreaterThan(0);
    }
  });

  it('AWAITING_DELIVERY_PROOF resolves — the regression that 500ed the only path to a statutory clock', async () => {
    const { nextActionFor } = await import('../dist/requests/next-action.js');
    expect(nextActionFor('AWAITING_DELIVERY_PROOF')).toBe('AWAIT_DELIVERY_PROOF');
  });

  it('AWAITING_DELIVERY_PROOF does not claim a reply is due — no clock runs there', async () => {
    const { nextActionFor } = await import('../dist/requests/next-action.js');
    expect(nextActionFor('AWAITING_DELIVERY_PROOF')).not.toBe(nextActionFor('AWAITING_RESPONSE'));
  });
});

/**
 * The same property one level up, at the surface that actually 500ed.
 *
 * The map test above would pass against a service that never consulted the map, so this drives
 * `RequestsService` itself — the real `view()` — over a stub repository holding one request in each
 * state. `GET /requests` (listForUser) and `GET /requests/:id` (getForUser) are the two routes the
 * pipeline screen renders from, and neither may throw for a state the machine can reach.
 *
 * A stub repository rather than the HTTP suite because AWAITING_DELIVERY_PROOF is not reachable over
 * this API at all: only the worker's postal channel emits `sendLodged`, and the simulate surface's
 * registered send is refused at the anchor and lands in CLOSED_FAILED. So the state that broke the
 * list had — and has — no e2e route that would have caught it.
 */
describe('the request view renders every reachable state', () => {
  const snapshot = (state: string) => ({
    id: `req_${state.toLowerCase()}`,
    userId: 'u1',
    controllerId: 'c1',
    requestType: 'OBJECTION_ART21',
    state,
    provableSendConfirmedAt: null,
    deadlineAt: null,
    provisionalDeadlineAt: null,
    proofDueAt: null,
    hasControllerResponse: false,
    reviewedByHuman: false,
    parseConfidence: null,
    humanReviewIfConfidenceBelow: 0.75,
    outcome: null,
  });

  async function serviceOverAllStates() {
    const { RequestsService } = await import('../dist/requests/requests.service.js');
    const rows = STATES.map(snapshot);
    const repo = {
      load: async (id: string) => rows.find((r) => r.id === id) ?? null,
      listByUser: async () => rows,
    };
    return { service: new RequestsService(repo as never, null), rows };
  }

  it('listForUser renders all 17 states without throwing', async () => {
    const { service, rows } = await serviceOverAllStates();
    const view = await service.listForUser('u1');
    expect(view).toHaveLength(rows.length);
    expect(view.every((v: { nextAction?: string }) => typeof v.nextAction === 'string' && v.nextAction.length > 0)).toBe(true);
  });

  it('getForUser renders a request parked by a registered lodgement — the 500 itself', async () => {
    const { service } = await serviceOverAllStates();
    const view = await service.getForUser('u1', 'req_awaiting_delivery_proof');
    expect(view.state).toBe('AWAITING_DELIVERY_PROOF');
    expect(view.nextAction).toBe('AWAIT_DELIVERY_PROOF');
    // No clock of any kind is claimed for this state (CLAUDE.md §6).
    expect(view.statutoryDeadlineAt).toBeNull();
    expect(view.provisionalDeadlineAt).toBeNull();
    expect(view.clockIsProvable).toBe(false);
  });
});
