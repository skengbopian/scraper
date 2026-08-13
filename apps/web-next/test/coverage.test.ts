import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Register coverage as a property, ported from the pre-audit line's `locale-coverage.test.ts`.
 *
 * That line shipped a de/en toggle for weeks while nine of nineteen pages never consulted it, so
 * switching to English produced a half-translated app. A missing translation is a compile error
 * here (see @scraper/i18n), but a page that simply hardcodes German is not — this is the check that
 * catches it.
 */
const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app');

function tsx(dir: string, match: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsx(full, match);
    return match(entry) ? [full] : [];
  });
}

/** Pages answer for the register; EVERY component answers for what it renders. */
const files = tsx(APP, (name) => name === 'page.tsx');
const components = tsx(APP, (name) => name.endsWith('.tsx'));

describe('every page consults the register', () => {
  it('finds the pages at all (a passing test over an empty set proves nothing)', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files.map((f) => [f.slice(APP.length + 1), f] as const))('%s reads copy from the register', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(/\bstrings\(\)|\breadRegister\(\)/);
  });
});

describe('no page hardcodes user-facing German', () => {
  // Words that would only appear in a hardcoded sentence, not in an identifier or a CSS class.
  const german = /["'>][^"'<>{}]*\b(Ihre Daten|Bitte|Frist|Anfrage vorbereiten|Gesetzliche)\b/;

  it.each(files.map((f) => [f.slice(APP.length + 1), f] as const))('%s has no inline German copy', (_name, file) => {
    const source = readFileSync(file, 'utf8')
      .split('\n')
      // Comments explain the German rules on purpose; only rendered strings matter here.
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n');
    expect(source).not.toMatch(german);
  });
});

describe('the deadline is never rendered outside the one component', () => {
  it('no component except DeadlineCard formats a deadline itself', () => {
    for (const file of components.filter((f) => !f.endsWith('deadline-card.tsx'))) {
      const source = readFileSync(file, 'utf8');
      // Pages may resolve a deadline; only DeadlineCard may turn one into words.
      expect(source, file).not.toMatch(/clockCopy\(/);
      expect(source, file).not.toMatch(/statutoryDeadlineAt\s*[?.]/);
    }
  });
});

describe('no raw engine vocabulary reaches a screen (docs/09 §3)', () => {
  it.each(components.map((f) => [f.slice(APP.length + 1), f] as const))('%s renders labels, not codes', (_name, file) => {
    const source = readFileSync(file, 'utf8');
    // Rendering `{x.state}` or `{x.requestType}` directly puts AWAITING_RESPONSE_PROVISIONAL on
    // screen. The labels in @scraper/i18n exist precisely so that cannot happen.
    expect(source, 'renders a bare state').not.toMatch(/\{[\w.]*\.state\}/);
    expect(source, 'renders a bare requestType').not.toMatch(/\{[\w.]*\.requestType[^L]/);
  });
});

describe('failures are explained, never flattened to "offline"', () => {
  it('no page hardcodes the offline message for every failure', () => {
    for (const file of components) {
      const source = readFileSync(file, 'utf8');
      if (file.endsWith('api-error.tsx')) continue;
      // Rendering `s.errors.offline` directly means a 403 identity gate — an expected, actionable
      // state — would be reported as a network problem. ApiError decides from the status instead.
      expect(source, `${file} renders errors.offline directly`).not.toMatch(/errors\.offline/);
    }
  });
});
