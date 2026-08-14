import { NextResponse, type NextRequest } from 'next/server';
import { readRegister } from '../../../src/lib/register';
import { sessionToken } from '../../../src/lib/session';

/**
 * The upload proxy (audit W4). The API authenticates with an Authorization bearer only, and the
 * session token lives in an httpOnly cookie page scripts can never read — so the previous
 * browser→API direct POST arrived anonymous and 403'd the moment real auth was on. The flagship
 * "same-day utility" upload worked only in the fixture alpha, where the dev identity fills the
 * authorization vacuum.
 *
 * This handler is the same seam `lib/api.ts` is for JSON calls: it attaches the bearer
 * server-side and passes the PDF through. The bytes are read once and forwarded; nothing is
 * persisted here (CLAUDE.md §2 — the sandboxed API endpoint is the one place a hostile PDF may
 * land). The API's own 8 MB cap still applies; the error body (message + nextAction) is passed
 * through untouched so the form can render the API's next-action guidance instead of a generic
 * failure.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = sessionToken();
  const register = readRegister();
  const api = process.env.API_URL ?? 'http://localhost:3900';

  const res = await fetch(`${api}/credit-file/upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/pdf',
      'accept-language': register === 'en' ? 'en' : 'de',
      ...(register === 'de-leicht' ? { 'x-scraper-reading-level': 'leicht' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: Buffer.from(await req.arrayBuffer()),
  });

  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
  });
}
