'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { login, logout, registerAccount, verifyIdentityStub, verifyTotp } from '@/lib/api';
import { readRegister } from '@/lib/register';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Auth server actions.
 *
 * Every one returns an ERROR STRING rather than throwing: a failed sign-in is an ordinary outcome
 * the user must be able to read and retry, not an exception. The message comes from the API, which
 * already answers in the caller's register (ADR-034).
 */
const SESSION_MAX_AGE = 12 * 60 * 60; // matches the API's session TTL

function storeSession(token: string): void {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
}

export async function signIn(_prev: string | null, form: FormData): Promise<string | null> {
  const register = readRegister();
  const result = await login(String(form.get('email') ?? ''), String(form.get('password') ?? ''), register);
  if (!result.ok) return result.message;
  // The session exists but is NOT yet MFA-verified — the API attaches nothing to a request until
  // /auth/totp succeeds, so storing it here cannot grant access on its own.
  storeSession(result.data.token);
  redirect('/anmelden/code');
}

export async function submitTotp(_prev: string | null, form: FormData): Promise<string | null> {
  const result = await verifyTotp(String(form.get('code') ?? ''), readRegister());
  if (!result.ok) return result.message;
  revalidatePath('/', 'layout');
  redirect('/konto');
}

export async function createAccount(_prev: unknown, form: FormData): Promise<{ error?: string; secret?: string }> {
  const result = await registerAccount(String(form.get('email') ?? ''), String(form.get('password') ?? ''), readRegister());
  if (!result.ok) return { error: result.message };
  // The shared secret is returned to the page ONCE and never stored by us — it belongs in the
  // user's authenticator app, and a copy on our side would defeat the point of a second factor.
  return { secret: result.data.totpSecret };
}

export async function signOut(): Promise<void> {
  await logout(readRegister());
  cookies().delete(SESSION_COOKIE);
  revalidatePath('/', 'layout');
  redirect('/anmelden');
}

/** Dev-only: stands in for the ident provider's callback so the identity gate can be exercised. */
export async function verifyIdentity(): Promise<void> {
  await verifyIdentityStub(readRegister());
  revalidatePath('/', 'layout');
}
