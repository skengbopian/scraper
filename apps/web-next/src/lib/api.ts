import type { Register } from '@scraper/i18n';
import type { CensusController, CreateRequestResult, CreditFileView, RequestType, RequestView } from './types';

/**
 * The API client.
 *
 * Server components call the API directly; the browser goes through the `/api/*` rewrite in
 * `next.config.mjs`, so the page never carries an absolute origin and the two can never disagree
 * about CORS.
 *
 * The register travels as headers, not as a query string or a path segment (ADR-034): a caching
 * layer keying on the URL alone would otherwise serve German copy to an English reader.
 */
function apiBase(): string {
  if (typeof window === 'undefined') return process.env.API_URL ?? 'http://localhost:3900';
  return '/api';
}

export type ApiResult<T> =
  | { ok: true; data: T }
  /**
   * `reason` is the API's machine-readable code (e.g. STEP_UP_REQUIRED, IDENTITY_NOT_VERIFIED).
   * Two different 403s need two different next actions, and deciding that by matching on translated
   * prose would break the moment the copy changed register — which it does on every page (ADR-034).
   */
  | { ok: false; status: number; message: string; reason?: string };

function registerHeaders(register: Register): Record<string, string> {
  return {
    'accept-language': register === 'en' ? 'en' : 'de',
    ...(register === 'de-leicht' ? { 'x-scraper-reading-level': 'leicht' } : {}),
  };
}

async function readError(res: Response): Promise<{ message: string; reason?: string }> {
  try {
    const body = (await res.json()) as { message?: string | string[]; reason?: string };
    const message = Array.isArray(body.message)
      ? body.message.join('; ')
      : typeof body.message === 'string'
        ? body.message
        : `HTTP ${res.status}`;
    return typeof body.reason === 'string' ? { message, reason: body.reason } : { message };
  } catch {
    /* a non-JSON error body is still an error */
  }
  return { message: `HTTP ${res.status}` };
}

/**
 * The session bearer, assembled server-side only.
 *
 * `next/headers` is imported dynamically because this module is also pulled into client components
 * (the upload form); a static import would drag a server-only module into the browser bundle.
 */
async function authHeader(): Promise<Record<string, string>> {
  if (typeof window !== 'undefined') return {};
  const { sessionToken } = await import('./session');
  const token = sessionToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function call<T>(path: string, register: Register, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...registerHeaders(register),
        ...(await authHeader()),
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, status: res.status, ...(await readError(res)) };
    return { ok: true, data: (await res.json()) as T };
  } catch (error: unknown) {
    // A dead API must not render as an empty list — the caller decides what to show, but it is told.
    return { ok: false, status: 0, message: error instanceof Error ? error.message : 'network error' };
  }
}

export function getControllers(register: Register): Promise<ApiResult<CensusController[]>> {
  return call<CensusController[]>('/controllers', register);
}

export function getRequests(register: Register): Promise<ApiResult<RequestView[]>> {
  return call<RequestView[]>('/requests', register);
}

export function getRequest(id: string, register: Register): Promise<ApiResult<RequestView>> {
  return call<RequestView>(`/requests/${encodeURIComponent(id)}`, register);
}

export function createRequest(
  controllerSlug: string,
  requestType: RequestType,
  register: Register,
): Promise<ApiResult<CreateRequestResult>> {
  // NOTE the body: controller + right only. There is no subject field, and adding one here would be
  // the anti-stalker violation the API's DTO test already forbids server-side (CLAUDE.md, ADR-009).
  return call<CreateRequestResult>('/requests', register, {
    method: 'POST',
    body: JSON.stringify({ controllerSlug, requestType }),
  });
}

export function confirmRegisteredResend(id: string, register: Register): Promise<ApiResult<{ state: string }>> {
  return call<{ state: string }>(`/requests/${encodeURIComponent(id)}/registered-resend`, register, { method: 'POST' });
}

export function declineRegisteredResend(id: string, register: Register): Promise<ApiResult<{ state: string }>> {
  return call<{ state: string }>(`/requests/${encodeURIComponent(id)}/decline-resend`, register, { method: 'POST' });
}

/** Dev-only (404s in the production posture) — the tester's simulated lifecycle. */
export function simulate(
  id: string,
  action: Record<string, string>,
  register: Register,
): Promise<ApiResult<RequestView>> {
  return call<RequestView>(`/requests/${encodeURIComponent(id)}/simulate`, register, {
    method: 'POST',
    body: JSON.stringify(action),
  });
}

export function getFindings(register: Register): Promise<ApiResult<CreditFileView>> {
  return call<CreditFileView>('/credit-file/findings', register);
}

/** The PDF goes up as raw bytes (the API mounts express.raw for application/pdf). */
export function uploadCreditFile(bytes: ArrayBuffer, register: Register): Promise<ApiResult<CreditFileView>> {
  return call<CreditFileView>('/credit-file/upload', register, {
    method: 'POST',
    headers: { 'content-type': 'application/pdf' },
    body: bytes,
  });
}

export interface RegisterResult {
  readonly userId: string;
  readonly totpSecret: string;
  readonly totpProvisioningUri: string;
  /** Shown ONCE. The API stores only hashes, so there is no endpoint that can return these again. */
  readonly recoveryCodes: readonly string[];
}

export function registerAccount(email: string, password: string, register: Register): Promise<ApiResult<RegisterResult>> {
  return call<RegisterResult>('/auth/register', register, { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function login(email: string, password: string, register: Register): Promise<ApiResult<{ token: string; mfaRequired: true }>> {
  return call<{ token: string; mfaRequired: true }>('/auth/login', register, {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

/** Step 2. The token from step 1 travels in the cookie, so `call()` attaches it. */
export function verifyTotp(code: string, register: Register): Promise<ApiResult<{ mfaVerified: true }>> {
  return call<{ mfaVerified: true }>('/auth/totp', register, { method: 'POST', body: JSON.stringify({ code }) });
}

/**
 * Re-confirm the second factor before high-sensitivity content is released (docs/06 C2).
 * A different endpoint from `verifyTotp`: signing in and opening the credit file are different acts.
 */
export function stepUp(code: string, register: Register): Promise<ApiResult<{ stepUp: true; expiresInSeconds: number }>> {
  return call<{ stepUp: true; expiresInSeconds: number }>('/auth/step-up', register, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/** Redeem a recovery code in place of the TOTP challenge. Completes MFA; never grants step-up. */
export function redeemRecoveryCode(code: string, register: Register): Promise<ApiResult<{ mfaVerified: true; remainingCodes: number }>> {
  return call<{ mfaVerified: true; remainingCodes: number }>('/auth/recovery', register, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function logout(register: Register): Promise<ApiResult<unknown>> {
  return call('/auth/logout', register, { method: 'POST' });
}

/** Dev-only identity stub — the stand-in for the ident provider (404s in the production posture). */
export function verifyIdentityStub(register: Register): Promise<ApiResult<unknown>> {
  return call('/identity/verify-stub', register, {
    method: 'POST',
    body: JSON.stringify({
      legalName: 'Erika Mustermann',
      dateOfBirth: '1979-03-12',
      street: 'Heidestraße 17',
      postalCode: '51147',
      city: 'Köln',
      country: 'DE',
    }),
  });
}

export function getHealth(register: Register): Promise<ApiResult<{ ok: true; devFixtures: boolean }>> {
  return call<{ ok: true; devFixtures: boolean }>('/health', register);
}
