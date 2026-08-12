import { describe, expect, it } from 'vitest';
import { DE, EN, LEICHT, REGISTERS, STRINGS, fill, isPlainLanguage, languageOf, t } from '../src/index.js';

/**
 * Copy tests, ported from the pre-audit line (port wave 2, ADR-030) and extended with the one this
 * line needs and that line could not have had: the TWO-CLOCK check.
 *
 * The forbidden-phrase test is the important inheritance. Copy that promises an outcome of our
 * service is a UWG risk and a docs/05 §3 violation, and it is the kind of sentence that gets written
 * in a hurry by someone being encouraging.
 */
type Leaf = [path: string, value: string];

function leaves(node: unknown, path = ''): Leaf[] {
  if (typeof node === 'string') return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  if (node !== null && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
      leaves(v, path ? `${path}.${k}` : k),
    );
  }
  return [[path, '']]; // non-string leaf — fails the non-empty check
}

describe('register completeness', () => {
  it('de and en carry exactly the same key set', () => {
    const de = leaves(DE).map(([k]) => k).sort();
    const en = leaves(EN).map(([k]) => k).sort();
    expect(de).toEqual(en);
    expect(de.length).toBeGreaterThan(80);
  });

  it('every value in every register is non-empty', () => {
    for (const register of REGISTERS) {
      for (const [key, value] of leaves(STRINGS[register])) {
        expect(value.trim().length, `${register}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('the Leichte-Sprache overlay may only simplify keys that exist in de', () => {
    const deKeys = new Set(leaves(DE).map(([k]) => k));
    for (const [key] of leaves(LEICHT)) {
      expect(deKeys.has(key), `de-leicht introduces "${key}", which does not exist in de`).toBe(true);
    }
  });

  it('de-leicht falls through to de for keys it does not simplify', () => {
    // Not overlaid → identical to German.
    expect(STRINGS['de-leicht'].brand.name).toBe(DE.brand.name);
    expect(STRINGS['de-leicht'].decision.legalCta).toBe(DE.decision.legalCta);
    // Overlaid → deliberately different, and shorter.
    expect(STRINGS['de-leicht'].start.sub).not.toBe(DE.start.sub);
    expect(STRINGS['de-leicht'].clock.statutoryNote.length).toBeLessThan(DE.clock.statutoryNote.length);
  });

  it('en is actually translated, not German left in place', () => {
    const germanTells = /\b(Ihre|Ihnen|Daten von|Firma|Anfrage|Frist läuft)\b/;
    const offenders = leaves(EN)
      // The legal vocabulary stays German on purpose — see en.ts.
      .filter(([k]) => !k.startsWith('glossary') && k !== 'nav.switchLocale' && !k.startsWith('flow.broker'))
      .filter(([, v]) => germanTells.test(v));
    expect(offenders.map(([k]) => k)).toEqual([]);
  });
});

describe('copy discipline (docs/05 §3)', () => {
  it('never promises an outcome of OUR service', () => {
    const forbidden =
      /(we will get|we guarantee|garantier|wir werden daf|raise your score|Score verbessern|Score erhöhen|100\s?%|sicher gelöscht)/i;
    for (const register of REGISTERS) {
      for (const [key, value] of leaves(STRINGS[register])) {
        expect(value, `${register}.${key}`).not.toMatch(forbidden);
      }
    }
  });

  it('keeps the identity note saying the subject is never typed in', () => {
    expect(EN.auth.identityNote).toBe(
      'Your name and address are taken from your verified identity — they are never entered here.',
    );
    expect(DE.auth.identityNote).toContain('bestätigten Identität');
    expect(DE.auth.identityNote).toContain('nie eingegeben');
  });
});

describe('the two clocks never borrow each other’s words (CLAUDE.md §6)', () => {
  it('the provisional clock never claims to be statutory or legal', () => {
    for (const register of REGISTERS) {
      const { provisionalLabel, provisionalNote } = STRINGS[register].clock;
      const label = `${provisionalLabel} ${provisionalNote}`;
      // It must SAY provisional…
      expect(label, register).toMatch(/vorläufig|provisional/i);
      // …and it must not be sold as the statutory one. "gesetzliche" may appear only while
      // explaining that the statutory clock has NOT started yet.
      expect(provisionalLabel, register).not.toMatch(/gesetzliche Frist|statutory deadline/i);
    }
  });

  it('the provisional note explains that email is not proof of delivery', () => {
    expect(DE.clock.provisionalNote).toMatch(/kein Zustellnachweis/);
    expect(EN.clock.provisionalNote).toMatch(/not proof of delivery/);
    expect(STRINGS['de-leicht'].clock.provisionalNote).toMatch(/kein Nachweis/);
  });

  it('states the one-month duty in every register, and cites Art. 12 in the legal registers only', () => {
    for (const register of REGISTERS) {
      const clock = STRINGS[register].clock;
      // The DUTY must be stated everywhere — that is the user-facing fact.
      expect(clock.statutoryNote, register).toMatch(/Monat|month/i);
      // The CITATION belongs in the legal registers. Leichte Sprache deliberately drops paragraph
      // numbers: "Art. 12 DS-GVO" is precisely the jargon that register exists to remove, and a
      // citation nobody can read adds authority without adding understanding (docs/09 §4).
      if (register === 'de-leicht') {
        expect(clock.statutoryNote, register).not.toMatch(/Art\. ?12/);
      } else {
        expect(clock.statutoryNote, register).toMatch(/Art\. 12/);
      }
      // The provisional note may cite Art. 12 only to say the clock has NOT started.
      if (/Art\. ?12/.test(clock.provisionalNote)) {
        expect(clock.provisionalNote, register).toMatch(/beginnt erst|starts only/i);
      }
    }
  });

  it('the silence path points at the Einschreiben, never at an escalation', () => {
    for (const register of REGISTERS) {
      expect(STRINGS[register].clock.silenceNote, register).toMatch(/Einschreiben/);
      expect(STRINGS[register].clock.silenceNote, register).not.toMatch(/Beschwerde|complaint|Art\. 77/i);
    }
  });
});

describe('helpers', () => {
  it('t() resolves each register and falls back to German', () => {
    expect(t('de')).toBe(STRINGS.de);
    expect(t('en')).toBe(STRINGS.en);
    expect(t('de-leicht')).toBe(STRINGS['de-leicht']);
    expect(t(undefined)).toBe(STRINGS.de);
    expect(t('klingon')).toBe(STRINGS.de);
  });

  it('reports the reading level and the underlying language separately', () => {
    expect(isPlainLanguage('de-leicht')).toBe(true);
    expect(isPlainLanguage('de')).toBe(false);
    expect(languageOf('de-leicht')).toBe('de');
    expect(languageOf('en')).toBe('en');
  });

  it('fill() substitutes placeholders and leaves unknown ones visible', () => {
    expect(fill(DE.start.greeting, { name: 'Erika' })).toBe('Guten Tag, Erika.');
    expect(fill('{a} und {b}', { a: 'eins' })).toBe('eins und {b}');
  });

  it('every {placeholder} in de has the same name in en', () => {
    const names = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
    const enByKey = new Map(leaves(EN));
    for (const [key, value] of leaves(DE)) {
      expect(names(enByKey.get(key) ?? ''), key).toBe(names(value));
    }
  });
});
