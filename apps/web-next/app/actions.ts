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

export async function startRequest(slug: string, requestType: RequestType): Promise<void> {
  await createRequest(slug, requestType, readRegister());
  revalidatePath('/', 'layout');
}

export async function authoriseRegisteredResend(id: string): Promise<void> {
  const register = readRegister();
  const result = await confirmRegisteredResend(id, register);
  // The registered send is what STARTS the statutory clock; in the alpha it is simulated, and the
  // simulate surface 404s in the production posture, so a failure here is expected and silent.
  if (result.ok) await simulate(id, { action: 'dispatch', channel: 'postal_registered' }, register);
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
