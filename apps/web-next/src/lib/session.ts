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

/**
 * A same-origin path we are willing to redirect to after step-up.
 *
 * The obvious `^\/[A-Za-z0-9\-_/]*$` does NOT do this job: `/` is inside the character class, so it
 * also accepts `//evil.example` and `//16909060` — protocol-relative URLs that browsers resolve to a
 * different origin. An open redirect on the screen that has just asked for a one-time code is a
 * phishing gift, so the second character must not be a slash or a backslash.
 */
export function isSafeNextPath(value: string): boolean {
  return /^\/(?![/\\])[A-Za-z0-9\-_/]*$/.test(value);
}
