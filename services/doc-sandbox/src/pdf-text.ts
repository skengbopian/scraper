/**
 * Born-digital PDF → text, in-process, hardened (docs/10 §4: pdfjs-dist Apache-2.0 for the
 * text-layer path; OCRmyPDF is the later fallback for scans — separate container, not here).
 *
 * Hostile-input posture (pdf.js has had malicious-PDF CVEs): `isEvalSupported:false` (no JS-in-PDF
 * evaluation), no DOM/fonts (`disableFontFace`), a hard page cap, and a time budget. These reduce
 * the attack surface; the BACKSTOP is process isolation — real-user parses go through
 * `createIsolatedDatenkopieSandbox()` (isolated.ts), which runs this module in a scrubbed-env
 * child process with no DATABASE_URL in reach (audit H3). An earlier version of this comment
 * claimed the isolation while the API imported this module in-process; the claim is only as true
 * as the caller's choice of factory, so callers: use the isolated one.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const MAX_PAGES = 40;
const TIME_BUDGET_MS = 20_000;

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const task = getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    // No external resources of any kind — the document must be self-contained.
    cMapUrl: undefined,
    standardFontDataUrl: undefined,
  });
  const doc = await task.promise;
  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    const out: string[] = [];
    for (let i = 1; i <= pages; i++) {
      if (Date.now() > deadline) throw new Error(`pdf text extraction exceeded ${TIME_BUDGET_MS}ms`);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      // Group items into lines by their y coordinate (transform[5]); order left-to-right.
      const lines = new Map<number, { x: number; s: string }[]>();
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const y = Math.round((item.transform?.[5] ?? 0) as number);
        const x = (item.transform?.[4] ?? 0) as number;
        if (!lines.has(y)) lines.set(y, []);
        lines.get(y)?.push({ x, s: item.str });
      }
      const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
      out.push(ordered.map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(' ')).join('\n'));
    }
    return out.join('\n');
  } finally {
    await doc.destroy();
  }
}
