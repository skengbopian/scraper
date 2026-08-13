import { cookies } from 'next/headers';

/**
 * The session token, held in an httpOnly cookie.
 *
 * The API authenticates with `Authorization: Bearer <token>`, but the token must never be readable
 * by page scripts — an XSS that can read it can act as the user against every guarded route. So it
 * lives in an httpOnly cookie that only server components and server actions can see, and the
 * bearer header is assembled server-side on each call (see `api.ts`).
 *
 * Note the interaction with the dev fixture: the API's DevIdentityMiddleware fills an identity ONLY
 * when no Authorization header is present at all. So the moment a real session exists, the fixture
 * stops applying — a broken or expired session fails closed as itself rather than silently becoming
 * the fixture user.
 */
export const SESSION_COOKIE = 'session';

export function sessionToken(): string | undefined {
  return cookies().get(SESSION_COOKIE)?.value;
}

export function isSignedIn(): boolean {
  return sessionToken() !== undefined;
}
