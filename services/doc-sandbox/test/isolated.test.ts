import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawDocument } from '@scraper/core';
import { createIsolatedDatenkopieSandbox, isolatedChildEnv } from '../src/isolated.js';
import type { DatenkopieStructured } from '../src/datenkopie-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = async (name: string): Promise<RawDocument> => ({
  id: name,
  mimeType: 'application/pdf',
  bytes: new Uint8Array(await readFile(join(here, 'fixtures', name))),
  receivedAt: new Date(),
});

/** Audit H3: the parse must survive — and be contained by — a real process boundary. */
describe('the process-isolated sandbox', () => {
  it('scrubs the child environment down to the allow-list — no DATABASE_URL, no provider keys', () => {
    const child = isolatedChildEnv({
      NODE_ENV: 'test',
      PATH: '/usr/bin',
      DATABASE_URL: 'postgresql://secret',
      LETTERXPRESS_APIKEY: 'k',
      SCRAPER_KEK_USER: 'kek',
    });
    expect(Object.keys(child).sort()).toEqual(['NODE_ENV', 'PATH']);
  });

  it('parses the Erika fixture across the process boundary with the same result shape', async () => {
    const out = await createIsolatedDatenkopieSandbox().parse(await load('datenkopie-erika.pdf'), {});
    const s = out.structured as DatenkopieStructured;
    expect(out.confidence).toBeGreaterThanOrEqual(0.9);
    expect(s.subjectName).toBe('Erika Mustermann');
    expect(s.bureau).toBe('schufa');
  }, 30_000);

  it('garbage bytes fail loudly across the boundary too — never an empty success', async () => {
    const doc: RawDocument = { id: 'garbage', mimeType: 'application/pdf', bytes: new Uint8Array([1, 2, 3, 4]), receivedAt: new Date() };
    await expect(createIsolatedDatenkopieSandbox().parse(doc, {})).rejects.toThrow(/doc-sandbox/);
  }, 30_000);

  it('the injection fixture is still floored to confidence 0 by the PARENT-side envelope', async () => {
    const out = await createIsolatedDatenkopieSandbox().parse(await load('datenkopie-injection.pdf'), {});
    expect(out.confidence).toBe(0);
  }, 30_000);
});
