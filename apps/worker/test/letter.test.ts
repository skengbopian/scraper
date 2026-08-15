import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { paragraphsOf, renderDin5008Letter, splitBetreff, type Din5008Letter } from '../src/providers/letter/din5008.js';
import { isLayoutablePostalRecipient, parsePostalRecipient, UnparseableRecipientError } from '../src/providers/letter/recipient.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

describe('parsing a playbook recipient into address lines', () => {
  it('splits the shipped az-direct recipient the way an envelope window needs it', () => {
    expect(parsePostalRecipient('AZ Direct GmbH, Datenschutz, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh')).toEqual({
      lines: ['AZ Direct GmbH', 'Datenschutz', 'Carl-Bertelsmann-Str. 161S', '33311 Gütersloh'],
      country: 'DE',
    });
  });

  it('handles a Postfach address', () => {
    expect(parsePostalRecipient('SCHUFA Holding AG, Postfach 10 34 41, 50474 Köln').lines).toEqual([
      'SCHUFA Holding AG',
      'Postfach 10 34 41',
      '50474 Köln',
    ]);
  });

  it('every shipped playbook postal recipient is layoutable', async () => {
    // If a counsel-supplied address is ever added in a shape this cannot post, it fails HERE — in a
    // test — rather than at 3am in a dispatch job that lands in the human queue.
    const dir = join(ROOT, 'playbooks');
    const files = (await readdir(dir)).filter((f) => f.endsWith('.yaml'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const yaml = await readFile(join(dir, file), 'utf8');
      const postal = /^\s{2}postal:\s*"([^"]+)"/m.exec(yaml)?.[1];
      if (postal === undefined || postal.includes('__PARAM__')) continue;
      expect(isLayoutablePostalRecipient(postal), `${file}: ${postal}`).toBe(true);
    }
  });

  const rejected: readonly [string, RegExp][] = [
    ['AZ Direct GmbH', /fewer than two/],
    ['AZ Direct GmbH, Gütersloh', /no "PLZ Ort" line/],
    ['AZ Direct GmbH, 33311 Gütersloh, Carl-Bertelsmann-Str. 161S', /is not last/],
    ['A, B, C, D, E, F, G', /DIN 5008 allows 6/],
    [`A very long department name that will never fit inside eighty-five millimetres, 33311 Gütersloh`, /does not fit/],
  ];
  for (const [recipient, why] of rejected) {
    it(`refuses ${JSON.stringify(recipient.slice(0, 36))}`, () => {
      expect(() => parsePostalRecipient(recipient)).toThrow(UnparseableRecipientError);
      expect(() => parsePostalRecipient(recipient)).toThrow(why);
    });
  }
});

describe('splitBetreff', () => {
  it('lifts the template\'s own Betreff line out of the body', () => {
    const { subject, body } = splitBetreff('Betreff: Widerspruch (Art. 21 Abs. 2 DSGVO)\n\nSehr geehrte Damen und Herren,\n');
    expect(subject).toBe('Widerspruch (Art. 21 Abs. 2 DSGVO)');
    expect(body.startsWith('Sehr geehrte')).toBe(true);
    expect(body).not.toContain('Betreff:');
  });

  it('leaves a body with no Betreff line alone', () => {
    expect(splitBetreff('Sehr geehrte Damen und Herren,')).toEqual({ subject: null, body: 'Sehr geehrte Damen und Herren,' });
  });
});

describe('paragraphsOf — which source line breaks are the letter and which are the Markdown file', () => {
  it('joins a hard-wrapped paragraph back into one', () => {
    // The real shape of templates/art21-werbewiderspruch.de.md.
    const source =
      'hiermit widerspreche ich gemäß Artikel 21 Absatz 2 DSGVO der Verarbeitung mich betreffender\n' +
      'personenbezogener Daten zum Zwecke der Direktwerbung. Der Widerspruch umfasst auch ein etwaiges\n' +
      'Profiling, soweit es mit solcher Direktwerbung in Verbindung steht.';
    expect(paragraphsOf(source)).toHaveLength(1);
    expect(paragraphsOf(source)[0]).toContain('ein etwaiges Profiling, soweit');
  });

  it('keeps the closing block as three lines', () => {
    // The regression this rule exists for: joining produced
    // "Mit freundlichen Grüßen Erika Mustermann 15.08.2026" on one line.
    expect(paragraphsOf('Mit freundlichen Grüßen\nErika Mustermann\n15.08.2026')).toEqual([
      'Mit freundlichen Grüßen',
      'Erika Mustermann',
      '15.08.2026',
    ]);
  });

  it('never joins one numbered demand to the next, however long the previous line is', () => {
    const source =
      '1. die Verarbeitung meiner Daten zu Werbezwecken unverzüglich einzustellen (Art. 21 Abs. 3 DSGVO),\n' +
      '2. meine Daten in eine interne Sperrliste aufzunehmen, um künftige werbliche Ansprache zu verhindern,\n' +
      '3. mir die Umsetzung innerhalb der Frist des Art. 12 Abs. 3 DSGVO schriftlich zu bestätigen.';
    expect(paragraphsOf(source)).toHaveLength(3);
  });

  it('joins a demand’s own continuation line, which carries no marker', () => {
    const source =
      '4. sowie mir mitzuteilen, an welche Empfänger meine Daten zu Werbezwecken weitergegeben wurden, damit ich\n' +
      '   auch dort widersprechen kann.';
    expect(paragraphsOf(source)).toEqual([
      '4. sowie mir mitzuteilen, an welche Empfänger meine Daten zu Werbezwecken weitergegeben wurden, damit ich auch dort widersprechen kann.',
    ]);
  });

  it('collapses runs of blank lines to one separator', () => {
    expect(paragraphsOf('Erster Absatz.\n\n\n\nZweiter Absatz.')).toEqual(['Erster Absatz.', '', 'Zweiter Absatz.']);
  });
});

const LETTER: Din5008Letter = {
  sender: { name: 'Erika Mustermann', addressLines: ['Musterstraße 1', '10115 Berlin'] },
  recipient: parsePostalRecipient('AZ Direct GmbH, Datenschutz, Carl-Bertelsmann-Str. 161S, 33311 Gütersloh'),
  subject: 'Widerspruch gegen die Verarbeitung zu Werbezwecken (Art. 21 Abs. 2 DSGVO)',
  body: 'Sehr geehrte Damen und Herren,\n\nhiermit widerspreche ich gemäß Artikel 21 Absatz 2 DSGVO.\n\n- Name: Erika Mustermann\n\nMit freundlichen Grüßen\nErika Mustermann\n',
  date: new Date('2026-08-15T00:00:00.000Z'),
};

describe('renderDin5008Letter', () => {
  it('produces a real, single-page A4 PDF', async () => {
    const bytes = await renderDin5008Letter(LETTER);
    // Not Markdown wearing a .pdf name — the header the vendor's `base64_file` field expects.
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(595); // A4 at 72 dpi
    expect(Math.round(height)).toBe(842);
    expect(doc.getTitle()).toBe(LETTER.subject);
    // The letter's own date, not the clock: PDF metadata that disagrees with the evidence chain's
    // timestamp invites a question nobody wants to answer.
    expect(doc.getCreationDate()).toEqual(LETTER.date);
  });

  it('is deterministic — the same letter renders to the same bytes', async () => {
    // Load-bearing: the evidence chain hashes this artefact, so a timestamp baked into the PDF
    // would make a re-render look like tampering.
    const a = await renderDin5008Letter(LETTER);
    const b = await renderDin5008Letter(LETTER);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('survives German characters rather than throwing out of the dispatch job', async () => {
    const bytes = await renderDin5008Letter({
      ...LETTER,
      body: 'Grüße aus Köln – Straße, Maß, Öl, Übung, ärgerlich. 100 € — Ende.',
    });
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('flows onto a second page rather than printing off the bottom', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `Absatz ${i + 1}: eine Zeile mit ausreichend Text, um Umbruch zu erzwingen.`).join('\n\n');
    const doc = await PDFDocument.load(await renderDin5008Letter({ ...LETTER, body: long }));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('names its enclosures and appends the ones it was given bytes for', async () => {
    const enclosurePdf = await renderDin5008Letter({ ...LETTER, subject: 'Ausweiskopie (geschwärzt)' });
    const withEnclosure = await renderDin5008Letter({
      ...LETTER,
      enclosures: [{ name: 'Ausweiskopie (geschwärzt)', pdf: enclosurePdf }, { name: 'Separat übersandt' }],
    });
    const doc = await PDFDocument.load(withEnclosure);
    // The letter, plus the one enclosure whose bytes were supplied. The named-only enclosure appears
    // in the Anlagen block and is posted by a human.
    expect(doc.getPageCount()).toBe(2);
  });
});
