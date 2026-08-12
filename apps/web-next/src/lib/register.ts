import { cookies } from 'next/headers';
import { REGISTERS, t, type AppStrings, type Register } from '@scraper/i18n';

/**
 * Server-side register resolution (ADR-034).
 *
 * Two cookies rather than one, mirroring the wire contract: the LANGUAGE and the READING LEVEL are
 * independent choices, and a single `lang=de-leicht` cookie would make "Leichte Sprache" look like a
 * dialect that could also exist in English. It cannot — there is no en-leicht.
 *
 * German-first: an absent or unrecognised cookie resolves to `de`, never to the browser's locale.
 * The target users are German consumers, and a German speaker on an English-locale phone must not
 * be handed English legal copy.
 */
export const LANGUAGE_COOKIE = 'lang';
export const READING_LEVEL_COOKIE = 'reading-level';

export function readRegister(): Register {
  const jar = cookies();
  const language = jar.get(LANGUAGE_COOKIE)?.value === 'en' ? 'en' : 'de';
  const plain = jar.get(READING_LEVEL_COOKIE)?.value === 'leicht';
  // No en-leicht: plain language implies German.
  const register: Register = plain ? 'de-leicht' : language;
  return REGISTERS.includes(register) ? register : 'de';
}

export function strings(): AppStrings {
  return t(readRegister());
}
