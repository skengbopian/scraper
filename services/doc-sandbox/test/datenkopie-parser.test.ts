import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatenkopieSandbox, parseDatenkopieText, type DatenkopieStructured } from '../src/datenkopie-parser.js';
import type { RawDocument } from '@scraper/core';

const here = dirname(fileURLToPath(import.meta.url));
const load = async (name: string): Promise<RawDocument> => ({
  id: name,
  mimeType: 'application/pdf',
  bytes: new Uint8Array(await readFile(join(here, 'fixtures', name))),
  receivedAt: new Date(),
});

describe('Datenkopie parser v1 (real PDFs through the hardened pdfjs path + envelope)', () => {
  it('extracts subject + all sections from the Erika fixture with high confidence', async () => {
    const out = await createDatenkopieSandbox().parse(await load('datenkopie-erika.pdf'), {});
    const s = out.structured as DatenkopieStructured;
    expect(out.confidence).toBeGreaterThanOrEqual(0.9);
    expect(s.subjectName).toBe('Erika Mustermann');
    expect(s.subjectDobIso).toBe('1979-03-12T00:00:00.000Z');
    expect(s.bureau).toBe('schufa');
    const types = s.entries.map((e) => e.entryType);
    expect(types.filter((t) => t === 'NEGATIVE_CLAIM')).toHaveLength(2);
    expect(types.filter((t) => t === 'CONTRACT')).toHaveLength(2);
    expect(types.filter((t) => t === 'INQUIRY')).toHaveLength(2);
    expect(types.filter((t) => t === 'ADDRESS')).toHaveLength(1);
    const settled = s.entries.find((e) => e.entryType === 'NEGATIVE_CLAIM' && e.settledAtIso);
    expect(settled?.settledAtIso).toBe('2023-06-01T00:00:00.000Z');
    expect(settled?.amountCents).toBe(123456);
    const paid = s.entries.find((e) => e.entryType === 'NEGATIVE_CLAIM' && !e.settledAtIso);
    expect(paid?.label).toBe('BEZAHLT');
    const inquiry = s.entries.find((e) => e.label === 'KREDITANFRAGE');
    expect(inquiry?.reportedAtIso).toBe('2026-05-03T00:00:00.000Z');
  });

  it('parses the third-party fixture faithfully — the MATCH GATE, not the parser, rejects it', async () => {
    const out = await createDatenkopieSandbox().parse(await load('datenkopie-max.pdf'), {});
    const s = out.structured as DatenkopieStructured;
    expect(s.subjectName).toBe('Max Beispiel');
    expect(s.subjectDobIso).toBe('1985-05-05T00:00:00.000Z');
  });

  it('drives confidence to ZERO on an injection-carrying document (envelope, not parser)', async () => {
    const out = await createDatenkopieSandbox().parse(await load('datenkopie-injection.pdf'), {});
    expect(out.confidence).toBe(0);
  });

  it('garbage bytes fail loudly, never as an empty success', async () => {
    const doc: RawDocument = { id: 'garbage', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3, 4]), receivedAt: new Date() };
    await expect(createDatenkopieSandbox().parse(doc, {})).rejects.toThrow();
  });

  it('text-level parser: unknown layout yields the low-confidence floor', () => {
    const { confidence } = parseDatenkopieText('völlig anderes dokument ohne struktur');
    expect(confidence).toBeLessThanOrEqual(0.2);
  });
});
