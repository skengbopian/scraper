'use client';

import { useTransition } from 'react';
import { startRequest } from '../../actions';
import type { RequestType } from '@/lib/types';

/**
 * Acting on a company. The POST is what records the Tier-1 LeverageAction or creates the legal
 * request — the engine decides which, not this button.
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
  return (
    <button
      type="button"
      className="btn primary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await startRequest(slug, requestType);
          // A self-serve route opens the controller's own page — we never submit it for the user
          // and never hold their credentials (docs/08 guardrail 1).
          if (href) window.open(href, '_blank', 'noopener');
        })
      }
    >
      {label}
    </button>
  );
}
