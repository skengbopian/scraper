import type { DocSandbox } from '@scraper/core';
import { extractPdfText } from './pdf-text.js';
import { withSafetyEnvelope } from './index.js';

/**
 * Datenkopie parser v1 (BYO ingest, docs/10 §3.1): deterministic, regex-sectioned, no model call.
 *
 * v1 targets the documented Scraper fixture layout (see test/fixtures/*.html) — the format our
 * printable "Datenkopie" fixtures and early partner exports use. Real Schufa/CRIF/infoscore layout
 * adapters slot in behind the same structured contract later (P1.5), optionally with the EU-hosted
 * model behind ModelProvider; the safety envelope stays identical either way.
 *
 * Structured output only. The subject block (name + date of birth) is extracted so the API's
 * identity-match gate can refuse third-party documents BEFORE anything is stored.
 */
export interface DatenkopieEntry {
  readonly entryType: 'NEGATIVE_CLAIM' | 'CONTRACT' | 'INQUIRY' | 'ADDRESS' | 'INSOLVENCY';
  readonly reportedBy: string | null;
  readonly reportedAtIso: string | null;
  readonly settledAtIso: string | null;
  readonly amountCents: number | null;
  readonly label: string | null;
}

export interface DatenkopieStructured extends Record<string, unknown> {
  readonly subjectName: string;
  readonly subjectDobIso: string | null;
  readonly bureau: string | null;
  readonly entries: readonly DatenkopieEntry[];
}

const DATE = /(\d{2})\.(\d{2})\.(\d{4})/;

function iso(m: RegExpMatchArray | null): string | null {
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  // Hostile input: "45.13.2024" matches the regex SHAPE. Emitting it produces an Invalid Date that
  // crashes the match gate with a RangeError (a 500) instead of a clean rejection — so anything
  // that is not a real calendar date is "no readable date" (audit W15).
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return null;
  }
  return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
}

function field(line: string, name: string): string | null {
  const m = line.match(new RegExp(`${name}:\\s*([^;]+)`, 'i'));
  return m?.[1]?.trim() ?? null;
}

function dateField(line: string, name: string): string | null {
  const raw = field(line, name);
  return raw ? iso(raw.match(DATE)) : null;
}

function euroCents(line: string, name: string): number | null {
  const raw = field(line, name);
  if (!raw) return null;
  // pdf.js may split "1.234,56" into spaced text items — collapse before matching.
  const m = raw.replace(/\s+/g, '').match(/([\d.]+),(\d{2})/);
  if (!m || !m[1] || !m[2]) return null;
  return Number(m[1].replace(/\./g, '')) * 100 + Number(m[2]);
}

export function parseDatenkopieText(text: string): { structured: DatenkopieStructured; confidence: number } {
  const nameMatch = text.match(/Name:\s*(.+)/);
  const dobMatch = text.match(/Geburtsdatum:\s*(\d{2}\.\d{2}\.\d{4})/);
  const bureauMatch = text.match(/(SCHUFA|CRIF|infoscore|Regis24)/i);

  const entries: DatenkopieEntry[] = [];
  // Segment by record tags, not by physical lines: print layouts wrap long records across lines,
  // so a record runs from its [TAG] to the next [TAG] or section heading.
  const TAG_RE = /\[(ZAHLUNGSSTOERUNG|VERTRAG|ANFRAGE|ADRESSE|INSOLVENZ)\]/g;
  const tags = [...text.matchAll(TAG_RE)];
  for (let i = 0; i < tags.length; i++) {
    const start = tags[i]?.index ?? 0;
    const end = tags[i + 1]?.index ?? text.length;
    const segment = text.slice(start, end);
    const cutAtHeading = segment.search(/\n\s*(Zahlungsstörungen|Verträge|Anfragen|Adressen|Insolvenzen)\s*\n/);
    const line = (cutAtHeading === -1 ? segment : segment.slice(0, cutAtHeading)).replace(/\n+/g, ' ');
    const kind = tags[i]?.[1];
    if (kind === 'ZAHLUNGSSTOERUNG') {
      entries.push({
        entryType: 'NEGATIVE_CLAIM',
        reportedBy: field(line, 'Gläubiger'),
        reportedAtIso: dateField(line, 'Gemeldet am'),
        settledAtIso: dateField(line, 'Erledigt am'),
        amountCents: euroCents(line, 'Betrag'),
        label: /bezahlt/i.test(line) && !dateField(line, 'Erledigt am') ? 'BEZAHLT' : null,
      });
    } else if (kind === 'VERTRAG') {
      entries.push({
        entryType: 'CONTRACT',
        reportedBy: field(line, 'Partner'),
        reportedAtIso: dateField(line, 'Gemeldet am'),
        settledAtIso: dateField(line, 'Beendet am'),
        amountCents: null,
        label: field(line, 'Art')?.toUpperCase() ?? null,
      });
    } else if (kind === 'ANFRAGE') {
      entries.push({
        entryType: 'INQUIRY',
        reportedBy: field(line, 'Anfragender'),
        reportedAtIso: dateField(line, 'Datum'),
        settledAtIso: null,
        amountCents: null,
        label: field(line, 'Art')?.toUpperCase().replace(/\s+/g, '') ?? null,
      });
    } else if (kind === 'ADRESSE') {
      entries.push({
        entryType: 'ADDRESS',
        reportedBy: null,
        reportedAtIso: dateField(line, 'Gemeldet am'),
        settledAtIso: null,
        amountCents: null,
        label: null,
      });
    } else if (kind === 'INSOLVENZ') {
      entries.push({
        entryType: 'INSOLVENCY',
        reportedBy: null,
        reportedAtIso: null,
        settledAtIso: dateField(line, 'RSB erteilt am'),
        amountCents: null,
        label: /RSB/i.test(line) ? 'RSB' : null,
      });
    }
  }

  const structured: DatenkopieStructured = {
    subjectName: nameMatch?.[1]?.trim() ?? '',
    subjectDobIso: dobMatch ? iso(dobMatch[1]?.match(DATE) ?? null) : null,
    bureau: bureauMatch?.[1]?.toLowerCase() ?? null,
    entries,
  };

  const confidence = structured.subjectName && structured.subjectDobIso && entries.length > 0 ? 0.95
    : structured.subjectName ? 0.5
    : 0.2;
  return { structured, confidence };
}

/** The sandboxed PDF Datenkopie parser: bytes → text (hardened pdfjs) → sections → envelope. */
export function createDatenkopieSandbox(): DocSandbox {
  return withSafetyEnvelope(async (doc) => {
    const text = await extractPdfText(doc.bytes);
    const { structured, confidence } = parseDatenkopieText(text);
    return { text, structured, confidence };
  });
}
