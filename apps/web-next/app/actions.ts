'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { LANGUAGE_COOKIE, READING_LEVEL_COOKIE, readRegister } from '@/lib/register';
import { confirmRegisteredResend, createRequest, declineRegisteredResend, simulate } from '@/lib/api';
import type { RequestType } from '@/lib/types';

const YEAR = 60 * 60 * 24 * 365;

/** Language and reading level are independent switches (ADR-034) — two cookies, never one. */
export async function setLanguage(language: 'de' | 'en'): Promise<void> {
  cookies().set(LANGUAGE_COOKIE, language, { path: '/', maxAge: YEAR, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}

export async function toggleReadingLevel(): Promise<void> {
  const jar = cookies();
  const plain = jar.get(READING_LEVEL_COOKIE)?.value === 'leicht';
  if (plain) jar.delete(READING_LEVEL_COOKIE);
  else jar.set(READING_LEVEL_COOKIE, 'leicht', { path: '/', maxAge: YEAR, sameSite: 'lax' });
  revalidatePath('/', 'layout');
}

/**
 * The API's answer, surfaced instead of swallowed (audit W7): a blocked duplicate, a routed
 * self-serve handoff and a created request are three different next actions, and the launch gate
 * says no screen may dead-end. Prose (`message`) is already in the caller's register.
 */
export interface StartRequestOutcome {
  readonly ok: boolean;
  readonly message?: string;
  readonly reason?: string;
}

export async function startRequest(slug: string, requestType: RequestType): Promise<StartRequestOutcome> {
  const r = await createRequest(slug, requestType, readRegister());
  revalidatePath('/', 'layout');
  if (!r.ok) return { ok: false, message: r.message, ...(r.reason ? { reason: r.reason } : {}) };
  return { ok: true };
}

export async function authoriseRegisteredResend(id: string): Promise<void> {
  await confirmRegisteredResend(id, readRegister());
  // The request re-enters READY (guards re-run — invariant 1) and the WORKER dispatches it. This
  // used to chain a simulated `postal_registered` dispatch here, which produced a statutory deadline
  // out of a stub receipt. It cannot any more (ADR-037), and it should not: the page's job is to
  // record the user's authorisation, not to manufacture the proof that authorisation is waiting for.
  revalidatePath('/', 'layout');
}

export async function declineResend(id: string): Promise<void> {
  await declineRegisteredResend(id, readRegister());
  revalidatePath('/', 'layout');
}

/** Dev-only tester controls; the API refuses these outside the fixture posture. */
export async function simulateAction(id: string, action: Record<string, string>): Promise<void> {
  await simulate(id, action, readRegister());
  revalidatePath('/', 'layout');
}
