import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { PostalRecipient } from '@scraper/core';

/**
 * DIN 5008 Form B letter rendering.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------------------------
 * The LetterXpress adapter base64-encoded the rendered MARKDOWN and posted it to a field called
 * `base64_file`, where the vendor expects a PDF. Best case that is rejected at the API; worst case
 * something downstream renders `{{legalName}}`-era plumbing, asterisks and hyphens onto paper and
 * posts it to a data controller as a legal request. The recipient went into a single flat `address`
 * field, so the Postleitzahl was wherever the comma-joined string happened to put it.
 *
 * It also unblocks the posture-A manual route, which is the route the first postal send will
 * actually use: an operator told to "print the letter and take it to the Post" must not be handed
 * Markdown. Form B is not decoration — a window envelope only shows the address if the address is
 * where DIN 5008 says it is, and Deutsche Post's automated sorting reads that window.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT DOES NOT DO
 * ---------------------------------------------------------------------------------------------
 * It composes no prose. The body arrives already rendered from a counsel-approved template
 * (`renderRequest`), and this only lays it out: paragraphs, list items and blank lines, wrapped to
 * the text column. No Markdown is interpreted beyond that — bold, headings and links have no place
 * in a letter and silently swallowing their syntax would change what counsel signed.
 */

/** Millimetres → PostScript points, the unit pdf-lib measures in. */
const mm = (v: number): number => (v * 72) / 25.4;

/** DIN 5008 Form B, all measured from the top-left of an A4 page. */
const PAGE = { width: mm(210), height: mm(297) };
const LAYOUT = {
  marginLeft: mm(24.1),
  marginRight: mm(8.1),
  /** Rücksendeangabe: the sender line inside the address window, above the recipient. */
  senderLineTop: mm(45),
  /** Anschriftfeld: 85 × 40 mm. Form B starts the address zone 45 mm down; 5 mm of it is the sender line. */
  addressTop: mm(50.8),
  addressWidth: mm(85),
  /** Informationsblock — date, right-aligned on the same band as the address field. */
  infoBlockTop: mm(50.8),
  betreffTop: mm(98.46),
  bodyTop: mm(107.46),
  /** Fold marks (Falzmarken) and the punch mark (Lochmarke). Without them the letter folds wrong. */
  foldMark1: mm(87),
  foldMark2: mm(192),
  punchMark: mm(148.5),
  bottom: mm(272),
};
const FONT_SIZE = 11;
const LINE_HEIGHT = FONT_SIZE * 1.25;

export interface LetterSender {
  readonly name: string;
  /** Street then `PLZ Ort`, from the verified identity — never free text (CLAUDE.md). */
  readonly addressLines: readonly string[];
}

export interface LetterEnclosure {
  /** Printed in the Anlagen block, so the recipient can tell what should have been in the envelope. */
  readonly name: string;
  /** PDF bytes to append. Absent means the enclosure is named but posted separately by a human. */
  readonly pdf?: Uint8Array;
}

export interface Din5008Letter {
  readonly sender: LetterSender;
  readonly recipient: PostalRecipient;
  readonly subject: string;
  readonly body: string;
  readonly date: Date;
  readonly enclosures?: readonly LetterEnclosure[];
}

/**
 * A template body opens with its own `Betreff: …` line (see templates/*.md). In DIN 5008 the Betreff
 * belongs at a fixed position with no label, so it is lifted out rather than printed twice.
 */
export function splitBetreff(body: string): { subject: string | null; body: string } {
  const match = /^[ \t]*Betreff:[ \t]*(.+)$/m.exec(body);
  if (match === null) return { subject: null, body };
  return { subject: match[1]!.trim(), body: body.replace(match[0], '').replace(/^\s+/, '') };
}

const GERMAN_DATE = (d: Date): string =>
  `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;

/**
 * WinAnsi is what pdf-lib's standard fonts encode, and it covers German. A character outside it
 * would throw from deep inside the PDF library with no useful message, so it is replaced here with
 * a visible marker — a letter with one odd glyph still says what counsel wrote; a dispatch that dies
 * on an em-dash does not.
 */
function toWinAnsi(text: string, font: PDFFont): string {
  let out = '';
  for (const ch of text) {
    try {
      font.widthOfTextAtSize(ch, FONT_SIZE);
      out += ch;
    } catch {
      out += ch === '—' || ch === '–' ? '-' : '?';
    }
  }
  return out;
}

/** A line that opens a new block: a list marker, so a numbered demand is never joined to the one above. */
const LIST_MARKER = /^\s*(?:[-*]|\d+\.)\s+/;

/**
 * A source line at least this long was broken because it ran out of columns, not because the author
 * meant a new line. Templates are hard-wrapped around 100; the shortest deliberate break in the
 * shipped set is `Mit freundlichen Grüßen` at 23.
 */
const SOURCE_WRAP_HINT = 70;

/**
 * Re-flow the template's source line breaks into paragraphs.
 *
 * Counsel-owned prose in `templates/*.md` is hard-wrapped at about a hundred columns for review, and
 * that wrapping is an artefact of editing a Markdown file — not of the letter. Printing it verbatim
 * breaks sentences mid-clause at whatever column the author happened to stop, which reads as
 * carelessness on a document asserting a statutory right.
 *
 * But some line breaks ARE the letter: the Grußformel, the signature name and the date are three
 * lines and must stay three lines. Joining everything produced
 * "Mit freundlichen Grüßen Erika Mustermann 15.08.2026" on one line.
 *
 * The rule distinguishes them by the length of the line being continued FROM. A source line that ran
 * to ~100 columns was wrapped; one that stopped at 23 was ended. Blank lines separate, and a list
 * marker always opens its own block so numbered demands keep their numbering.
 */
export function paragraphsOf(body: string): string[] {
  const out: string[] = [];
  let lastSourceLength = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const last = out[out.length - 1];
    if (trimmed === '') {
      if (last !== '') out.push('');
      lastSourceLength = 0;
      continue;
    }
    const continues = last !== undefined && last !== '' && !LIST_MARKER.test(line) && lastSourceLength >= SOURCE_WRAP_HINT;
    if (continues) out[out.length - 1] = `${last} ${trimmed}`;
    else out.push(trimmed);
    lastSourceLength = trimmed.length;
  }
  return out;
}

function wrap(text: string, font: PDFFont, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (font.widthOfTextAtSize(candidate, FONT_SIZE) <= maxWidth) {
      line = candidate;
    } else {
      if (line !== '') lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** pdf-lib measures y from the BOTTOM; every constant above is from the top. One conversion, here. */
const yAt = (topOffset: number): number => PAGE.height - topOffset;

function drawMarks(page: PDFPage): void {
  const ink = rgb(0.6, 0.6, 0.6);
  for (const [top, length] of [
    [LAYOUT.foldMark1, mm(5)],
    [LAYOUT.punchMark, mm(8)],
    [LAYOUT.foldMark2, mm(5)],
  ] as const) {
    page.drawLine({ start: { x: 0, y: yAt(top) }, end: { x: length, y: yAt(top) }, thickness: 0.5, color: ink });
  }
}

export async function renderDin5008Letter(letter: Din5008Letter): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(letter.subject);
  doc.setProducer('scraper');
  // No creation date from the clock: a PDF whose metadata disagrees with the evidence chain's
  // timestamp invites a question nobody wants to answer. The letter's own date is the letter's date.
  doc.setCreationDate(letter.date);
  doc.setModificationDate(letter.date);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const textWidth = PAGE.width - LAYOUT.marginLeft - LAYOUT.marginRight;

  let page = doc.addPage([PAGE.width, PAGE.height]);
  drawMarks(page);

  const write = (text: string, top: number, f: PDFFont, size = FONT_SIZE): void => {
    page.drawText(toWinAnsi(text, f), { x: LAYOUT.marginLeft, y: yAt(top), size, font: f });
  };

  // Rücksendeangabe — one line, small, underlined by convention. It is what makes an undeliverable
  // letter come back to the sender instead of being destroyed.
  write([letter.sender.name, ...letter.sender.addressLines].join(' · '), LAYOUT.senderLineTop, font, 7);

  letter.recipient.lines.forEach((line, i) => write(line, LAYOUT.addressTop + i * LINE_HEIGHT, font));
  if (letter.recipient.country !== 'DE') {
    write(letter.recipient.country, LAYOUT.addressTop + letter.recipient.lines.length * LINE_HEIGHT, font);
  }

  // Informationsblock: the date, right-aligned.
  const dateText = toWinAnsi(GERMAN_DATE(letter.date), font);
  page.drawText(dateText, {
    x: PAGE.width - LAYOUT.marginRight - font.widthOfTextAtSize(dateText, FONT_SIZE),
    y: yAt(LAYOUT.infoBlockTop),
    size: FONT_SIZE,
    font,
  });

  // The Betreff wraps. A subject line long enough to run past the right margin is not hypothetical —
  // the Art. 21(2) template's is 103 characters — and an unwrapped one prints off the edge of the
  // paper, so the recipient's first sight of the letter is a sentence that stops mid-word.
  const betreffLines = wrap(letter.subject, bold, textWidth);
  betreffLines.forEach((line, i) => write(line, LAYOUT.betreffTop + i * LINE_HEIGHT, bold));

  // The body starts where DIN 5008 puts it, unless the Betreff took more than its one line.
  let top = Math.max(LAYOUT.bodyTop, LAYOUT.betreffTop + betreffLines.length * LINE_HEIGHT + LINE_HEIGHT);
  const nextPage = (): void => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    drawMarks(page);
    top = mm(25);
  };

  for (const paragraph of paragraphsOf(letter.body)) {
    if (paragraph.trim() === '') {
      top += LINE_HEIGHT * 0.6;
      continue;
    }
    // List items keep their marker and hang their continuation lines under the text, not under the
    // marker — the one piece of structure a legal letter's numbered demands actually need.
    const marker = /^\s*(?:[-*]|\d+\.)\s+/.exec(paragraph)?.[0] ?? '';
    const indent = marker === '' ? 0 : font.widthOfTextAtSize(toWinAnsi(marker, font), FONT_SIZE);
    const lines = wrap(paragraph.slice(marker.length), font, textWidth - indent);
    lines.forEach((line, i) => {
      if (top > LAYOUT.bottom) nextPage();
      const prefix = i === 0 ? marker.trimStart() : '';
      page.drawText(toWinAnsi(prefix + line, font), {
        x: LAYOUT.marginLeft + (i === 0 ? 0 : indent),
        y: yAt(top),
        size: FONT_SIZE,
        font,
      });
      top += LINE_HEIGHT;
    });
  }

  const enclosures = letter.enclosures ?? [];
  if (enclosures.length > 0) {
    top += LINE_HEIGHT * 1.5;
    if (top > LAYOUT.bottom) nextPage();
    write(enclosures.length === 1 ? 'Anlage' : 'Anlagen', top, bold);
    top += LINE_HEIGHT;
    for (const enclosure of enclosures) {
      if (top > LAYOUT.bottom) nextPage();
      write(enclosure.name, top, font);
      top += LINE_HEIGHT;
    }
  }

  // Enclosure pages are appended rather than merged into the body, so what the recipient receives is
  // exactly the letter followed by exactly the attachments the Anlagen block names.
  for (const enclosure of enclosures) {
    if (enclosure.pdf === undefined) continue;
    const source = await PDFDocument.load(enclosure.pdf);
    const copied = await doc.copyPages(source, source.getPageIndices());
    for (const p of copied) doc.addPage(p);
  }

  return doc.save();
}
