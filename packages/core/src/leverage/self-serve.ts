/**
 * Tier-1 self-serve route directory + cheapest-rung-first routing (docs/08 §2, docs/10 §7).
 *
 * Doctrine (docs/08): consumer welfare is not deletion count. The cheapest, highest-success removal is
 * the company's OWN opt-out/deletion page — there is nothing for them to refuse. So before generating a
 * legal request, the engine checks for a self-serve route that achieves the same outcome and prefers it
 * (docs/08 guardrail 5). This module is the pure decision layer; it performs no I/O.
 *
 * GUARDRAIL (docs/08 guardrail 1, non-negotiable): a self-serve route holds NO third-party credential.
 * A route that needs the user to sign in stays a GUIDED HANDOFF — we deep-link the user into their own
 * session and they act; we never store their password or log in for them. `SelfServeRoute` has no
 * password/token/cookie/secret field, and `packages/core/test/self-serve.test.ts` reads this source and
 * fails if such a field is ever added.
 */

/** The kinds of self-serve off-switch a company exposes. Mirrors the Prisma `SelfServeRouteType`. */
export type SelfServeRouteType =
  | 'ACCOUNT_DELETION'
  | 'MARKETING_PREFS'
  | 'DO_NOT_SELL'
  | 'AD_ID_RESET'
  | 'CONSENT_WITHDRAWAL'
  | 'DSR_ERASURE';

/**
 * One self-serve route. Deliberately credential-free: the only way to "use" a login-gated route is a
 * guided handoff into the user's own session. If you find yourself wanting a field to hold the user's
 * password, cookie, or an API token for the third party, STOP — that is the docs/08 guardrail-1 line.
 */
export interface SelfServeRoute {
  readonly companySlug: string;
  readonly routeType: SelfServeRouteType;
  /** Public opt-out / deletion URL, deep-linked in a guided handoff. */
  readonly url: string;
  /** Ordered, human-readable steps rendered as a checklist. Not executable. */
  readonly steps: readonly string[];
  /** True where the route requires signing into the company's account → stays guided, never automated. */
  readonly requiresLogin: boolean;
  readonly estMinutes?: number;
  /** ISO date the route was last confirmed working. Staleness kills the asset (docs/08 §2). */
  readonly lastVerifiedAt?: string;
  readonly verificationMethod?: string;
  /** Rolling success rate in [0,1], for routing preference and honest reporting. */
  readonly successRate?: number;
}

/** The welfare outcome the user wants — mapped to the route kinds that achieve it. */
export type DesiredOutcome =
  | 'ERASURE'
  | 'MARKETING_STOP'
  | 'DO_NOT_SELL'
  | 'ACCOUNT_DELETION'
  | 'CONSENT_WITHDRAWAL';

const OUTCOME_ROUTE_TYPES: Readonly<Record<DesiredOutcome, readonly SelfServeRouteType[]>> = Object.freeze({
  // An erasure is satisfied by a genuine data-subject-erasure form or by full account deletion.
  ERASURE: Object.freeze(['DSR_ERASURE', 'ACCOUNT_DELETION']),
  MARKETING_STOP: Object.freeze(['MARKETING_PREFS', 'DO_NOT_SELL', 'CONSENT_WITHDRAWAL']),
  DO_NOT_SELL: Object.freeze(['DO_NOT_SELL']),
  ACCOUNT_DELETION: Object.freeze(['ACCOUNT_DELETION']),
  CONSENT_WITHDRAWAL: Object.freeze(['CONSENT_WITHDRAWAL']),
}) as Readonly<Record<DesiredOutcome, readonly SelfServeRouteType[]>>;

/**
 * A login-gated route is guided-only: the user completes it in their own session. This is a property of
 * the route, checked wherever a route might otherwise be presented as automatable.
 */
export function isGuidedOnly(route: SelfServeRoute): boolean {
  return route.requiresLogin;
}

/** Normalise a slug for comparison so a casing/whitespace mismatch can't silently defeat routing. */
function normaliseSlug(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Property names a self-serve route must never carry — the docs/08 guardrail-1 denylist. Matching is
 * case-insensitive and EXACT (normalised), never substring: `requiresLogin` legitimately contains
 * "login", so a substring test would false-positive on it.
 */
export const FORBIDDEN_CREDENTIAL_KEYS: readonly string[] = Object.freeze([
  'password', 'passwd', 'pwd', 'pass',
  'secret', 'clientsecret', 'apisecret',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'sessiontoken', 'bearer', 'bearertoken', 'jwt',
  'cookie', 'cookies', 'session', 'sessionid',
  'apikey', 'privatekey',
  'auth', 'authorization', 'authtoken',
  'pin', 'otp', 'mfa',
  'credential', 'credentials', 'login', 'username',
]);

const CREDENTIAL_DENYSET: ReadonlySet<string> = new Set(FORBIDDEN_CREDENTIAL_KEYS.map((k) => k.toLowerCase()));

/**
 * Runtime backstop for the guardrail: throws if a value carries a credential-shaped key at ANY depth.
 * The TypeScript type already forbids it on `SelfServeRoute`; this catches an object that crossed a JSON
 * boundary (a seed file, an import, an API body) with such a field, including one nested inside a `meta`
 * or `extra` bag. Case-insensitive, cycle-safe. Mirrors the "unrepresentable, at every layer" pattern of
 * ADR-019 — call it at any ingestion seam before a route is trusted.
 */
export function assertNoCredential(value: unknown, path = 'route', seen: WeakSet<object> = new WeakSet()): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoCredential(v, `${path}[${i}]`, seen));
    return;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_DENYSET.has(key.toLowerCase())) {
      throw new Error(
        `A SelfServeRoute carries a forbidden credential field "${key}" at ${path}. A login-gated route ` +
          `is a guided handoff — we never store or transmit third-party credentials (docs/08 guardrail 1).`,
      );
    }
    assertNoCredential(v, `${path}.${key}`, seen);
  }
}

export type RungChoice =
  | { readonly rung: 'SELF_SERVE'; readonly route: SelfServeRoute; readonly guided: boolean; readonly reason: string }
  | { readonly rung: 'LEGAL'; readonly reason: string }
  | { readonly rung: 'NONE'; readonly reason: string };

/**
 * Rank candidate routes so the cheapest, least-friction, most-likely-to-work one wins:
 *  1. prefer a route that does NOT require login (no handoff friction, and never credential-adjacent),
 *  2. then higher observed success rate,
 *  3. then fewer estimated minutes.
 */
function preferRoute(a: SelfServeRoute, b: SelfServeRoute): number {
  if (a.requiresLogin !== b.requiresLogin) return a.requiresLogin ? 1 : -1;
  const sa = a.successRate ?? 0;
  const sb = b.successRate ?? 0;
  if (sa !== sb) return sb - sa;
  return (a.estMinutes ?? Number.MAX_SAFE_INTEGER) - (b.estMinutes ?? Number.MAX_SAFE_INTEGER);
}

export interface CheapestRungInput {
  readonly controllerSlug: string;
  readonly outcome: DesiredOutcome;
  readonly routes: readonly SelfServeRoute[];
  /** Whether a counsel-approved legal playbook exists for this (controller, outcome) as the fallback. */
  readonly legalPlaybookAvailable: boolean;
}

/**
 * Cheapest-rung-first (docs/08 guardrail 5): if a self-serve route achieves the outcome, take it;
 * otherwise fall back to the legal request; otherwise there is no available route. The Erasure Machine
 * must call this BEFORE generating a RightsRequest and prefer a returned SELF_SERVE rung.
 */
export function chooseCheapestRung(input: CheapestRungInput): RungChoice {
  const wanted = new Set(OUTCOME_ROUTE_TYPES[input.outcome]);
  const target = normaliseSlug(input.controllerSlug);
  // filter() returns a fresh array, so sorting it does not mutate input.routes.
  const matches = input.routes
    .filter((r) => normaliseSlug(r.companySlug) === target && wanted.has(r.routeType))
    .sort(preferRoute);

  const [route] = matches;
  if (route) {
    return {
      rung: 'SELF_SERVE',
      route,
      guided: isGuidedOnly(route),
      reason: isGuidedOnly(route)
        ? "self-serve route exists but is login-gated — present it as a guided handoff (no credential storage)"
        : "self-serve route exists — the company's own opt-out page; nothing for the controller to refuse, and cheaper than a legal request",
    };
  }
  if (input.legalPlaybookAvailable) {
    return { rung: 'LEGAL', reason: 'no self-serve route for this outcome — fall back to the legal request' };
  }
  return { rung: 'NONE', reason: 'no self-serve route and no legal playbook available for this (controller, outcome)' };
}
