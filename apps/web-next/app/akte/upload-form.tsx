'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The upload. A client component by necessity: the PDF bytes come from a file input. It posts to
 * the SAME-ORIGIN proxy route (`app/akte/upload/route.ts`), which attaches the httpOnly session
 * bearer server-side — a direct browser→API call carries no Authorization and 403s under real auth
 * (audit W4). The API's answer is rendered, not collapsed: SUBJECT_MISMATCH, QUALITY_TOO_LOW and
 * RATE_LIMITED are different problems with different next actions, and the launch gate says no
 * screen may dead-end.
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
              const res = await fetch('/akte/upload', {
                method: 'POST',
                headers: { 'content-type': 'application/pdf' },
                body: bytes,
              });
              if (!res.ok) {
                const body = (await res.json().catch(() => ({}))) as { message?: string | string[] };
                const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
                setError(message && String(message).trim() ? String(message) : failed);
              } else {
                router.refresh();
              }
            });
          }}
        />
      </label>
      <p className="sub" style={{ fontSize: 13 }}>{note}</p>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
