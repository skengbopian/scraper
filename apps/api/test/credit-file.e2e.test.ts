import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

/**
 * BYO-Datenkopie over HTTP: real fixture PDFs through the real sandbox parser, match gate, rules
 * engine and (in-memory) store. The mismatch case is the anti-stalker acceptance test: a document
 * about someone else yields 403 and stores NOTHING.
 */
const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '../../../services/doc-sandbox/test/fixtures');

describe('credit-file upload (dev fixtures ON, in-memory store)', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    process.env.SCRAPER_DEV_FIXTURES = '1';
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('../dist/app.module.js');
    const express = await import('express');
    app = await NestFactory.create(AppModule, { logger: false });
    app.use('/credit-file/upload', express.default.raw({ type: 'application/pdf', limit: '8mb' }));
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
    delete process.env.SCRAPER_DEV_FIXTURES;
  });

  const uploadPdf = async (name: string) =>
    fetch(`${base}/credit-file/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: new Uint8Array(await readFile(join(FIXTURES, name))),
    });

  it('rejects a third-party Datenkopie with 403 and stores nothing', async () => {
    const r = await uploadPdf('datenkopie-max.pdf');
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('SUBJECT_MISMATCH');
    const f = await (await fetch(`${base}/credit-file/findings`)).json() as { snapshotId: string | null };
    expect(f.snapshotId).toBeNull();
  });

  it('rejects an injection-carrying document (confidence 0) without storing', async () => {
    const r = await uploadPdf('datenkopie-injection.pdf');
    expect(r.status).toBe(422);
    const f = await (await fetch(`${base}/credit-file/findings`)).json() as { snapshotId: string | null };
    expect(f.snapshotId).toBeNull();
  });

  it('ingests the verified user’s own Datenkopie and returns preliminary CoC findings', async () => {
    const r = await uploadPdf('datenkopie-erika.pdf');
    expect(r.status).toBe(201);
    const body = (await r.json()) as {
      snapshotId: string;
      ruleSet: { version: string; preliminary: boolean };
      findings: { ruleId: string; severity: string; scoreNegativeWarning: boolean }[];
    };
    expect(body.snapshotId).toBeTruthy();
    expect(body.ruleSet.version).toBe('coc-v1');
    expect(body.ruleSet.preliminary).toBe(true); // OQ-13: unsigned rule set renders as preliminary
    const rules = body.findings.map((f) => f.ruleId);
    expect(rules).toContain('COC_IV1B_SETTLED_3Y');       // settled 2023-06-01 → overdue since 2026-06-01
    expect(rules).toContain('SETTLED_WITHOUT_ERLEDIGT');  // the "bezahlt" line without Erledigt date
    expect(rules).toContain('COC_IV3A_CONTRACT_ON_REQUEST'); // ended Ratenkredit → score-warned choice
    expect(rules).toContain('INQUIRY_RECODE_CHECK');      // Kreditanfrage from 2026-05-03
    expect(rules).toContain('COC_IV6_INQUIRY_12M');       // Konditionsanfrage from 2024
    expect(body.findings.find((f) => f.ruleId === 'COC_IV3A_CONTRACT_ON_REQUEST')?.scoreNegativeWarning).toBe(true);

    // The findings endpoint serves the persisted snapshot.
    const again = (await (await fetch(`${base}/credit-file/findings`)).json()) as { snapshotId: string };
    expect(again.snapshotId).toBe(body.snapshotId);
  });
});
