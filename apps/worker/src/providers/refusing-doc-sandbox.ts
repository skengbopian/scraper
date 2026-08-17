import type { DocSandbox, RawDocument, SandboxParseResult } from '@scraper/core';

/**
 * A doc sandbox that refuses rather than guesses.
 *
 * The real parser is `services/doc-sandbox` (ADR-007/021: isolated, structured-output only, one
 * document per context). Until the worker is wired to it over its transport, this stand-in returns
 * confidence 0, which invariant 5 turns into NEEDS_HUMAN for every document. A stub that returned a
 * plausible parse would be worse than no parser at all: it would let hostile input reach a validated
 * outcome (docs/06 C4).
 *
 * Moved out of `main.ts` so the factory can resolve it as a seam like the others — it is the answer
 * for BOTH `SCRAPER_DOC_SANDBOX` values today, which is honest rather than accidental.
 */
export class RefusingDocSandbox implements DocSandbox {
  async parse(doc: RawDocument): Promise<SandboxParseResult> {
    return {
      structured: {},
      confidence: 0,
      text: `[doc-sandbox not wired: document ${doc.id} (${doc.mimeType}) was NOT parsed]`,
    };
  }
}
