import { DE } from './de.js';
import { EN } from './en.js';
import { LEICHT } from './leicht.js';
import type { AppStrings, DeepPartial } from './types.js';

export type { AppStrings, DeepPartial } from './types.js';
export { DE } from './de.js';
export { EN } from './en.js';
export { LEICHT } from './leicht.js';

/**
 * Three registers, two of which are languages and one of which is a reading level.
 *
 * `de` and `en` are complete dictionaries (compile-enforced). `de-leicht` is a partial overlay on
 * `de` — see `leicht.ts` for why. There is deliberately NO `en-leicht`: Leichte Sprache is a German
 * institution with its own rules, and inventing an English analogue would imply a standard we are
 * not following.
 */
export type Register = 'de' | 'de-leicht' | 'en';

export const REGISTERS: readonly Register[] = ['de', 'de-leicht', 'en'];

/** Is this the plain-language reading level? */
export function isPlainLanguage(register: Register): boolean {
  return register === 'de-leicht';
}

/** The underlying language, for `<html lang>` and screen readers. */
export function languageOf(register: Register): 'de' | 'en' {
  return register === 'en' ? 'en' : 'de';
}

function overlay(base: AppStrings, patch: DeepPartial<AppStrings>): AppStrings {
  const out: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = out[key];
    // Arrays are glossary tuples — replaced whole, never merged element-wise.
    if (Array.isArray(value) || typeof value !== 'object' || value === null) {
      out[key] = value;
    } else {
      out[key] = overlay(current as AppStrings, value as DeepPartial<AppStrings>);
    }
  }
  return out as unknown as AppStrings;
}

/** `de-leicht` resolved once at module load — the overlay never changes at runtime. */
const DE_LEICHT: AppStrings = overlay(DE, LEICHT);

export const STRINGS: Readonly<Record<Register, AppStrings>> = Object.freeze({
  de: DE,
  'de-leicht': DE_LEICHT,
  en: EN,
});

/** The dictionary for a register. Unknown values fall back to German rather than throwing. */
export function t(register: string | undefined | null): AppStrings {
  return STRINGS[(register as Register) in STRINGS ? (register as Register) : 'de'];
}

/**
 * Fill `{placeholders}`. Deliberately tiny: the alternative is a formatting library whose feature
 * set (plurals, dates, nested selects) invites logic into the copy layer, where it is neither
 * reviewed by counsel nor covered by the copy tests.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
