import { languageOf, t, type AppStrings, type Register } from '@scraper/i18n';

/**
 * Which copy register does this caller read? (port wave 2, ADR-030)
 *
 * German-first by design: the target users are German consumers, so an absent or unparseable
 * header resolves to `de` rather than to the server's locale or to English.
 *
 * Two headers, because they answer different questions and must not be conflated:
 *   - `Accept-Language` chooses the LANGUAGE (de | en) — a standard, proxy-friendly signal.
 *   - `X-Scraper-Reading-Level: leicht` chooses the READING LEVEL. Leichte Sprache is not a
 *     language tag; encoding it as one (`de-x-leicht`) would make every caching layer and browser
 *     treat it as a dialect of German, which it is not.
 */
export const READING_LEVEL_HEADER = 'x-scraper-reading-level';

type Headers = Readonly<Record<string, string | string[] | undefined>>;

function header(headers: Headers, name: string): string {
  const raw = headers[name];
  return (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase() ?? '';
}

export function registerFromHeaders(headers: Headers): Register {
  const plain = header(headers, READING_LEVEL_HEADER) === 'leicht';
  // Deliberately simple: first tag wins, no q-value ranking. A weighted Accept-Language is a
  // negotiation this API does not need — there are two languages and a hard German default.
  const accept = header(headers, 'accept-language');
  const prefersEnglish = /^\s*en\b/.test(accept);
  if (plain) return 'de-leicht'; // there is no en-leicht — see @scraper/i18n
  return prefersEnglish ? 'en' : 'de';
}

/** The dictionary for this request. */
export function stringsFor(headers: Headers): AppStrings {
  return t(registerFromHeaders(headers));
}

/** The value for the response's `Content-Language` header. */
export function contentLanguage(headers: Headers): 'de' | 'en' {
  return languageOf(registerFromHeaders(headers));
}
