'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { login, logout, redeemRecoveryCode, registerAccount, stepUp, verifyIdentityStub, verifyTotp } from '@/lib/api';
import { readRegister } from '@/lib/register';
import { SESSION_COOKIE, isSafeNextPath } from '@/lib/session';

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

export async function createAccount(
  _prev: unknown,
  form: FormData,
): Promise<{ error?: string; secret?: string; recoveryCodes?: readonly string[] }> {
  const result = await registerAccount(String(form.get('email') ?? ''), String(form.get('password') ?? ''), readRegister());
  if (!result.ok) return { error: result.message };
  // The shared secret AND the recovery codes are returned to the page ONCE and never stored by us —
  // the secret belongs in the user's authenticator app, and the codes only on their paper. A copy on
  // our side would defeat the point of a second factor; the API keeps only hashes of the codes, so
  // there is no endpoint that could hand them back later either.
  return { secret: result.data.totpSecret, recoveryCodes: result.data.recoveryCodes };
}

/**
 * Step-up: re-confirm the second factor, then return to the page that needed it.
 *
 * `next` is validated as a same-origin PATH before redirecting (see `isSafeNextPath`, which rejects
 * the protocol-relative `//host` form a naive path regex lets through). An open redirect on the
 * step-up screen would be a phishing gift — the user has just been asked for a code, so a page that
 * then bounces them anywhere is the perfect place to harvest the next one.
 */
export async function confirmStepUp(_prev: string | null, form: FormData): Promise<string | null> {
  const result = await stepUp(String(form.get('code') ?? ''), readRegister());
  if (!result.ok) return result.message;
  const requested = String(form.get('next') ?? '');
  const next = isSafeNextPath(requested) ? requested : '/akte';
  revalidatePath('/', 'layout');
  redirect(next);
}

/**
 * Redeem a recovery code instead of the authenticator code.
 *
 * The reason this exists at all: the TOTP secret is encrypted under the user's own key, so nobody can
 * reset it for them. Generating recovery codes without shipping a way to USE them would have left the
 * lost-phone case exactly where it was — permanently locked out — while looking solved.
 */
export async function submitRecoveryCode(_prev: string | null, form: FormData): Promise<string | null> {
  const result = await redeemRecoveryCode(String(form.get('code') ?? ''), readRegister());
  if (!result.ok) return result.message;
  revalidatePath('/', 'layout');
  redirect('/konto');
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
