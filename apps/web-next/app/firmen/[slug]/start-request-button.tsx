'use client';

import { useState, useTransition } from 'react';
import { startRequest } from '../../actions';
import type { RequestType } from '@/lib/types';

/**
 * Acting on a company. The POST is what records the Tier-1 LeverageAction or creates the legal
 * request — the engine decides which, not this button. The API's refusal message is RENDERED
 * (audit W7): a blocked duplicate that produced no visible change was a dead end dressed as a
 * button, and the launch gate forbids exactly that.
 */
export function StartRequestButton({
  slug,
  requestType,
  href,
  label,
}: {
  slug: string;
  requestType: RequestType;
  href?: string;
  label: string;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMessage(null);
            const outcome = await startRequest(slug, requestType);
            if (!outcome.ok) setMessage(outcome.message ?? null);
            // A self-serve route opens the controller's own page — we never submit it for the user
            // and never hold their credentials (docs/08 guardrail 1).
            if (href) window.open(href, '_blank', 'noopener');
          })
        }
      >
        {label}
      </button>
      {message ? <p className="err">{message}</p> : null}
    </>
  );
}
