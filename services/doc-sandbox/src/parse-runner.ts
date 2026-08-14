import { createDatenkopieSandbox } from './datenkopie-parser.js';

/**
 * Child-process entry for the isolated Datenkopie parse (audit H3).
 *
 * PDF bytes arrive on stdin; `argv[2]`/`argv[3]` carry the document id and mime type; the
 * SandboxResult leaves as one JSON object on stdout. Parse failures are `{ ok: false }` with exit
 * code 0 — the parent must distinguish "the hostile document was refused" (normal, fail-closed)
 * from "the runner crashed" (a bug or a pdf.js exploit attempt, which the process boundary exists
 * to contain).
 *
 * This process is launched with a SCRUBBED environment (isolated.ts): no DATABASE_URL, no
 * provider keys — a compromise of the PDF stack lands in a process that can reach nothing.
 */
async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const id = process.argv[2] ?? 'stdin';
  const mimeType = process.argv[3] ?? 'application/pdf';

  try {
    const result = await createDatenkopieSandbox().parse({ id, mimeType, bytes, receivedAt: new Date() }, {});
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  }
}

void main();
