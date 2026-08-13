'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The upload. A client component by necessity: the PDF bytes come from a file input, and posting
 * them through a server action would mean buffering the document in the Next process as well as the
 * API — one more place a hostile PDF sits (CLAUDE.md §2). It goes straight to the sandboxed endpoint.
 */
export function UploadForm({ cta, busy, failed, note }: { cta: string; busy: string; failed: string; note: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="btnrow">
      <label className="btn primary" style={{ cursor: pending ? 'default' : 'pointer' }}>
        {pending ? busy : cta}
        <input
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          disabled={pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            setError(null);
            start(async () => {
              const bytes = await file.arrayBuffer();
              const res = await fetch('/api/credit-file/upload', {
                method: 'POST',
                headers: { 'content-type': 'application/pdf' },
                body: bytes,
              });
              if (!res.ok) setError(failed);
              else router.refresh();
            });
          }}
        />
      </label>
      <p className="sub" style={{ fontSize: 13 }}>{note}</p>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
