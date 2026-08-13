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

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

function registerHeaders(register: Register): Record<string, string> {
  return {
    'accept-language': register === 'en' ? 'en' : 'de',
    ...(register === 'de-leicht' ? { 'x-scraper-reading-level': 'leicht' } : {}),
  };
}

async function readMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join('; ');
    if (typeof body.message === 'string') return body.message;
  } catch {
    /* fall through — a non-JSON error body is still an error */
  }
  return `HTTP ${res.status}`;
}

async function call<T>(path: string, register: Register, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...registerHeaders(register), ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    if (!res.ok) return { ok: false, status: res.status, message: await readMessage(res) };
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

export function getHealth(register: Register): Promise<ApiResult<{ ok: true; devFixtures: boolean }>> {
  return call<{ ok: true; devFixtures: boolean }>('/health', register);
}
